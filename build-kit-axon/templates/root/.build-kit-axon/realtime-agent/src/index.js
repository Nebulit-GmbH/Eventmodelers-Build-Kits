import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
          console.warn(`[agent] ${label} — 401 Unauthorized, retrying (${attempt}/${maxRetries})...`);
          continue;
        }
        console.error(`[agent] ${label} — 401 Unauthorized after ${maxRetries} retries, shutting down`);
        process.exit(1);
      }
      throw err;
    }
  }
}

function findRalphShDir(startDir) {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'ralph.sh'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findConfigPath(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.eventmodelers', 'config.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('No .eventmodelers/config.json found in current directory or any parent directory');
    dir = parent;
  }
}

function loadLocalConfig() {
  const configPath = findConfigPath(process.cwd());
  const raw = readFileSync(configPath, 'utf-8');
  const cfg = JSON.parse(raw);

  for (const key of ['token', 'organizationId', 'boardId', 'baseUrl']) {
    if (!cfg[key]) throw new Error(`Missing config field: ${key}`);
  }

  if (process.env.BASE_URL) cfg.baseUrl = process.env.BASE_URL;

  return cfg;
}

async function fetchPlatformConfig(local) {
  const remote = await fetchJSON(`${local.baseUrl}/api/config`, {
    headers: { 'x-token': local.token },
  });
  return { ...local, ...remote };
}

async function getRealtimeToken(cfg) {
  const { token } = await fetchJSON(`${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/realtime-token`, {
    headers: { 'x-token': cfg.token },
  });
  return token;
}

async function fetchAndPersistSlices(cfg, cwd) {
  const url = `${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata/slices`;
  const { slices } = await fetchJSON(url, {
    headers: { 'x-token': cfg.token, 'x-board-id': cfg.boardId },
  });

  const slicesDir = join(cwd, 'slices');
  mkdirSync(slicesDir, { recursive: true });

  for (const slice of slices) {
    const filePath = join(slicesDir, `${slice.id}.json`);
    writeFileSync(filePath, JSON.stringify(slice, null, 2), 'utf-8');
  }

  console.log(`[agent] Persisted ${slices.length} slice(s) to ${slicesDir}`);
}

async function writeTask(payload, cwd) {
  const tasksPath = resolve(cwd, 'tasks.json');

  const existing = existsSync(tasksPath)
    ? JSON.parse(readFileSync(tasksPath, 'utf-8'))
    : [];

  const task = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  };

  existing.push(task);
  writeFileSync(tasksPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`[agent] Task ${task.id} written — slice="${payload.sliceTitle}" status="${payload.sliceStatus}"`);
}

async function start() {
  const claudeCwd = process.argv[2] ?? findRalphShDir(process.cwd()) ?? resolve(process.cwd(), '.');

  const local = loadLocalConfig();
  const cfg = await retryOn401('fetchPlatformConfig', () => fetchPlatformConfig(local));

  console.log(`[agent] Starting — org=${cfg.organizationId}, board=${cfg.boardId}, base=${cfg.baseUrl}, cwd=${claudeCwd}`);

  let realtimeToken = await retryOn401('getRealtimeToken', () => getRealtimeToken(cfg));

  await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, claudeCwd)).catch((err) =>
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

      await retryOn401('fetchAndPersistSlices', () => fetchAndPersistSlices(cfg, claudeCwd)).catch((err) =>
        console.error('[agent] Slice persist error:', err),
      );

      await writeTask(payload, claudeCwd).catch((err) =>
        console.error('[agent] writeTask error:', err),
      );
    })
    .subscribe((status) => {
      console.log(`[agent] Realtime channel "${channelName}" status: ${status}`);
    });

  setInterval(async () => {
    try {
      realtimeToken = await retryOn401('getRealtimeToken (refresh)', () => getRealtimeToken(cfg));
      supabase.realtime.setAuth(realtimeToken);
      console.log('[agent] Realtime token refreshed');
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
  setInterval(ping, 30 * 1000);
}

start().catch((err) => {
  console.error('[agent] Fatal:', err);
  process.exit(1);
});
