// Common runtime for the ralph loop + realtime agent.
// Not meant to be run directly — use ralph-claude.js or ralph-local-ai.js.
//
// startRalph({ kitDir, projectDir, onTask, onPlannedSlice })
//   onTask(prompt) — called when tasks.json has entries
//   onPlannedSlice(prompt, slice) — called when .slices/ has a "Planned" entry (omit to skip);
//     `slice` ({sliceId, sliceTitle, context, ticketNumber, boardId, attempt}) lets a runner record what building it cost.

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { createRealtimeAdapter } from './adapters/realtime-adapter.js';

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

// `x-agent-id` on every platform call this loop makes, when it knows its own agent id (see
// ensureAgentId above / RALPH_AGENT_ID). The heartbeat says this agent is alive; the header says
// which calls are its, so its board writes are attributed to it and a prompt the user addressed
// to one preferred agent is only ever claimed by that agent.
function agentHeaders(cfg) {
  const agentId = cfg?.agentId || process.env.RALPH_AGENT_ID || process.env.EVENTMODELERS_AGENT_ID || '';
  return agentId ? { 'x-agent-id': agentId } : {};
}

async function fetchPlatformConfig(local) {
  const remote = await fetchJSON(`${local.baseUrl}/api/config`, {
    headers: { 'x-token': local.token, ...agentHeaders(local) },
  });
  return { ...local, ...remote };
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

async function fetchAndPersistSlices(cfg, kitDir) {
  const url = `${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata/slices`;
  const { slices } = await fetchJSON(url, {
    headers: { 'x-token': cfg.token, ...agentHeaders(cfg) },
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

  // Write per-context index.json and per-slice slice.json.
  //
  // This endpoint (`/slicedata/slices`) is the CHEAP summary one — `{ id, title, status }`
  // only, no commands/events/specifications/codeGen prompts. Its whole job here is to keep
  // `status` fresh so hasPendingTasks/getFirstPlannedSliceTitle see live transitions; it must
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
        status: s.status,
        definition: { ...existing?.definition, id: s.id, title: s.title, status: s.status },
      };
    });
    writeFileSync(indexPath, JSON.stringify({ slices: indexSlices }, null, 2), 'utf-8');

    for (const slice of ctxSlices) {
      const folder = (slice.title ?? slice.id).replaceAll(' ', '').toLowerCase();
      const sliceDir = join(contextDir, folder);
      mkdirSync(sliceDir, { recursive: true });
      const sliceJsonPath = join(sliceDir, 'slice.json');
      const existingSlice = existsSync(sliceJsonPath) ? JSON.parse(readFileSync(sliceJsonPath, 'utf-8')) : {};
      // The summary omits ticketNumber when the slice has none, so a cleared ticket must be cleared
      // here too — otherwise the old one survives the merge and lands on the next build's trace.
      writeFileSync(sliceJsonPath, JSON.stringify({ ...existingSlice, ...slice, ticketNumber: slice.ticketNumber ?? null }, null, 2), 'utf-8');
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

async function handleSliceChanged(payload, cfg, kitDir, queueAllStatuses) {
  console.log(`[agent] slice:changed — slice="${payload.sliceTitle}" status="${payload.sliceStatus}"`);
  await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, kitDir)).catch((err) =>
    console.error('[agent] Slice persist error:', err),
  );
  // Planned slices are handled by onPlannedSlice directly — no task needed.
  // queueAllStatuses opts out of that split entirely (e.g. bridge has no
  // onPlannedSlice consumer, so a lingering Planned slice would otherwise
  // never naturally clear its own trigger — see lib/ralph.js callers).
  if (queueAllStatuses || (payload.sliceStatus || '').toLowerCase() !== 'planned') {
    await writeTask(payload, kitDir).catch((err) => console.error('[agent] writeTask error:', err));
  }
}

async function startRealtimeAgent(cfg, kitDir, { agentType = 'BUILD', queueAllStatuses = false } = {}) {
  let realtimeToken = await retryOn401('getRealtimeToken', () => getRealtimeToken(cfg));

  await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, kitDir)).catch((err) =>
    console.error('[agent] Initial slice fetch error:', err),
  );

  const channelName = `board:${cfg.boardId}-slicechanged`;
  const realtime = await createRealtimeAdapter(cfg, realtimeToken);

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
          realtimeToken = await retryOn401('getRealtimeToken (refresh)', () => getRealtimeToken(cfg));
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

  // A subscribe that errors on a stale token needs a fresh token AND a new join
  // attempt — setAuth alone doesn't re-join a channel that already errored out.
  // Capped so a non-expiry auth failure (e.g. genuinely revoked access) can't turn
  // into a tight resubscribe loop hammering the platform forever.
  let channelErrorStreak = 0;
  const subscribeChannel = () => {
    realtime.subscribe(
      channelName,
      {
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
        'slice:changed': (payload) => handleSliceChanged(payload, cfg, kitDir, queueAllStatuses),
      },
      async (status) => {
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') {
          if (channelErrorStreak > 0) {
            console.log(`[agent] ${ts()} Channel "${channelName}": ${status} — recovered after ${channelErrorStreak} failed attempt(s)`);
          } else {
            console.log(`[agent] ${ts()} Channel "${channelName}": ${status}`);
          }
          channelErrorStreak = 0;
          return;
        }
        channelErrorStreak += 1;
        console.warn(`[agent] ${ts()} Channel "${channelName}": ${status} (attempt ${channelErrorStreak}/5)`);
        if (channelErrorStreak > 5) {
          console.error(`[agent] ${ts()} Channel "${channelName}" failed ${channelErrorStreak} times in a row — giving up until the next scheduled token refresh (every 10min)`);
          return;
        }
        try {
          await refreshToken(`channel ${status}`);
          await new Promise((r) => setTimeout(r, 2_000));
          console.log(`[agent] ${ts()} Resubscribing to channel "${channelName}" (attempt ${channelErrorStreak}/5)...`);
          subscribeChannel();
        } catch (err) {
          console.error(`[agent] ${ts()} Token refresh after channel error failed, will not resubscribe this round:`, err);
        }
      },
    );
  };
  subscribeChannel();

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

// The slice's ticket as of the last fetch, from its slice.json — a trace carries the ticket the
// slice is built under, since it can be reassigned between builds.
function readTicketNumber(kitDir, ctx, folder) {
  if (!folder) return null;
  try {
    return JSON.parse(readFileSync(join(kitDir, '.slices', ctx, folder, 'slice.json'), 'utf-8')).ticketNumber ?? null;
  } catch {
    return null;
  }
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
    if (planned) return { id: planned.id ?? null, title: planned.slice || planned.id || null, ctx: currentCtx, ticketNumber: readTicketNumber(kitDir, currentCtx, planned.folder) };
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
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-user-id': 'ralph-loop', ...agentHeaders(cfg) },
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

async function ralphLoop(kitDir, cfg, onTask, onPlannedSlice, localOnly = false) {
  const promptFile = join(kitDir, 'lib', 'prompt.md');
  const backendPromptFile = join(kitDir, 'lib', 'backend-prompt.md');
  // --local must mean zero board contact even when .eventmodelers/config.json
  // happens to hold valid credentials — never let a locally-present token flip
  // this back on.
  const credentialed = !localOnly && hasCredentials(cfg);
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
      await runWithRetry(`onPlannedSlice: building slice "${planned.title}"...`, () => onPlannedSlice(prompt, {
        sliceId: planned.id,
        sliceTitle: planned.title,
        context: planned.ctx,
        ticketNumber: planned.ticketNumber,
        boardId: cfg.boardId ?? null,
        attempt: stuckSlice.count,
      }));
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

// Who this process is. RALPH_AGENT_ID/RALPH_AGENT_NAME are `eventmodelers run --id/--name`,
// passed down as env (see cli.js's run dispatcher): a per-run identity override so a second
// agent of the same type can run side by side without the two overwriting each other's
// heartbeat row, and so the board can show a name instead of a bare uuid. An override skips
// ensureAgentId rather than overwriting it — the project's stable id stays on disk for the next
// plain run. Exported so a runner can resolve it at load time, before startRalph runs — the env
// it hands its `claude` is built then. Idempotent: ensureAgentId returns the id it persisted.
export function resolveAgentIdentity(kitDir, agentType = 'BUILD', cfg = loadLocalConfig(kitDir)) {
  const agentId = process.env.RALPH_AGENT_ID || ensureAgentId(kitDir, agentType);
  const agentName = process.env.RALPH_AGENT_NAME || cfg.agentName || '';
  process.env.EVENTMODELERS_AGENT_ID = agentId;
  return { agentId, agentName, agentType };
}

export async function startRalph({ kitDir, projectDir, onTask, onPlannedSlice, agentType = 'BUILD', queueAllStatuses = false, localOnly = false }) {
  const local = loadLocalConfig(kitDir);
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
    await ralphLoop(kitDir, local, onTask, onPlannedSlice, localOnly);
    return;
  }

  const cfg = await retryOn401('fetchPlatformConfig', () => fetchPlatformConfig(local));
  console.log(`         org=${cfg.organizationId}, board=${cfg.boardId}, base=${cfg.baseUrl}\n`);

  await Promise.all([
    startRealtimeAgent(cfg, kitDir, { agentType, queueAllStatuses }),
    ralphLoop(kitDir, cfg, onTask, onPlannedSlice),
  ]);
}
