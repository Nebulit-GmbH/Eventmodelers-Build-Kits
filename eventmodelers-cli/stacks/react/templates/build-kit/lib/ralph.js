// Common runtime for the ralph loop + board poller.
// Not meant to be run directly — use ralph-claude.js or ralph-ollama.js.
//
// This kit has no Supabase/PocketBase realtime integration and never touches a
// database table directly — board changes are picked up purely through the plain
// REST slicedata endpoint on api.eventmodelers.ai, polled on an interval (see
// "Board polling" below). If you need instant push notifications instead of
// polling, use the supabase-react stack.
//
// startRalph({ kitDir, projectDir, onTask, onPlannedSlice })
//   onTask(prompt) — called when tasks.json has entries
//   onPlannedSlice(prompt) — called when .slices/ has a "Planned" entry (omit to skip)

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${body}`);
    this.status = status;
  }
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new HttpError(res.status, await res.text());
  return res.json();
}

async function retryOn401(label, fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        if (attempt < maxRetries) {
          console.warn(`[agent] ${label} — 401, retrying (${attempt}/${maxRetries})...`);
          continue;
        }
        console.error(`[agent] ${label} — 401 after ${maxRetries} retries, shutting down`);
        process.exit(1);
      }
      throw err;
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
// token/board — e.g. a build-kit and a bridge-kit install in the same project
// share one root config.json, and without a per-agent id both would upsert the
// same alive row and race each other. The platform already keys the alive-ping
// on the (agent_type, agent_id) pair, so one shared file works: agentIds is
// namespaced by agentType (BUILD/BRIDGE/MODELING/...) inside the project ROOT
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

async function fetchPlatformConfig(local) {
  const remote = await fetchJSON(`${local.baseUrl}/api/config`, {
    headers: { 'x-token': local.token },
  });
  return { ...local, ...remote };
}

// ── Board polling ─────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function fetchAndPersistSlices(cfg, kitDir) {
  const url = `${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata/slices`;
  const { slices } = await fetchJSON(url, {
    headers: { 'x-token': cfg.token, 'x-board-id': cfg.boardId },
  });
  const slicesDir = join(kitDir, '.slices');
  mkdirSync(slicesDir, { recursive: true });

  // Group by context slug
  const contexts = {};
  for (const slice of slices) {
    const contextSlug = slice.contextName ? slugify(slice.contextName) : 'default';
    if (!contexts[contextSlug]) contexts[contextSlug] = { name: slice.contextName || 'default', slices: [] };
    contexts[contextSlug].slices.push(slice);
  }

  // current_context.json is STICKY. We work within ONE context at a time and must
  // not auto-jump to another context just because it happens to have planned work.
  // Keep the existing context if it still exists; only seed it when absent or stale.
  const ctxPath = join(slicesDir, 'current_context.json');
  let activeCtx = null;
  if (existsSync(ctxPath)) {
    try { activeCtx = JSON.parse(readFileSync(ctxPath, 'utf-8')).name; } catch {}
  }
  if (!activeCtx || !contexts[activeCtx]) {
    // First run (or the current context disappeared): seed with a context that
    // has planned work, else the first one. This is the ONLY place we choose it.
    const plannedCtx = Object.keys(contexts).find(c => contexts[c].slices.some(s => (s.status || '').toLowerCase() === 'planned'));
    activeCtx = plannedCtx || Object.keys(contexts)[0] || 'default';
    writeFileSync(ctxPath, JSON.stringify({ name: activeCtx }, null, 2), 'utf-8');
  }

  // Write per-context index.json and per-slice slice.json
  for (const [contextSlug, { slices: ctxSlices }] of Object.entries(contexts)) {
    const contextDir = join(slicesDir, contextSlug);
    mkdirSync(contextDir, { recursive: true });

    const indexSlices = ctxSlices.map((s, i) => {
      const folder = (s.title ?? s.id).replaceAll(' ', '').toLowerCase();
      return {
        id: s.id,
        slice: s.title,
        index: i,
        contextName: s.contextName || contextSlug,
        contextSlug,
        folder,
        status: s.status,
        definition: { id: s.id, title: s.title, status: s.status },
      };
    });
    writeFileSync(join(contextDir, 'index.json'), JSON.stringify({ slices: indexSlices }, null, 2), 'utf-8');

    for (const slice of ctxSlices) {
      const folder = (slice.title ?? slice.id).replaceAll(' ', '').toLowerCase();
      const sliceDir = join(contextDir, folder);
      mkdirSync(sliceDir, { recursive: true });
      writeFileSync(join(sliceDir, 'slice.json'), JSON.stringify(slice, null, 2), 'utf-8');
    }
  }

  console.log(`[agent] Persisted ${slices.length} slice(s)`);
  return slices;
}

async function writeTask(payload, kitDir) {
  const tasksPath = join(kitDir, 'tasks.json');
  const existing = existsSync(tasksPath) ? JSON.parse(readFileSync(tasksPath, 'utf-8')) : [];
  const filtered = existing.filter(t => t.payload?.sliceId !== payload.sliceId);
  const task = { id: randomUUID(), createdAt: new Date().toISOString(), payload };
  filtered.push(task);
  writeFileSync(tasksPath, JSON.stringify(filtered, null, 2), 'utf-8');
  console.log(`[agent] Task written — slice="${payload.sliceTitle}" status="${payload.sliceStatus}"`);
}

// How often to re-fetch the board's slices when idle, in ms. A slice that goes
// straight to "Planned" is picked up by onPlannedSlice's own index.json scan the
// moment fetchAndPersistSlices writes it; this diff only exists to turn any OTHER
// status change into a tasks.json entry for onTask (mirrors what a push channel's
// slice:changed event used to do, one poll tick later instead of instantly).
const POLL_INTERVAL_MS = Number(process.env.RALPH_POLL_INTERVAL_MS) || 10_000;

async function pollForChanges(cfg, kitDir, seen, queueAllStatuses) {
  const slices = await fetchAndPersistSlices(cfg, kitDir);
  for (const slice of slices) {
    const status = (slice.status || '').toLowerCase();
    const previous = seen.get(slice.id);
    seen.set(slice.id, status);
    if (previous === undefined || previous === status) continue;

    console.log(`[agent] slice changed — slice="${slice.title}" status="${slice.status}"`);
    // Planned slices are handled by onPlannedSlice directly — no task needed.
    // queueAllStatuses opts out of that split entirely (e.g. bridge has no
    // onPlannedSlice consumer, so a lingering Planned slice would otherwise
    // never naturally clear its own trigger — see lib/ralph.js callers).
    if (queueAllStatuses || status !== 'planned') {
      const payload = {
        event: 'slice:changed',
        organizationId: cfg.organizationId,
        boardId: cfg.boardId,
        sliceId: slice.id,
        sliceTitle: slice.title,
        sliceStatus: slice.status,
        timestamp: Date.now(),
      };
      await writeTask(payload, kitDir).catch((err) => console.error('[agent] writeTask error:', err));
    }
  }
}

async function startPolling(cfg, kitDir, { queueAllStatuses = false } = {}) {
  const seen = new Map();
  const initial = await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, kitDir)).catch((err) => {
    console.error('[agent] Initial slice fetch error:', err);
    return [];
  });
  for (const slice of initial) seen.set(slice.id, (slice.status || '').toLowerCase());

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    await retryOn401('pollForChanges', () => pollForChanges(cfg, kitDir, seen, queueAllStatuses)).catch((err) =>
      console.error('[agent] Poll error:', err),
    );
  }
}

// ── Ralph loop ────────────────────────────────────────────────────────────────

function hasPendingTasks(kitDir) {
  const tasksPath = join(kitDir, 'tasks.json');
  if (!existsSync(tasksPath)) return false;
  try {
    const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    return Array.isArray(tasks) && tasks.length > 0;
  } catch {
    return false;
  }
}

function readCurrentContext(kitDir) {
  const ctxPath = join(kitDir, '.slices', 'current_context.json');
  if (!existsSync(ctxPath)) return null;
  try { return JSON.parse(readFileSync(ctxPath, 'utf-8')).name || null; } catch { return null; }
}

// Returns the first Planned slice IN THE CURRENT CONTEXT ONLY. If the current
// context has no planned work, returns null so the loop waits — it must NEVER
// cross into another context to find something to build.
function getFirstPlannedSlice(kitDir) {
  const currentCtx = readCurrentContext(kitDir);
  if (!currentCtx) return null;
  const indexPath = join(kitDir, '.slices', currentCtx, 'index.json');
  if (!existsSync(indexPath)) return null;
  try {
    const { slices } = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const planned = slices && slices.find((s) => (s.status || '').toLowerCase() === 'planned');
    if (planned) return { id: planned.id ?? null, title: planned.slice || planned.id || null, ctx: currentCtx };
  } catch {}
  return null;
}

// If the exact same Planned slice (by id) comes back up this many times in a
// row without its status ever leaving "Planned", onPlannedSlice is stuck on
// it — declining to build it, or building it but its own status change keeps
// getting reverted (e.g. a failed check). Rather than retry it forever (or
// crash the whole loop, which would take down every other slice with it),
// mark it Blocked with a note explaining why and move on to other work.
// Critical for unsupervised/CI runs, which have no human watching to notice
// a stall. Configurable for teams that want more slack.
const MAX_PLANNED_ATTEMPTS = Number(process.env.RALPH_MAX_PLANNED_ATTEMPTS) || 2;

// Marks a stuck slice Blocked (locally, and on the board if credentialed) and
// records why, so the loop can move on instead of looping or exiting.
async function blockStuckSlice(kitDir, cfg, credentialed, planned, attempts) {
  const now = new Date().toISOString();
  const reason = `Ralph loop picked up this slice ${attempts} times in a row without its status ever leaving ` +
    `"Planned" — the build agent kept declining to build it, or kept building it but its own status change kept ` +
    `getting reverted (e.g. a failed check). Auto-blocked to stop the loop from retrying it forever.`;

  const indexPath = join(kitDir, '.slices', planned.ctx, 'index.json');
  let folder;
  try {
    const indexData = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const entry = (indexData.slices ?? []).find((s) => s.id === planned.id);
    if (entry) {
      entry.status = 'Blocked';
      entry.blockedReason = reason;
      entry.blockedAt = now;
      folder = entry.folder;
      writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`[ralph] Failed to write Blocked status to ${indexPath}:`, err.message);
  }

  if (folder) {
    const sliceJsonPath = join(kitDir, '.slices', planned.ctx, folder, 'slice.json');
    try {
      if (existsSync(sliceJsonPath)) {
        const sliceData = JSON.parse(readFileSync(sliceJsonPath, 'utf-8'));
        sliceData.status = 'Blocked';
        sliceData.blockedReason = reason;
        sliceData.blockedAt = now;
        writeFileSync(sliceJsonPath, JSON.stringify(sliceData, null, 2), 'utf-8');
      }
    } catch (err) {
      console.error(`[ralph] Failed to write Blocked status to ${sliceJsonPath}:`, err.message);
    }
  }

  try {
    const progressPath = join(dirname(kitDir), 'progress.txt');
    const existing = existsSync(progressPath) ? readFileSync(progressPath, 'utf-8') : '';
    const note = `\n## ${now} — Slice auto-blocked\n\nSlice: ${planned.title} (id=${planned.id}, context=${planned.ctx})\n\n- ${reason}\n---\n`;
    writeFileSync(progressPath, existing + note, 'utf-8');
  } catch (err) {
    console.error('[ralph] Failed to append progress.txt note:', err.message);
  }

  // Best-effort: also reflect Blocked on the board itself so a synced fetch
  // doesn't just pull "Planned" back down over our local fix. Never fatal —
  // this loop must keep going locally even if the board call fails.
  if (credentialed) {
    try {
      await fetchJSON(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-board-id': cfg.boardId, 'x-user-id': 'ralph-loop' },
        body: JSON.stringify([{
          id: randomUUID(),
          eventType: 'node:changed',
          nodeId: planned.id,
          boardId: cfg.boardId,
          timestamp: Date.now(),
          changedAttributes: ['sliceStatus'],
          meta: { sliceStatus: 'Blocked' },
        }]),
      });
    } catch (err) {
      console.error(`[ralph] Failed to sync Blocked status to the board:`, err.message);
    }
  }

  console.error(`[ralph] ${reason} Marked "${planned.title}" (id=${planned.id}) as Blocked — moving on.`);
}

async function runWithRetry(label, fn) {
  while (true) {
    try {
      console.log(`[ralph] ${label}`);
      await fn();
      return;
    } catch (err) {
      console.error(`[ralph] Error — retrying in 60s:`, err.message);
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

async function ralphLoop(kitDir, cfg, onTask, onPlannedSlice) {
  const promptFile = join(kitDir, 'lib', 'prompt.md');
  const backendPromptFile = join(kitDir, 'lib', 'backend-prompt.md');
  const credentialed = hasCredentials(cfg);
  let lastIdleCtx;
  // Tracks consecutive sightings of the same Planned slice id — see
  // MAX_PLANNED_ATTEMPTS above.
  let stuckSlice = { id: null, count: 0 };

  while (true) {
    let didWork = false;

    if (credentialed && hasPendingTasks(kitDir)) {
      const prompt = readFileSync(promptFile, 'utf-8');
      await runWithRetry('onTask: loading slice from board...', () => onTask(prompt));
      await fetchAndPersistSlices(cfg, kitDir).catch(() => {});
      didWork = true;
    }

    const planned = onPlannedSlice && getFirstPlannedSlice(kitDir);
    if (planned) {
      stuckSlice = planned.id !== null && planned.id === stuckSlice.id
        ? { id: stuckSlice.id, count: stuckSlice.count + 1 }
        : { id: planned.id, count: 1 };

      if (stuckSlice.count > MAX_PLANNED_ATTEMPTS) {
        await blockStuckSlice(kitDir, cfg, credentialed, planned, stuckSlice.count);
        stuckSlice = { id: null, count: 0 };
        didWork = true;
        continue;
      }

      const prompt = readFileSync(backendPromptFile, 'utf-8');
      await runWithRetry(`onPlannedSlice: building slice "${planned.title}"...`, () => onPlannedSlice(prompt));
      console.log(`[ralph] Slice build complete — waiting for next slice`);
      if (credentialed) await fetchAndPersistSlices(cfg, kitDir).catch(() => {});
      didWork = true;
    }

    if (!didWork) {
      // No planned work in the current context — wait, do NOT switch contexts.
      const ctx = readCurrentContext(kitDir);
      if (ctx !== lastIdleCtx) {
        console.log(`[ralph] No planned slices in current context "${ctx}" — waiting. Switch context on the board to continue.`);
        lastIdleCtx = ctx;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    } else {
      lastIdleCtx = undefined;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export { loadLocalConfig, fetchPlatformConfig, retryOn401, startPolling };

export async function startRalph({ kitDir, projectDir, onTask, onPlannedSlice, agentType = 'BUILD', queueAllStatuses = false, localOnly = false }) {
  const local = loadLocalConfig(kitDir);
  local.agentId = ensureAgentId(kitDir, agentType);

  console.log(`Ralph — kit: ${kitDir}`);
  console.log(`         project: ${projectDir}`);

  // localOnly (set via `eventmodelers run --local`) forces this branch even when
  // credentials are present — it skips fetchPlatformConfig's network call to
  // ${baseUrl}/api/config and startPolling entirely, so the loop never reaches
  // out to the platform at all.
  if (localOnly || !hasCredentials(local)) {
    console.log(`         mode: local-only (no platform sync)${localOnly ? ' — forced by --local' : ''}\n`);
    await ralphLoop(kitDir, local, onTask, onPlannedSlice);
    return;
  }

  const cfg = await retryOn401('fetchPlatformConfig', () => fetchPlatformConfig(local));
  console.log(`         org=${cfg.organizationId}, board=${cfg.boardId}, base=${cfg.baseUrl}\n`);
  console.log(`         board sync: polling every ${POLL_INTERVAL_MS}ms (REST only — no realtime/table subscription)\n`);

  await Promise.all([
    startPolling(cfg, kitDir, { queueAllStatuses }),
    ralphLoop(kitDir, cfg, onTask, onPlannedSlice),
  ]);
}
