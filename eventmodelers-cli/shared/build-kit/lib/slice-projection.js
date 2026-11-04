// Slice status in `.slices/<ctx>/index.json` and `slice.json` is a read-only view of the event log — the
// build agent reads those files, but nothing writes status into them except this projection.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendEvent, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';

// The loop's status for a slice, falling back to what the board said when the log knows nothing of it.
export function statusOf(state, slice) {
  return state.slices[slice.id]?.status ?? slice.status;
}

// Records what the board shows. Only changes become events, so a refresh every few seconds does not
// grow the log. `meta` (agent, organization, board) is stamped on each event. Returns the folded state.
export function observeBoard(kitDir, boardSlices, meta, current = fold(readEvents(kitDir))) {
  const state = current;
  let changed = false;
  for (const { id, status } of boardSlices) {
    if (!id || !status || state.slices[id]?.lastBoardStatus === status) continue;
    appendEvent(kitDir, { type: 'board-observed', slice: id, status }, meta);
    changed = true;
  }
  return changed ? fold(readEvents(kitDir)) : state;
}

// The board's slice statuses as the slice list reports them (the backend's STATUS_MAP). 'Handover' is the
// legacy name of Waiting. Undefined for anything else — the caller then reads the board instead of guessing.
const BOARD_STATUSES = new Set(['Created', 'Ready', 'Done', 'InProgress', 'Blocked', 'Assigned', 'Review', 'Waiting', 'Planned', 'Informational']);
export function normalizeBoardStatus(raw) {
  if (raw === 'Handover') return 'Waiting';
  return BOARD_STATUSES.has(raw) ? raw : undefined;
}

// Whether the slice is already in a context's index.json — a slice the agent has never listed has to be
// fetched, because its title, type and context are not in a status event.
function knowsSlice(kitDir, sliceId) {
  const slicesDir = join(kitDir, '.slices');
  if (!existsSync(slicesDir)) return false;
  for (const ctx of readdirSync(slicesDir, { withFileTypes: true })) {
    if (!ctx.isDirectory()) continue;
    try {
      const index = JSON.parse(readFileSync(join(slicesDir, ctx.name, 'index.json'), 'utf-8'));
      if ((index.slices ?? []).some((e) => e.id === sliceId)) return true;
    } catch { /* an unreadable index is left for the next full fetch to repair */ }
  }
  return false;
}

// A status change the board announced for a slice already on disk, applied without reading the board again:
// the same two steps a full refresh takes for status — record what the board shows (observeBoard, after
// adopting the agent's own edits), then project the log's status into the files — so a claim held here still
// wins over the board's InProgress. Returns false when the slice is unknown or the status unrecognised; the
// caller then falls back to a full refresh.
export function applyBoardStatus(kitDir, sliceId, boardStatus, meta) {
  const status = normalizeBoardStatus(boardStatus);
  if (!sliceId || !status || !knowsSlice(kitDir, sliceId)) return false;
  const state = observeBoard(kitDir, [{ id: sliceId, status }], meta, adoptAgentEdits(kitDir, fold(readEvents(kitDir)), meta));
  projectStatus(kitDir, state);
  return true;
}

// The build agent still records its outcome by editing a slice's status in index.json (until it has a
// command of its own). While a slice is claimed the projection keeps that file equal to the log, so any
// difference is the agent's edit — adopted as `agent-recorded`. This runs before every refresh and before
// settling, or the next projection would write the log's InProgress over the agent's Done.
// Returns the folded state.
export function adoptAgentEdits(kitDir, state, meta) {
  const claimed = Object.entries(state.slices).filter(([, s]) => s.claim).map(([id]) => id);
  const slicesDir = join(kitDir, '.slices');
  if (!claimed.length || !existsSync(slicesDir)) return state;
  let adopted = false;
  for (const ctx of readdirSync(slicesDir, { withFileTypes: true })) {
    if (!ctx.isDirectory()) continue;
    let index;
    try { index = JSON.parse(readFileSync(join(slicesDir, ctx.name, 'index.json'), 'utf-8')); } catch { continue; }
    for (const entry of index.slices ?? []) {
      if (!claimed.includes(entry.id) || !entry.status || entry.status === state.slices[entry.id].status) continue;
      appendEvent(kitDir, { type: 'agent-recorded', slice: entry.id, status: entry.status }, meta);
      adopted = true;
    }
  }
  return adopted ? fold(readEvents(kitDir)) : state;
}

function writeJsonAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

// Sets status (and the Blocked note) on one parsed file's object; true when anything changed.
function apply(target, slice, extra = {}) {
  const want = { status: slice.status, blockedReason: slice.blocked?.reason, blockedAt: slice.blocked?.at, ...extra };
  let changed = false;
  for (const [key, value] of Object.entries(want)) {
    if (value === undefined) {
      if (key !== 'status' && key in target) { delete target[key]; changed = true; }
    } else if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
      target[key] = value;
      changed = true;
    }
  }
  return changed;
}

// Writes the derived status into every index.json entry (and its `definition`) and slice.json the log
// has a status for. Everything else in those files is left alone, and a file is only rewritten when
// something changed. Returns how many files were written.
export function projectStatus(kitDir, state) {
  const slicesDir = join(kitDir, '.slices');
  if (!existsSync(slicesDir)) return 0;
  let written = 0;
  for (const ctx of readdirSync(slicesDir, { withFileTypes: true })) {
    if (!ctx.isDirectory()) continue;
    const indexPath = join(slicesDir, ctx.name, 'index.json');
    if (!existsSync(indexPath)) continue;
    let index;
    try { index = JSON.parse(readFileSync(indexPath, 'utf-8')); } catch { continue; }
    let indexChanged = false;
    for (const entry of index.slices ?? []) {
      const slice = state.slices[entry.id];
      if (!slice?.status) continue;
      if (apply(entry, slice)) indexChanged = true;
      if (entry.definition && entry.definition.status !== slice.status) { entry.definition.status = slice.status; indexChanged = true; }
      const slicePath = join(slicesDir, ctx.name, entry.folder ?? '', 'slice.json');
      if (!entry.folder || !existsSync(slicePath)) continue;
      try {
        const data = JSON.parse(readFileSync(slicePath, 'utf-8'));
        // slice.json is what the build agent reads, so it also carries what the last failed attempt tried.
        if (apply(data, slice, { lastAttempt: slice.lastFailure ?? undefined })) { writeJsonAtomic(slicePath, data); written++; }
      } catch { /* an unreadable slice.json is left for the next full fetch to repair */ }
    }
    if (indexChanged) { writeJsonAtomic(indexPath, index); written++; }
  }
  return written;
}
