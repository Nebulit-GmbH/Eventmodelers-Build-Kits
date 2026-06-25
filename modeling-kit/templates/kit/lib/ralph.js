// Common runtime for the ralph loop + realtime agent.
// Not meant to be run directly — use ralph-claude.js or ralph-ollama.js.
//
// startRalph({ kitDir, projectDir, onTask })
//   onTask(prompt) — called when tasks.json has entries

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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

function findConfigInParents(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.eventmodelers', 'config.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadLocalConfig(kitDir) {
  const configPath = join(kitDir, '.eventmodelers', 'config.json');
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (process.env.BASE_URL) cfg.baseUrl = process.env.BASE_URL;
    return cfg;
  }
  const parentConfigPath = findConfigInParents(dirname(kitDir));
  if (parentConfigPath) {
    console.log(`[ralph] Using credentials from ${parentConfigPath}`);
    const cfg = JSON.parse(readFileSync(parentConfigPath, 'utf-8'));
    if (process.env.BASE_URL) cfg.baseUrl = process.env.BASE_URL;
    return cfg;
  }
  console.warn(`[ralph] Note: no .eventmodelers/config.json found — platform sync disabled.`);
  console.warn(`        To enable board sync, follow: https://app.eventmodelers.ai/documentation`);
  console.warn(`        Code generation from local slice definitions will still run.`);
  return {};
}

function hasCredentials(cfg) {
  return !!(cfg.token && cfg.organizationId && cfg.baseUrl);
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

async function fetchNextPrompt(cfg, jwtToken) {
  const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/next`, {
    headers: { 'x-token': cfg.token, Authorization: `Bearer ${jwtToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(res.status, await res.text());
  return res.json();
}

async function drainQueue(cfg, jwtToken, kitDir) {
  const prompts = [];
  let p;
  while ((p = await fetchNextPrompt(cfg, jwtToken)) !== null) {
    console.log(`[agent] Queuing prompt "${p.prompt}" (board=${p.board_id}, priority=${p.priority})`);
    prompts.push(p);
  }
  if (prompts.length > 0) {
    const tasksPath = join(kitDir, 'tasks.json');
    const existing = existsSync(tasksPath) ? JSON.parse(readFileSync(tasksPath, 'utf-8')) : [];
    const task = { id: randomUUID(), createdAt: new Date().toISOString(), prompts };
    existing.push(task);
    writeFileSync(tasksPath, JSON.stringify(existing, null, 2), 'utf-8');
    console.log(`[agent] Task written with ${prompts.length} prompt(s)`);
  }
}

async function startRealtimeAgent(cfg, kitDir) {
  let realtimeToken = await retryOn401('getRealtimeToken', () => getRealtimeToken(cfg));

  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { apikey: cfg.supabaseAnonKey } },
  });
  await supabase.realtime.setAuth(realtimeToken);

  const channelName = `org:${cfg.organizationId}`;

  supabase
    .channel(channelName, { config: { private: true } })
    .on('broadcast', { event: 'message' }, (msg) => {
      if (msg.payload === 'Exit') {
        console.log('[agent] Received "Exit" — shutting down');
        process.exit(0);
      }
    })
    .on('broadcast', { event: 'prompt:created' }, async () => {
      console.log('[agent] New prompt received');
      await drainQueue(cfg, realtimeToken, kitDir).catch((err) =>
        console.error('[agent] Queue drain error:', err),
      );
    })
    .subscribe(async (status) => {
      await drainQueue(cfg, realtimeToken, kitDir).catch((err) =>
        console.error('[agent] Initial drain error:', err),
      );
      console.log(`[agent] Channel "${channelName}": ${status}`);
    });

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

async function ralphLoop(kitDir, onTask) {
  while (true) {
    if (hasPendingTasks(kitDir)) {
      await runWithRetry('onTask: processing next task...', () =>
        onTask('Process the next task from tasks.json.'),
      );
    } else {
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export { loadLocalConfig, fetchPlatformConfig, retryOn401 };

export async function startRalph({ kitDir, projectDir, onTask }) {
  const local = loadLocalConfig(kitDir);

  console.log(`Ralph — kit: ${kitDir}`);
  console.log(`         project: ${projectDir}`);

  if (!hasCredentials(local)) {
    console.log(`         mode: local-only (no platform sync)\n`);
    await ralphLoop(kitDir, onTask);
    return;
  }

  const cfg = await retryOn401('fetchPlatformConfig', () => fetchPlatformConfig(local));
  console.log(`         org=${cfg.organizationId}, base=${cfg.baseUrl}\n`);

  await Promise.all([
    startRealtimeAgent(cfg, kitDir),
    ralphLoop(kitDir, onTask),
  ]);
}
