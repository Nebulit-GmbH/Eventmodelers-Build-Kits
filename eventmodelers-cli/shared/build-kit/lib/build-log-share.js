// A build agent shares its event log with the board — two capabilities, both build-agent only (a modeling
// agent gets no-ops):
//
//   iterations  every slice build turn is an iteration: `iteration-started` / `iteration-closed` events in the
//               log, each carrying the slice, the iteration id, the board, the org and the date — and a
//               `slice-done` after an iteration that settled the slice as Done. Always on.
//   sync        with --sync, the events that name a slice are uploaded to POST …/boards/:boardId/buildlog,
//               numbered (the event's own `seq`, which defines the order) and tagged with the kit type (backend, or ui for a kit that picks up from Waiting) —
//               constantly, on a short interval for as long as the loop runs, so a live dashboard follows the
//               build, and once more at the start and end of each iteration.
//
// Best effort, like tracing: a cursor (the last event id sent) lives next to the log and only moves forward
// when the upload succeeded, so a failed upload is simply sent again with the next one. The server holds one
// iteration per slice and kit type — every `iteration-started` resets that log — and at most 1000 entries.

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendEvent, readEvents } from './slice-events.js';
import { statusKey } from './slice-state.js';

export const SYNC_STATE_FILE = 'build-log-sync.json';
export const SYNC_INTERVAL_MS = 2_000;
const NOOP = { iterationStarted: () => null, iterationClosed: () => {}, flush: async () => {}, start: () => {}, stop: () => {} };

function readState(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

function writeState(path, state) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), 'utf-8');
  renameSync(tmp, path);
}

// The wire shape of one log event: the envelope the endpoint reads, everything else as payload.
export function toBuildLogEntry(e, { agentId, iteration, boardId, organizationId, kitType, seq }) {
  const { id, at, type, slice, meta: _meta, tags: _tags, ...rest } = e;
  return { ...rest, id, type, sliceId: slice, agentId, iteration, occurredAt: at, boardId, organizationId, kitType, seq };
}

// A kit that picks slices up from Waiting builds the UI; any other builds the backend.
export const kitTypeOf = (pickupStatus) => (String(pickupStatus ?? '').trim().toLowerCase() === 'waiting' ? 'ui' : 'backend');

export function createBuildLogShare({ kitDir, cfg, meta, agentType = 'BUILD', kitType = 'backend', sync = false, enabled = true, intervalMs = SYNC_INTERVAL_MS, log = () => {} } = {}) {
  if (agentType !== 'BUILD') return NOOP;
  const statePath = join(kitDir, SYNC_STATE_FILE);
  const canUpload = !!(sync && enabled && cfg?.baseUrl && cfg?.token && cfg?.organizationId && cfg?.boardId && cfg?.agentId);
  const open = new Map(); // slice → the iteration in progress
  let timer = null;
  let inFlight = null;
  let warned = false;

  async function upload() {
    const state = readState(statePath);
    const events = readEvents(kitDir);
    const from = state.cursor ? events.findIndex((e) => e.id === state.cursor) + 1 : 0; // a pruned cursor re-sends; the server drops duplicates
    const fresh = events.slice(from);
    if (!fresh.length) return;
    const iterations = { ...(state.iterations ?? {}) };
    const entries = [];
    for (const e of fresh) {
      if (!e.slice) continue;
      if (e.type === 'iteration-started') iterations[e.slice] = e.iteration;
      entries.push(toBuildLogEntry(e, { agentId: cfg.agentId, iteration: e.iteration ?? iterations[e.slice], boardId: cfg.boardId, organizationId: cfg.organizationId, kitType, seq: e.seq }));
    }
    if (entries.length) {
      const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/buildlog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-agent-id': cfg.agentId },
        body: JSON.stringify({ events: entries }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const reason = `HTTP ${res.status}${await res.text().then((t) => `: ${t}`).catch(() => '')}`;
        // A batch the platform rejects as invalid can never succeed: skip it rather than resend it every interval.
        if (res.status !== 400) throw new Error(reason);
        log(`info: the platform did not take ${entries.length} build log entries (${reason}) — skipped`);
      }
    }
    writeState(statePath, { cursor: fresh[fresh.length - 1].id, iterations });
  }

  // One upload at a time. A call that arrives while one runs asks for another pass right after it, so events
  // appended in between are never left to wait for the interval.
  let again = false;
  function flush() {
    if (!canUpload) return Promise.resolve();
    if (inFlight) { again = true; return inFlight; }
    inFlight = (async () => {
      do {
        again = false;
        try { await upload(); warned = false; } catch (err) {
          if (!warned) { warned = true; log(`info: build log upload failed (${err.message}) — will send it with the next one`); }
          break;
        }
      } while (again);
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    iterationStarted(planned) {
      const iteration = randomUUID();
      try {
        appendEvent(kitDir, { type: 'iteration-started', slice: planned.id, iteration, title: planned.title, kitType, boardId: cfg?.boardId, organizationId: cfg?.organizationId }, meta);
      } catch (err) {
        log(`info: could not record the start of an iteration (${err.message}) — the build goes on`);
        return null;
      }
      open.set(planned.id, iteration);
      flush();
      return iteration;
    },
    async iterationClosed(planned, status) {
      const iteration = open.get(planned.id);
      if (!iteration) return;
      open.delete(planned.id);
      try {
        appendEvent(kitDir, { type: 'iteration-closed', slice: planned.id, iteration, status, kitType, boardId: cfg?.boardId, organizationId: cfg?.organizationId }, meta);
      } catch (err) {
        log(`info: could not record the end of an iteration (${err.message}) — the build goes on`);
        return;
      }
      // The iteration that settled the slice as Done ends with `slice-done`; if it is the slice's newest entry when
      // the next iteration starts, the platform knows the slice was reopened and starts its log over.
      try {
        const events = readEvents(kitDir);
        const from = events.findLastIndex((e) => e.type === 'iteration-started' && e.iteration === iteration);
        if (events.slice(from + 1).some((e) => e.type === 'settled' && e.slice === planned.id && statusKey(e.status) === 'done')) {
          appendEvent(kitDir, { type: 'slice-done', slice: planned.id, iteration, kitType, boardId: cfg?.boardId, organizationId: cfg?.organizationId }, meta);
        }
      } catch (err) {
        log(`info: could not record that the slice is done (${err.message}) — the build goes on`);
      }
      await flush();
    },
    flush,
    start() {
      if (!canUpload || timer) return;
      timer = setInterval(flush, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
