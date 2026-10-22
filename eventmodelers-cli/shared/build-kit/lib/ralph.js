// Common runtime for the ralph loop + realtime agent.
// Not meant to be run directly — use ralph-claude.js or ralph-local-ai.js.
//
// startRalph({ kitDir, projectDir, onTask, onPlannedSlice })
//   onTask(prompt) — called once per queued slice change (the oldest first; see lib/slice-tasks.js)
//   onPlannedSlice(prompt, slice) — called when .slices/ has a "Planned" entry (omit to skip);
//     `slice` ({sliceId, sliceTitle, context, ticketNumber, assignee, boardId, attempt}) lets a runner record what building it cost.
//     May resolve with the agent's final reply — quoted in the note if the slice ends up auto-blocked.

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { createRealtimeAdapter, keepSubscribed } from './adapters/realtime-adapter.js';
import { backoffMs, sleep } from './backoff.js';
import { adoptAgentEdits, observeBoard, projectStatus, statusOf } from './slice-projection.js';
import { fold, statusKey } from './slice-state.js';
import { readEvents } from './slice-events.js';
import { claimSlice, recordEvent, settleSlice, settleLeftoverClaims } from './slice-run.js';
import { isTreeClean } from './slice-git.js';
import { syncLearnings } from './slice-learnings.js';
import { createBuildLogShare, kitTypeOf, SYNC_STATE_FILE } from './build-log-share.js';
import { curateIfDue } from './slice-curation.js';
import { queueTask, workNextTask } from './slice-tasks.js';
import { defaultAgentName, withInstanceSuffix } from './agent-name.js';
import { acquireAgentId } from './agent-lock.js';
import { redactConsole } from './redact.js';

// Backoff for calls to the platform that failed for a reason on its side (startup).
const PLATFORM_BACKOFF = { baseMs: 2_000, capMs: 5 * 60_000 };

// ── HTTP helpers ──────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${body}`);
    this.status = status;
  }
}

// Every fetchJSON call authenticates with the platform API token (x-token), and a 401 for it
// always means that token is missing, invalid or revoked (see requireApiToken on the
// platform) — no retry or wait can fix that, so the first one ends the process with a message
// saying what to fix. (The alive-ping, on the short-lived realtime token, doesn't come
// through here: a 401 there just means that token needs refreshing.)
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    console.error(`[agent] 401 from ${new URL(url).pathname} — the token was rejected: ${await res.text()}`);
    console.error('[agent] Check the token in .eventmodelers/config.json (or EVENTMODELERS_TOKEN) — shutting down');
    process.exit(1);
  }
  if (!res.ok) throw new HttpError(res.status, await res.text());
  return res.json();
}

// Startup can't wait for a person to notice a platform blip: a 429, a 5xx or a request that
// never got an answer is retried with backoff until it goes through. Any other 4xx is a real
// answer and goes straight back (a 401 has already ended the process in fetchJSON).
function isTransient(err) {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // fetch() rejects with a TypeError when there's no response at all (DNS, refused, reset),
  // and with a TimeoutError/AbortError from an AbortSignal.timeout.
  return err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

async function retryTransient(label, fn, { sleepFn = sleep } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err)) throw err;
      const delay = backoffMs(attempt, PLATFORM_BACKOFF);
      console.warn(`[agent] ${label} failed (attempt ${attempt}: ${err.message}) — retrying in ${Math.round(delay / 1000)}s`);
      await sleepFn(delay);
    }
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

// Config is resolved by walking from the kit dir up through every ancestor
// directory's .eventmodelers/config.json, merging fields as we go — a value
// set by a closer (more specific) directory always wins over a farther one.
// The walk stops as soon as the merged config has full connection credentials
// (see hasCredentials); anthropicBaseUrl/model are picked up opportunistically
// along the way but never force the walk to continue further up.
function* configCandidates(kitDir) {
  yield join(kitDir, '.eventmodelers', 'config.json');
  let dir = dirname(kitDir);
  while (true) {
    yield join(dir, '.eventmodelers', 'config.json');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last resort: the walk above only passes through $HOME if the project happens
  // to live under it. A project outside $HOME (e.g. /tmp/foo) never sees it, so
  // check it explicitly — this is where `eventmodelers init-config --global` writes
  // account-wide defaults (organizationId/token) shared across every project.
  yield join(homedir(), '.eventmodelers', 'config.json');
}

const ENV_CONFIG_MAP = {
  EVENTMODELERS_ORGANIZATION_ID: 'organizationId',
  EVENTMODELERS_BOARD_ID: 'boardId',
  EVENTMODELERS_TOKEN: 'token',
  EVENTMODELERS_BASE_URL: 'baseUrl',
  EVENTMODELERS_ANTHROPIC_BASE_URL: 'anthropicBaseUrl',
  EVENTMODELERS_MODEL: 'model',
  EVENTMODELERS_SUBAGENT_MODEL: 'subagentModel',
  EVENTMODELERS_AGENT_NAME: 'agentName',
  EVENTMODELERS_POCKETBASE_URL: 'pocketbaseUrl',
};

function loadLocalConfig(kitDir) {
  const merged = {};
  const sources = [];

  for (const candidate of configCandidates(kitDir)) {
    if (sources.includes(candidate) || !existsSync(candidate)) continue;
    let cfg;
    try {
      cfg = JSON.parse(readFileSync(candidate, 'utf-8'));
    } catch {
      console.warn(`[ralph] Skipping invalid config at ${candidate}`);
      continue;
    }
    for (const [key, value] of Object.entries(cfg)) {
      if (merged[key] === undefined) merged[key] = value;
    }
    sources.push(candidate);
    if (hasCredentials(merged)) break;
  }

  // EVENTMODELERS_* env vars win over any config.json, as they do for the CLI's own commands —
  // a container gets its credentials this way, and a stale file in a mounted project must not beat them.
  for (const [envVar, field] of Object.entries(ENV_CONFIG_MAP)) {
    if (process.env[envVar]) merged[field] = process.env[envVar];
  }
  if (process.env.BASE_URL) merged.baseUrl = process.env.BASE_URL;
  else if (!merged.baseUrl) merged.baseUrl = 'https://api.eventmodelers.ai';

  if (sources.length > 1) {
    console.log(`[ralph] Merged config from: ${sources.join(', ')}`);
  } else if (sources.length === 1 && sources[0] !== join(kitDir, '.eventmodelers', 'config.json')) {
    console.log(`[ralph] Using credentials from ${sources[0]}`);
  } else if (sources.length === 0) {
    console.warn(`[ralph] Note: no .eventmodelers/config.json found — platform sync disabled.`);
    console.warn(`        To enable board sync, follow: https://app.eventmodelers.ai/documentation#build`);
    console.warn(`        Code generation from local slice definitions will still run.`);
  }

  return merged;
}

function hasCredentials(cfg) {
  return !!(cfg.token && cfg.organizationId && cfg.boardId && cfg.baseUrl);
}

// Distinguishes this agent process from any other agent pinging the same
// token/board — e.g. a build-kit and a modeling-kit install in the same project
// share one root config.json, and without a per-agent id both would upsert the
// same alive row and race each other. The platform already keys the alive-ping
// on the (agent_type, agent_id) pair, so one shared file works: agentIds is
// namespaced by agentType (BUILD/MODELING/...) inside the project ROOT
// .eventmodelers/config.json — the same file credentials already live in —
// instead of each kit dir keeping its own separate config.json. Falls back to
// a pre-existing kit-local agentId (older installs, before this consolidation)
// so an upgrade doesn't mint a new identity the platform hasn't seen before.
function ensureAgentId(kitDir, agentType) {
  const rootConfigPath = join(dirname(kitDir), '.eventmodelers', 'config.json');
  let rootCfg = {};
  if (existsSync(rootConfigPath)) {
    try {
      rootCfg = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));
    } catch {
      console.warn(`[ralph] Skipping invalid config at ${rootConfigPath}`);
    }
  }
  rootCfg.agentIds = rootCfg.agentIds || {};
  if (rootCfg.agentIds[agentType]) return rootCfg.agentIds[agentType];

  const legacyKitConfigPath = join(kitDir, '.eventmodelers', 'config.json');
  let legacyAgentId;
  if (existsSync(legacyKitConfigPath)) {
    try {
      legacyAgentId = JSON.parse(readFileSync(legacyKitConfigPath, 'utf-8')).agentId;
    } catch {
      console.warn(`[ralph] Skipping invalid config at ${legacyKitConfigPath}`);
    }
  }

  const agentId = legacyAgentId || randomUUID();
  rootCfg.agentIds[agentType] = agentId;
  mkdirSync(dirname(rootConfigPath), { recursive: true });
  writeFileSync(rootConfigPath, JSON.stringify(rootCfg, null, 2));
  return agentId;
}

// `x-agent-id` on every platform call this loop makes, when it knows its own agent id (see
// ensureAgentId above / RALPH_AGENT_ID). The heartbeat says this agent is alive; the header says
// which calls are its, so its board writes are attributed to it and a prompt the user addressed
// to one preferred agent is only ever claimed by that agent.
function agentIdOf(cfg) {
  return cfg?.agentId || process.env.RALPH_AGENT_ID || process.env.EVENTMODELERS_AGENT_ID || '';
}

function agentHeaders(cfg) {
  const agentId = agentIdOf(cfg);
  return agentId ? { 'x-agent-id': agentId } : {};
}

// What every slice-state event is stamped with: this agent, its type (this loop builds unless told otherwise) and the
// organization and board it runs against.
function eventMeta(cfg) {
  return { agent_id: agentIdOf(cfg), agent_type: cfg?.agentType ?? 'BUILD', organization_id: cfg?.organizationId, board_id: cfg?.boardId };
}

async function fetchPlatformConfig(local) {
  const remote = await fetchJSON(`${local.baseUrl}/api/config`, {
    headers: { 'x-token': local.token, ...agentHeaders(local) },
  });
  // A client-side pocketbaseUrl (EVENTMODELERS_POCKETBASE_URL / config.json) beats the server's:
  // on-prem the server may advertise its internal docker address (http://pocketbase:8090) that a
  // remote agent cannot reach.
  return { ...local, ...remote, ...(local.pocketbaseUrl ? { pocketbaseUrl: local.pocketbaseUrl } : {}) };
}

// ── Realtime agent ────────────────────────────────────────────────────────────

async function getRealtimeToken(cfg) {
  const { token } = await fetchJSON(
    `${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/realtime-token`,
    { headers: { 'x-token': cfg.token, ...agentHeaders(cfg) } },
  );
  return token;
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export async function fetchAndPersistSlices(cfg, kitDir) {
  const url = `${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata/slices`;
  const { slices } = await fetchJSON(url, {
    headers: { 'x-token': cfg.token, ...agentHeaders(cfg) },
  });
  const slicesDir = join(kitDir, '.slices');
  mkdirSync(slicesDir, { recursive: true });

  // The board's status is an observation, not the truth for the local files: while a build holds a claim
  // a refresh that still shows InProgress must not revert the outcome the agent recorded. The status
  // written below is the log's (statusOf), which falls back to the board's for slices it knows nothing of.
  const meta = eventMeta(cfg);
  const state = observeBoard(kitDir, slices, meta, adoptAgentEdits(kitDir, fold(readEvents(kitDir)), meta));

  // Group by context slug
  const contexts = {};
  for (const slice of slices) {
    const contextSlug = slice.contextName ? slugify(slice.contextName) : 'default';
    if (!contexts[contextSlug]) contexts[contextSlug] = { name: slice.contextName || 'default', slices: [] };
    contexts[contextSlug].slices.push(slice);
  }

  // current_context.json is the context being worked on. Keep it here while it exists; the
  // run loop (getFirstPlannedSlice) advances it when that context has no planned work left.
  const ctxPath = join(slicesDir, 'current_context.json');
  let activeCtx = null;
  if (existsSync(ctxPath)) {
    try { activeCtx = JSON.parse(readFileSync(ctxPath, 'utf-8')).name; } catch {}
  }
  if (!activeCtx || !contexts[activeCtx]) {
    // First run (or the current context disappeared): seed with a context that
    // has planned work, else the first one. This is the ONLY place we choose it.
    const pickup = statusKey(readPickupStatus(kitDir));
    const plannedCtx = Object.keys(contexts).find(c => contexts[c].slices.some(s => statusKey(s.status) === pickup));
    activeCtx = plannedCtx || Object.keys(contexts)[0] || 'default';
    writeFileSync(ctxPath, JSON.stringify({ name: activeCtx }, null, 2), 'utf-8');
  }

  // Write per-context index.json and per-slice slice.json.
  //
  // This endpoint (`/slicedata/slices`) is the CHEAP summary one — `{ id, title, status }`
  // only, no commands/events/specifications/codeGen prompts. Its whole job here is to keep
  // `status` fresh so the loop's pickup (getFirstPlannedSlice) sees live transitions; it must
  // NEVER clobber the richer slice.json a full fetch (`/load-slice`, `eventmodelers fetch`,
  // `eventmodelers listen`) already wrote for the same slice. So every write below merges
  // onto whatever's already on disk — spreading the existing object first, the fresh summary
  // fields second — instead of replacing it wholesale.
  for (const [contextSlug, { slices: ctxSlices }] of Object.entries(contexts)) {
    const contextDir = join(slicesDir, contextSlug);
    mkdirSync(contextDir, { recursive: true });

    const indexPath = join(contextDir, 'index.json');
    const existingIndex = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf-8')) : { slices: [] };
    const existingById = new Map((existingIndex.slices ?? []).map((e) => [e.id, e]));

    const indexSlices = ctxSlices.map((s, i) => {
      const folder = (s.title ?? s.id).replaceAll(' ', '').toLowerCase();
      const existing = existingById.get(s.id);
      return {
        ...existing,
        id: s.id,
        slice: s.title,
        index: i,
        contextName: s.contextName || contextSlug,
        contextSlug,
        folder,
        status: statusOf(state, s),
        definition: { ...existing?.definition, id: s.id, title: s.title, status: statusOf(state, s) },
      };
    });
    writeFileSync(indexPath, JSON.stringify({ slices: indexSlices }, null, 2), 'utf-8');

    for (const slice of ctxSlices) {
      const folder = (slice.title ?? slice.id).replaceAll(' ', '').toLowerCase();
      const sliceDir = join(contextDir, folder);
      mkdirSync(sliceDir, { recursive: true });
      const sliceJsonPath = join(sliceDir, 'slice.json');
      const existingSlice = existsSync(sliceJsonPath) ? JSON.parse(readFileSync(sliceJsonPath, 'utf-8')) : {};
      // The summary omits ticketNumber, assignee and features when the slice has none, so a cleared one must be cleared
      // here too — otherwise the old one survives the merge and lands on the next build.
      writeFileSync(sliceJsonPath, JSON.stringify({ ...existingSlice, ...slice, status: statusOf(state, slice), ticketNumber: slice.ticketNumber ?? null, assignee: slice.assignee ?? null, features: slice.features ?? null }, null, 2), 'utf-8');
    }
  }

  // Blocked notes (reason, time) follow the log too; a no-op when nothing changed.
  projectStatus(kitDir, state);

  console.log(`[agent] Persisted ${slices.length} slice(s)`);
}

// The summary refresh above leaves slice.json as an id/title/status stub, and a build agent that
// reads a stub reports the slice as empty. So before a slice is handed to an agent — a Planned
// build or a queued task — its full definition (elements, fields, specifications) is fetched
// here and merged in. Best effort: on failure the agent still has /load-slice to fall back on.
async function fetchFullSlice(cfg, kitDir, sliceId) {
  if (!sliceId) return;
  const slicesDir = join(kitDir, '.slices');
  try {
    let entry = null;
    for (const ctx of readdirSync(slicesDir, { withFileTypes: true })) {
      if (!ctx.isDirectory()) continue;
      const indexPath = join(slicesDir, ctx.name, 'index.json');
      if (!existsSync(indexPath)) continue;
      const found = (JSON.parse(readFileSync(indexPath, 'utf-8')).slices ?? []).find((e) => e.id === sliceId);
      if (found) { entry = { ...found, contextSlug: found.contextSlug ?? ctx.name }; break; }
    }
    if (!entry) return;
    const query = new URLSearchParams({ contextName: entry.contextName, sliceId });
    const url = `${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata?${query}`;
    const { slices } = await fetchJSON(url, { headers: { 'x-token': cfg.token, ...agentHeaders(cfg) } });
    const full = slices?.find((sl) => sl.id === sliceId);
    if (!full) return;
    const sliceJsonPath = join(slicesDir, entry.contextSlug, entry.folder, 'slice.json');
    const existing = existsSync(sliceJsonPath) ? JSON.parse(readFileSync(sliceJsonPath, 'utf-8')) : {};
    mkdirSync(dirname(sliceJsonPath), { recursive: true });
    writeFileSync(sliceJsonPath, JSON.stringify({ ...existing, ...full }, null, 2), 'utf-8');
  } catch (err) {
    console.log(`[ralph] full slice fetch failed for ${sliceId} (${err.message}) — the agent will have to /load-slice it`);
  }
}

async function handleSliceChanged(payload, cfg, kitDir) {
  console.log(`[agent] slice:changed — slice="${payload.sliceTitle ?? payload.sliceId}" status="${payload.sliceStatus}"`);
  // This agent's own status writes (claim → InProgress, → Done, → Blocked) come straight back
  // as slice:changed. Queuing them only buys a turn in which the agent reads its own echo and
  // skips it, and re-reading the slices for them is wasted too: ralphLoop re-reads them right
  // after every turn anyway. Attribution decides, never a guess: only an agentId equal to ours
  // is dropped — a person's edit or another agent's, or an event with no attribution at all,
  // is still handled, so a missing field degrades to queuing rather than losing work.
  if (payload?.agentId && cfg.agentId && payload.agentId === cfg.agentId) {
    console.log(`[agent] Own write — not queued (slice="${payload.sliceTitle ?? payload.sliceId}" status="${payload.sliceStatus}")`);
    return;
  }
  await fetchAndPersistSlices(cfg, kitDir).catch((err) =>
    console.error('[agent] Slice persist error:', err),
  );
  // Slices in the kit's pickup status (Planned, or Waiting for UI kits) are handled by
  // onPlannedSlice directly — no task needed.
  if (statusKey(payload.sliceStatus) !== statusKey(readPickupStatus(kitDir))) {
    try {
      queueTask({ kitDir, payload, meta: eventMeta(cfg) });
      console.log(`[agent] Task queued — slice="${payload.sliceTitle ?? payload.sliceId}" status="${payload.sliceStatus}"`);
    } catch (err) {
      console.error('[agent] queueTask error:', err);
    }
  }
}

// createAdapter is the realtime transport factory — injectable so the channel handling can be
// tested against a fake transport.
async function startRealtimeAgent(cfg, kitDir, { agentType = 'BUILD', createAdapter = createRealtimeAdapter } = {}) {
  let realtimeToken = await retryTransient('getRealtimeToken', () => getRealtimeToken(cfg));

  await fetchAndPersistSlices(cfg, kitDir).catch((err) =>
    console.error('[agent] Initial slice fetch error:', err),
  );

  const channelName = `board:${cfg.boardId}-slicechanged`;
  const realtime = await createAdapter(cfg, realtimeToken);

  // Shared by the scheduled timer, a CHANNEL_ERROR/TIMED_OUT subscribe status, and a
  // 401 from the alive-ping — whichever notices the token is bad first wins; the rest
  // just await the same in-flight refresh instead of firing duplicate mint requests.
  const ts = () => new Date().toISOString();
  let refreshing = null;
  const refreshToken = (reason) => {
    if (!refreshing) {
      const startedAt = Date.now();
      console.log(`[agent] ${ts()} Refreshing realtime token (reason: ${reason})...`);
      refreshing = (async () => {
        try {
          realtimeToken = await getRealtimeToken(cfg);
          await realtime.setAuth(realtimeToken);
          console.log(`[agent] ${ts()} Token refreshed (reason: ${reason}, took ${Date.now() - startedAt}ms)`);
        } catch (err) {
          console.error(`[agent] ${ts()} Token refresh FAILED (reason: ${reason}):`, err);
          throw err;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  };

  // A channel that errors (often a stale token) needs a fresh token AND a new join —
  // keepSubscribed does both, with backoff, for as long as it takes. (A revoked token ends
  // the process anyway: refreshToken's fetch gets the 401.)
  keepSubscribed(realtime, channelName, {
    // A kill names exactly one agent: {type: 'kill', id: '<agentId>', instruction: 'exit'}.
    // Anything that doesn't name this agent is ignored — a broadcast reaches every agent on
    // the board, and the older signal (the bare string "Exit") took all of them down at once.
    // That string form is gone for good, not just unhandled: Supabase's broadcast API rejects
    // a non-object payload with 422, so it never actually arrived here.
    message: (payload) => {
      if (payload?.type !== 'kill' || payload?.id !== cfg.agentId) return;
      console.log(`[agent] ${ts()} Received kill (instruction: ${payload.instruction ?? 'exit'}) — shutting down`);
      process.exit(0);
    },
    'slice:changed': (payload) => handleSliceChanged(payload, cfg, kitDir),
  }, {
    log: (msg) => console.log(`[agent] ${ts()} ${msg}`),
    refreshToken,
    onSubscribed: ({ recovered }) => {
      if (!recovered) return;
      // Broadcasts sent while the channel was down are gone. Re-read the slices once so a
      // slice set to Planned during the gap still gets built — .slices/ is what ralphLoop
      // picks Planned work from.
      fetchAndPersistSlices(cfg, kitDir).catch((err) =>
        console.error(`[agent] ${ts()} Slice re-fetch after reconnect failed:`, err),
      );
    },
  });

  setInterval(() => {
    refreshToken('scheduled 10min refresh').catch((err) => console.error(`[agent] ${ts()} Scheduled token refresh failed:`, err));
  }, 10 * 60 * 1000);

  let lastPingFailed = false;
  const ping = async () => {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/agent-alive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${realtimeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cfg.token, board_id: cfg.boardId, agent_type: agentType, agent_id: cfg.agentId, ...(cfg.agentName ? { agent_name: cfg.agentName } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(`[agent] ${ts()} Ping failed: ${res.status} ${await res.text().catch(() => '')}`);
        lastPingFailed = true;
        if (res.status === 401) {
          await refreshToken('ping-401').catch((err) => console.error(`[agent] ${ts()} Token refresh after 401 ping failed:`, err));
        }
        return;
      }
      if (lastPingFailed) console.log(`[agent] ${ts()} Ping recovered`);
      lastPingFailed = false;
    } catch (err) {
      console.error(`[agent] ${ts()} Ping error:`, err);
      lastPingFailed = true;
    }
  };
  await ping();
  setInterval(ping, 15_000);
}

// ── Ralph loop ────────────────────────────────────────────────────────────────

// The slice status this kit claims work from. A stack declares it in `lib/kit.json`
// ({ "pickupStatus": "Waiting" } for the UI kits, which build what a backend kit handed over);
// absent means "Planned", the backend default. `run --status-trigger <status>` (RALPH_STATUS_TRIGGER)
// overrides either for that run.
// `Handover` was renamed `Waiting`; a kit.json or --status-trigger written before that still says it,
// and a board served by an older platform still reports it.
const canonicalStatus = (s) => (statusKey(s) === 'waiting' ? 'Waiting' : s);

export function readPickupStatus(kitDir) {
  const override = (process.env.RALPH_STATUS_TRIGGER || '').trim();
  if (override) return canonicalStatus(override);
  try {
    const s = JSON.parse(readFileSync(join(kitDir, 'lib', 'kit.json'), 'utf-8')).pickupStatus;
    if (typeof s === 'string' && s.trim()) return canonicalStatus(s.trim());
  } catch {}
  return 'Planned';
}

// `run --feature <name>` (RALPH_FEATURE): only slices that belong to this feature are picked up.
// Matched like the board does — trimmed, case-insensitive. Empty means no filter.
export function readFeatureFilter() {
  return (process.env.RALPH_FEATURE || '').trim().toLowerCase();
}

// Whether a slice is in the feature — its `features` as of the last fetch, from its slice.json. A slice
// whose slice.json is missing or has no features is not in any feature, so a filter skips it.
export function sliceInFeature(kitDir, ctx, folder, feature) {
  if (!feature) return true;
  if (!folder) return false;
  try {
    const { features } = JSON.parse(readFileSync(join(kitDir, '.slices', ctx, folder, 'slice.json'), 'utf-8'));
    return Array.isArray(features) && features.some((f) => typeof f === 'string' && f.trim().toLowerCase() === feature);
  } catch {
    return false;
  }
}

function readCurrentContext(kitDir) {
  const ctxPath = join(kitDir, '.slices', 'current_context.json');
  if (!existsSync(ctxPath)) return null;
  try { return JSON.parse(readFileSync(ctxPath, 'utf-8')).name || null; } catch { return null; }
}

// The slice's ticket and assignee as of the last fetch, from its slice.json — a build carries the ones the slice is
// built under, since both can change between builds. Either is null when the slice has none.
function readSliceMeta(kitDir, ctx, folder) {
  const none = { ticketNumber: null, assignee: null };
  if (!folder) return none;
  try {
    const slice = JSON.parse(readFileSync(join(kitDir, '.slices', ctx, folder, 'slice.json'), 'utf-8'));
    return { ticketNumber: slice.ticketNumber ?? null, assignee: slice.assignee ?? null };
  } catch {
    return none;
  }
}

// Returns the first Planned slice, preferring the current context so a context is finished
// before the next one starts. When the current context has no planned work, the first other
// context that does becomes the current one (current_context.json is rewritten), so a slice
// set to Planned in any context is eventually built. Ids in `skipIds` are passed over.
export function getFirstPlannedSlice(kitDir, skipIds = new Set()) {
  const slicesDir = join(kitDir, '.slices');
  const currentCtx = readCurrentContext(kitDir);
  let others = [];
  try {
    others = readdirSync(slicesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {}
  const pickup = statusKey(readPickupStatus(kitDir));
  const feature = readFeatureFilter();
  const candidates = [...(currentCtx ? [currentCtx] : []), ...others.filter((c) => c !== currentCtx)];
  for (const ctx of candidates) {
    const indexPath = join(slicesDir, ctx, 'index.json');
    if (!existsSync(indexPath)) continue;
    try {
      const { slices } = JSON.parse(readFileSync(indexPath, 'utf-8'));
      const planned = slices && slices.find((s) => statusKey(s.status) === pickup && !skipIds.has(s.id) && sliceInFeature(kitDir, ctx, s.folder, feature));
      if (!planned) continue;
      if (ctx !== currentCtx) {
        writeFileSync(join(slicesDir, 'current_context.json'), JSON.stringify({ name: ctx }, null, 2), 'utf-8');
        console.log(`[ralph] No planned slices in context "${currentCtx}" — switching to "${ctx}".`);
      }
      return { id: planned.id ?? null, title: planned.slice || planned.id || null, ctx, ...readSliceMeta(kitDir, ctx, planned.folder) };
    } catch {}
  }
  return null;
}

// Ids of every slice currently waiting for pickup, across all contexts.
function listPlannedIds(kitDir) {
  const slicesDir = join(kitDir, '.slices');
  const pickup = statusKey(readPickupStatus(kitDir));
  const feature = readFeatureFilter();
  const ids = new Set();
  try {
    for (const d of readdirSync(slicesDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      try {
        const { slices } = JSON.parse(readFileSync(join(slicesDir, d.name, 'index.json'), 'utf-8'));
        for (const s of slices ?? []) if (statusKey(s.status) === pickup && sliceInFeature(kitDir, d.name, s.folder, feature)) ids.add(s.id);
      } catch {}
    }
  } catch {}
  return ids;
}

// If the exact same Planned slice (by id) has been built this many times without its status ever leaving "Planned", onPlannedSlice is stuck on
// it — declining to build it, or building it but its own status change keeps
// getting reverted (e.g. a failed check). Rather than retry it forever (or
// crash the whole loop, which would take down every other slice with it),
// mark it Blocked with a note explaining why and move on to other work.
// Critical for unsupervised/CI runs, which have no human watching to notice
// a stall. Configurable for teams that want more slack.
const MAX_PLANNED_ATTEMPTS = Number(process.env.RALPH_MAX_PLANNED_ATTEMPTS) || 5;

// After this many builds that left a slice Planned, the loop builds any other Planned slice first
// and comes back to the stuck one only when nothing else is waiting (until MAX_PLANNED_ATTEMPTS).
const SWITCH_AFTER_ATTEMPTS = Math.min(2, MAX_PLANNED_ATTEMPTS);

// Marks a stuck slice Blocked (locally, and on the board if credentialed) and
// records why, so the loop can move on instead of looping or exiting.
// `lastReply` is the build agent's final message on the last attempt (when the runner reports one),
// so the note says what actually happened instead of only listing what might have.
export async function blockStuckSlice(kitDir, cfg, credentialed, planned, attempts, lastReply) {
  const now = new Date().toISOString();
  const reason = `Ralph loop picked up this slice ${attempts} times in a row without its status ever leaving ` +
    `"Planned" — the build agent kept declining to build it, or kept building it but its own status change kept ` +
    `getting reverted (e.g. a failed check). Auto-blocked to stop the loop from retrying it forever.` +
    (lastReply ? ` Build agent's last reply: "${String(lastReply).replace(/\s+/g, ' ').trim().slice(0, 500)}"` : '');

  // The status lives in the event log; index.json / slice.json show it (and the note) as a projection.
  recordEvent(kitDir, { type: 'blocked', slice: planned.id, reason, at: now }, eventMeta(cfg));

  // Best-effort: also reflect Blocked on the board itself so a synced fetch
  // doesn't just pull "Planned" back down over our local fix. Never fatal —
  // this loop must keep going locally even if the board call fails.
  if (credentialed) {
    try {
      await fetchJSON(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-user-id': 'ralph-loop', ...agentHeaders(cfg) },
        body: JSON.stringify([{
          id: randomUUID(),
          eventType: 'node:changed',
          nodeId: planned.id,
          boardId: cfg.boardId,
          timestamp: Date.now(),
          changedAttributes: ['sliceStatus'],
          meta: { type: 'SLICE_BORDER', sliceStatus: 'Blocked' },
        }]),
      });
    } catch (err) {
      console.error(`[ralph] Failed to sync Blocked status to the board:`, err.message);
    }
  }

  // Always leave a comment on the slice saying why it was blocked — a Blocked slice with no
  // explanation is a dead end for whoever finds it. Its own try block, so a failed status sync
  // above can't skip it; without credentials there is no board to comment on, so say so loudly.
  if (credentialed) {
    try {
      await fetchJSON(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes/${planned.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-user-id': 'ralph-loop', ...agentHeaders(cfg) },
        body: JSON.stringify({ text: `Slice "${planned.title}" was auto-blocked by the Ralph loop. ${reason}`, type: 'COMMENT', author: 'ralph-loop' }),
      });
    } catch (err) {
      console.error(`[ralph] Failed to post the auto-block comment on "${planned.title}" — the reason is only on its blocked event:`, err.message);
    }
  } else {
    console.error(`[ralph] No board credentials — could not comment on "${planned.title}"; the reason is only on its blocked event.`);
  }

  console.error(`[ralph] ${reason} Marked "${planned.title}" (id=${planned.id}) as Blocked — moving on.`);
}

// Returns true once fn succeeds (fn's own result is the caller's to capture); false for a turn that timed out (see lib/turn.js). A timeout
// is not retried in place: re-running the same hung turn every 60s would spin forever without
// the stuck-slice guard ever seeing it, so it goes back to ralphLoop, which recounts the slice.
// Any other failure is retried in place, with backoff (30s → 10min) so a harness that keeps
// failing fast (API outage, rate limit, broken install) isn't relaunched in a tight loop.
async function runWithRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`[ralph] ${label}`);
      await fn();
      return true;
    } catch (err) {
      if (err?.timedOut) {
        console.error(`[ralph] ${err.message} — back to the loop`);
        return false;
      }
      const delay = backoffMs(attempt, { baseMs: 30_000, capMs: 10 * 60_000 });
      console.error(`[ralph] Error (attempt ${attempt}) — retrying in ${Math.round(delay / 1000)}s:`, err.message);
      await sleep(delay);
    }
  }
}

// prompt.md and backend-prompt.md are instruction manuals with no request in them. Handed one
// alone, the agent read it as background, answered "what would you like me to help with?" with
// no tool calls, and a Planned slice stayed Planned until the stuck-slice guard blocked it. So
// every turn ends with the concrete request — here, once, for every runner.
// Whether a backend kit finishes UI-bearing slices at `Waiting` instead of `Done`: this run's
// `run --handover` (RALPH_HANDOVER) over the project's `handover` setting in config.json.
export function resolveHandover(cfg) {
  return process.env.RALPH_HANDOVER === '1' || cfg?.handover === true;
}

// The board as the slice-state shell sees it. Slice status on the board is the loop's job, not the build
// agent's: the loop claims a slice (InProgress) before the build and pushes the outcome afterwards.
// Transient failures (network, 429, 5xx) are retried until they go through; a 4xx is a real rejection
// (e.g. the move-into-same-status guard that lets two agents race for one slice) and surfaces.
export function createBoard(cfg) {
  const base = `${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
  return {
    async setStatus(sliceId, status) {
      let attempts = 0;
      await retryTransient(`set "${status}" on slice ${sliceId}`, async () => {
        attempts++;
        try {
          await fetchJSON(`${base}/nodes/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-user-id': 'ralph-loop', ...agentHeaders(cfg) },
            body: JSON.stringify([{
              id: randomUUID(),
              eventType: 'node:changed',
              nodeId: sliceId,
              boardId: cfg.boardId,
              timestamp: Date.now(),
              changedAttributes: ['sliceStatus'],
              meta: { type: 'SLICE_BORDER', sliceStatus: status },
            }]),
          });
        } catch (err) {
          // An earlier attempt may have landed with its response lost; the same-status guard then
          // rejects the retry. A genuine lost race is rejected on the first attempt, so only a 4xx
          // on a retry is forgiven.
          if (attempts > 1 && err instanceof HttpError && err.status >= 400 && err.status < 500) return;
          throw err;
        }
      });
    },
    async readStatus(sliceId) {
      const { slices } = await retryTransient(`read slices of board ${cfg.boardId}`, () => fetchJSON(`${base}/slicedata/slices`, {
        headers: { 'x-token': cfg.token, ...agentHeaders(cfg) },
      }));
      return slices.find((sl) => sl.id === sliceId)?.status ?? null;
    },
  };
}

function taskRequest(planned = null, cfg = null, pickupStatus = 'Planned', queued = null) {
  const task = planned
    ? `build the ${pickupStatus} slice "${planned.title}" (id=${planned.id}, context="${planned.ctx}")`
    : `process this queued task (id=${queued?.id}) — the slice change that queued it: ${JSON.stringify(queued?.payload ?? {})}`;
  // Stated explicitly so the agent never has to work it out from config.json: this run's effective
  // value, which is what the `ui-contract` skill (Step 4) follows. UI kits (pickup Waiting) ignore it.
  const handover = planned && statusKey(pickupStatus) !== 'waiting' ? `\nHandover: ${resolveHandover(cfg) ? 'on' : 'off'}\n` : '';
  return `\n\n---\n\nYour task now: ${task}, following the instructions above. Start immediately.\n${handover}`;
}

// The slice-state event store (events/, events.log) holds pids and claims of this checkout and must never be
// versioned. AGENTS.md is rendered from the learning events and adopts what a merge brings in, so where it
// is tracked, two branches that both regenerated it should keep both sides' lines rather than conflict:
// `merge=union`. The rules go in .git/info/exclude and .git/info/attributes: local to this clone, never
// tracked, so the loop does not dirty the working tree it is about to judge (a dirty tree at claim time is
// taken for a person's own work and is never discarded). Idempotent; best effort.
function ensureLearningsGitRules(kitDir) {
  const projectDir = dirname(kitDir);
  if (!existsSync(join(projectDir, '.git'))) return;
  const rules = [
    ['info/exclude', [`${basename(kitDir)}/events/`, `${basename(kitDir)}/events.log`, `${basename(kitDir)}/events.seq`, `${basename(kitDir)}/${SYNC_STATE_FILE}`]],
    ['info/attributes', [`${basename(kitDir)}/AGENTS.md merge=union`]],
  ];
  for (const [name, lines] of rules) {
    try {
      // `--git-path` also resolves for a worktree, where .git is a file.
      const path = join(projectDir, execFileSync('git', ['rev-parse', '--git-path', name], { cwd: projectDir, encoding: 'utf-8' }).trim());
      mkdirSync(dirname(path), { recursive: true });
      const current = existsSync(path) ? readFileSync(path, 'utf-8') : '';
      const have = new Set(current.split('\n').map((l) => l.trim()));
      const missing = lines.filter((l) => !have.has(l));
      if (!missing.length) continue;
      writeFileSync(path, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`, 'utf-8');
      console.log(`[ralph] Added to .git/${name}: ${missing.join(', ')}`);
    } catch (err) {
      console.error(`[ralph] Could not update .git/${name}:`, err.message);
    }
  }
}

async function ralphLoop(kitDir, cfg, onTask, onPlannedSlice, localOnly = false, onCurate = null) {
  const promptFile = join(kitDir, 'lib', 'prompt.md');
  const backendPromptFile = join(kitDir, 'lib', 'backend-prompt.md');
  // --local must mean zero board contact even when .eventmodelers/config.json
  // happens to hold valid credentials — never let a locally-present token flip
  // this back on.
  const credentialed = !localOnly && hasCredentials(cfg);
  const board = credentialed ? createBoard(cfg) : null;
  const meta = eventMeta(cfg);
  ensureLearningsGitRules(kitDir);
  if (readFeatureFilter()) console.log(`[ralph] --feature "${process.env.RALPH_FEATURE.trim()}" — only slices of that feature are picked up.`);
  // Sharing the event log with the board (`run --sync`): needs the board, so never with --local.
  const share = createBuildLogShare({ kitDir, cfg, meta, agentType: cfg?.agentType ?? 'BUILD', kitType: kitTypeOf(readPickupStatus(kitDir)), sync: process.env.RALPH_SYNC === '1', enabled: credentialed, log: (line) => console.log(`[ralph] ${line}`) });
  if (process.env.RALPH_SYNC === '1' && !credentialed) console.log('[ralph] --sync needs board credentials — the build log stays local.');
  share.start();
  let lastIdleCtx;
  // The build agent's final reply on the most recent planned-slice turn — quoted in the Blocked note.
  let lastReply = null;

  while (true) {
    let didWork = false;

    // A claim still open here is a leftover: its process died mid-build, or settling failed last time.
    await settleLeftoverClaims({ kitDir, board, meta, pickupStatus: readPickupStatus(kitDir) });

    // AGENTS.md is the projection of the learning events; anything added to it by hand (or by a pull) is adopted first.
    syncLearnings({ kitDir, meta });
    // Enough new learnings, and no build in progress: one agent turn tidies them (merge / retract only).
    if (await curateIfDue({ kitDir, meta, onCurate })) didWork = true;

    // The oldest queued slice change, one turn at a time. The task is completed once the turn finished; one that
    // timed out stays queued and is handed out again.
    const workedTask = credentialed && await workNextTask({
      kitDir,
      meta,
      run: async (task) => {
        await fetchFullSlice(cfg, kitDir, task.payload?.sliceId);
        const prompt = readFileSync(promptFile, 'utf-8') + taskRequest(null, null, 'Planned', task);
        return runWithRetry('onTask: loading slice from board...', () => onTask(prompt));
      },
    });
    if (workedTask) {
      await fetchAndPersistSlices(cfg, kitDir).catch(() => {});
      didWork = true;
    }

    let planned = null;
    if (onPlannedSlice) {
      // Attempts are the failed builds the log holds for a slice (see MAX_PLANNED_ATTEMPTS above); they
      // survive a restart and reset once the slice moves off the status it was put back to.
      const attemptsBySlice = fold(readEvents(kitDir)).slices;
      const stuckIds = new Set([...listPlannedIds(kitDir)].filter((id) => (attemptsBySlice[id]?.attempts ?? 0) >= SWITCH_AFTER_ATTEMPTS));
      // Prefer a slice that hasn't been tried to the switch point; fall back to a stuck one.
      planned = getFirstPlannedSlice(kitDir, stuckIds) ?? (stuckIds.size ? getFirstPlannedSlice(kitDir) : null);
    }
    if (planned) {
      const attempts = fold(readEvents(kitDir)).slices[planned.id]?.attempts ?? 0;
      if (planned.id !== null && attempts >= MAX_PLANNED_ATTEMPTS) {
        await blockStuckSlice(kitDir, cfg, credentialed, planned, attempts, lastReply);
        didWork = true;
        continue;
      }

      const prompt = readFileSync(backendPromptFile, 'utf-8') + taskRequest(planned, cfg, readPickupStatus(kitDir));
      if (credentialed) await fetchFullSlice(cfg, kitDir, planned.id);
      // The iteration opens first, so the claim (→ InProgress) is part of what the board's build log shows.
      if (planned.id) share.iterationStarted(planned);
      if (planned.id) {
        const claimed = await claimSlice({ kitDir, planned, board, meta, cleanTree: isTreeClean(kitDir), pickupStatus: readPickupStatus(kitDir) });
        if (claimed !== 'won') {
          await share.iterationClosed(planned, 'skipped');
          console.log(claimed === 'held'
            ? `[ralph] Another run loop holds "${planned.title}" in this kit — waiting.`
            : `[ralph] Could not claim "${planned.title}" — skipping it this iteration.`);
          didWork = true;
          await sleep(5_000);
          continue;
        }
      }
      lastReply = null;
      const built = await runWithRetry(`onPlannedSlice: building slice "${planned.title}"...`, async () => { lastReply = await onPlannedSlice(prompt, {
        sliceId: planned.id,
        sliceTitle: planned.title,
        context: planned.ctx,
        ticketNumber: planned.ticketNumber,
        assignee: planned.assignee,
        boardId: cfg.boardId ?? null,
        attempt: attempts + 1,
      }); });
      if (built) console.log(`[ralph] Slice build complete — waiting for next slice`);
      if (planned.id) await settleSlice({ kitDir, planned, board, meta, pickupStatus: readPickupStatus(kitDir), details: { built, lastReply } });
      if (planned.id) await share.iterationClosed(planned, built ? 'ok' : 'error');
      if (credentialed) await fetchAndPersistSlices(cfg, kitDir).catch(() => {});
      didWork = true;
    }

    if (!didWork) {
      // No planned work in any context — wait.
      const ctx = readCurrentContext(kitDir);
      if (ctx !== lastIdleCtx) {
        console.log(`[ralph] No planned slices in any context — waiting.`);
        lastIdleCtx = ctx;
      }
      await sleep(10_000);
    } else {
      lastIdleCtx = undefined;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export { HttpError, eventMeta, loadLocalConfig, fetchPlatformConfig, retryTransient, startRealtimeAgent, ensureLearningsGitRules };

// The connect line a runner puts in front of every prompt. --local must mean zero board
// contact, so it is empty then — handed live credentials, the agent would treat itself as
// already connected and go straight to board sync. The token is named, never included: the
// prompt reaches the harness on its command line (visible to every local user in `ps`) and
// lands in session transcripts, so it carries $EVENTMODELERS_TOKEN — the runner puts the value
// in the child's env, connect treats the reference as the inline token, and a curl header
// written as "x-token: $EVENTMODELERS_TOKEN" expands in the shell.
export function connectHeader(cfg, localOnly) {
  return !localOnly && cfg.boardId
    ? `board=${cfg.boardId} token=$EVENTMODELERS_TOKEN org=${cfg.organizationId} baseUrl=${cfg.baseUrl}\n\n`
    : '';
}

// Who this process is. RALPH_AGENT_ID/RALPH_AGENT_NAME are `eventmodelers run --id/--name`,
// passed down as env (see cli.js's run dispatcher): a per-run identity override so a second
// agent of the same type can run side by side without the two overwriting each other's
// heartbeat row, and so the board can show a name instead of a bare uuid. An override skips
// ensureAgentId rather than overwriting it — the project's stable id stays on disk for the next
// plain run. Exported so a runner can resolve it at load time, before startRalph runs — the env
// it hands its `claude` is built then. Idempotent: ensureAgentId returns the id it persisted.
export function resolveAgentIdentity(kitDir, agentType = 'BUILD', cfg = loadLocalConfig(kitDir)) {
  // --id is the operator's choice: used as given, no lock. Otherwise the project's stable id — unless another live
  // process is already running under it, in which case this one gets a fresh id (see agent-lock.js).
  const pinned = process.env.RALPH_AGENT_ID;
  const { agentId, fellBack } = pinned
    ? { agentId: pinned, fellBack: false }
    : acquireAgentId({ lockDir: join(dirname(kitDir), '.eventmodelers', 'locks'), stableId: ensureAgentId(kitDir, agentType) });
  // --name, else the configured agentName, else the repository's name — never the bare uuid on the board. A name
  // nobody gave is marked with the instance when the id fell back, so the board does not show two of the same.
  const given = process.env.RALPH_AGENT_NAME || cfg.agentName;
  const fallback = defaultAgentName(dirname(kitDir), agentType);
  const agentName = given || (fellBack ? withInstanceSuffix(fallback, agentId) : fallback);
  process.env.EVENTMODELERS_AGENT_ID = agentId;
  return { agentId, agentName, agentType };
}

export async function startRalph({ kitDir, projectDir, onTask, onPlannedSlice, onCurate = null, agentType = 'BUILD', localOnly = false }) {
  const local = loadLocalConfig(kitDir);
  redactConsole([local.token]);
  Object.assign(local, resolveAgentIdentity(kitDir, agentType, local));

  console.log(`Ralph — kit: ${kitDir}`);
  console.log(`         project: ${projectDir}`);
  console.log(`         agent: ${local.agentName ? `${local.agentName} (${local.agentId})` : local.agentId}`);

  // localOnly (set via `eventmodelers run --local`) forces this branch even when
  // credentials are present — it skips fetchPlatformConfig's network call to
  // ${baseUrl}/api/config and startRealtimeAgent entirely, so the loop never
  // reaches out to the platform at all.
  if (localOnly || !hasCredentials(local)) {
    console.log(`         mode: local-only (no platform sync)${localOnly ? ' — forced by --local' : ''}\n`);
    await ralphLoop(kitDir, local, onTask, onPlannedSlice, localOnly, onCurate);
    return;
  }

  const cfg = await retryTransient('fetchPlatformConfig', () => fetchPlatformConfig(local));
  console.log(`         org=${cfg.organizationId}, board=${cfg.boardId}, base=${cfg.baseUrl}\n`);

  await Promise.all([
    startRealtimeAgent(cfg, kitDir, { agentType }),
    ralphLoop(kitDir, cfg, onTask, onPlannedSlice, false, onCurate),
  ]);
}
