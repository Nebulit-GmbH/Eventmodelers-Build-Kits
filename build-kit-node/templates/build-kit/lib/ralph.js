// Common runtime for the ralph loop + realtime agent.
// Not meant to be run directly — use ralph-claude.js or ralph-ollama.js.
//
// startRalph({ kitDir, projectDir, onTask, onPlannedSlice })
//   onTask(prompt) — called when tasks.json has entries
//   onPlannedSlice(prompt) — called when .slices/ has a "Planned" entry (omit to skip)

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
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
    if (parent === dir) return;
    dir = parent;
  }
}

function loadLocalConfig(kitDir) {
  const merged = {};
  const sources = [];

  for (const candidate of configCandidates(kitDir)) {
    if (!existsSync(candidate)) continue;
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

  if (sources.length > 1) {
    console.log(`[ralph] Merged config from: ${sources.join(', ')}`);
  } else if (sources.length === 1 && sources[0] !== join(kitDir, '.eventmodelers', 'config.json')) {
    console.log(`[ralph] Using credentials from ${sources[0]}`);
  } else if (sources.length === 0) {
    console.warn(`[ralph] Note: no .eventmodelers/config.json found — platform sync disabled.`);
    console.warn(`        To enable board sync, follow: https://app.eventmodelers.ai/documentation#build-node`);
    console.warn(`        Code generation from local slice definitions will still run.`);
  }

  return merged;
}

function hasCredentials(cfg) {
  return !!(cfg.token && cfg.organizationId && cfg.boardId && cfg.baseUrl);
}

async function fetchPlatformConfig(local) {
  const remote = await fetchJSON(`${local.baseUrl}/api/config`, {
    headers: { 'x-token': local.token },
  });
  return { ...local, ...remote };
}

// ── Realtime agent ────────────────────────────────────────────────────────────

async function getRealtimeToken(cfg) {
  const { token } = await fetchJSON(
    `${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/realtime-token`,
    { headers: { 'x-token': cfg.token } },
  );
  return token;
}

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

async function startRealtimeAgent(cfg, kitDir) {
  let realtimeToken = await retryOn401('getRealtimeToken', () => getRealtimeToken(cfg));

  await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, kitDir)).catch((err) =>
    console.error('[agent] Initial slice fetch error:', err),
  );

  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { apikey: cfg.supabaseAnonKey } },
  });
  await supabase.realtime.setAuth(realtimeToken);

  const channelName = `board:${cfg.boardId}-slicechanged`;

  supabase
    .channel(channelName, { config: { private: true } })
    .on('broadcast', { event: 'message' }, (msg) => {
      if (msg.payload === 'Exit') {
        console.log('[agent] Received "Exit" — shutting down');
        process.exit(0);
      }
    })
    .on('broadcast', { event: 'slice:changed' }, async (msg) => {
      const payload = msg.payload;
      console.log(`[agent] slice:changed — slice="${payload.sliceTitle}" status="${payload.sliceStatus}"`);
      await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, kitDir)).catch((err) =>
        console.error('[agent] Slice persist error:', err),
      );
      // Planned slices are handled by onPlannedSlice directly — no task needed
      if ((payload.sliceStatus || '').toLowerCase() !== 'planned') {
        await writeTask(payload, kitDir).catch((err) => console.error('[agent] writeTask error:', err));
      }
    })
    .subscribe((status) => console.log(`[agent] Channel "${channelName}": ${status}`));

  setInterval(async () => {
    try {
      realtimeToken = await retryOn401('getRealtimeToken (refresh)', () => getRealtimeToken(cfg));
      supabase.realtime.setAuth(realtimeToken);
      console.log('[agent] Token refreshed');
    } catch (err) {
      console.error('[agent] Token refresh failed:', err);
    }
  }, 10 * 60 * 1000);

  const ping = async () => {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/agent-alive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${realtimeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cfg.token }),
      });
      if (!res.ok) console.error(`[agent] Ping failed: ${res.status}`);
    } catch (err) {
      console.error('[agent] Ping error:', err);
    }
  };
  await ping();
  setInterval(ping, 30_000);
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
function getFirstPlannedSliceTitle(kitDir) {
  const currentCtx = readCurrentContext(kitDir);
  if (!currentCtx) return null;
  const indexPath = join(kitDir, '.slices', currentCtx, 'index.json');
  if (!existsSync(indexPath)) return null;
  try {
    const { slices } = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const planned = slices && slices.find((s) => (s.status || '').toLowerCase() === 'planned');
    if (planned) return planned.slice || planned.id || null;
  } catch {}
  return null;
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

  while (true) {
    let didWork = false;

    if (credentialed && hasPendingTasks(kitDir)) {
      const prompt = readFileSync(promptFile, 'utf-8');
      await runWithRetry('onTask: loading slice from board...', () => onTask(prompt));
      await fetchAndPersistSlices(cfg, kitDir).catch(() => {});
      didWork = true;
    }

    const plannedTitle = onPlannedSlice && getFirstPlannedSliceTitle(kitDir);
    if (plannedTitle) {
      const prompt = readFileSync(backendPromptFile, 'utf-8');
      await runWithRetry(`onPlannedSlice: building slice "${plannedTitle}"...`, () => onPlannedSlice(prompt));
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

export { loadLocalConfig, fetchPlatformConfig, retryOn401, startRealtimeAgent };

export async function startRalph({ kitDir, projectDir, onTask, onPlannedSlice }) {
  const local = loadLocalConfig(kitDir);

  console.log(`Ralph — kit: ${kitDir}`);
  console.log(`         project: ${projectDir}`);

  if (!hasCredentials(local)) {
    console.log(`         mode: local-only (no platform sync)\n`);
    await ralphLoop(kitDir, local, onTask, onPlannedSlice);
    return;
  }

  const cfg = await retryOn401('fetchPlatformConfig', () => fetchPlatformConfig(local));
  console.log(`         org=${cfg.organizationId}, board=${cfg.boardId}, base=${cfg.baseUrl}\n`);

  await Promise.all([
    startRealtimeAgent(cfg, kitDir),
    ralphLoop(kitDir, cfg, onTask, onPlannedSlice),
  ]);
}
