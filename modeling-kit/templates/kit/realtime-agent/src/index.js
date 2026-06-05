import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeTask } from './agentCall.js';

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

  for (const key of ['token', 'organizationId', 'baseUrl']) {
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



async function drainQueue(cfg, jwtToken, claudeCwd) {
  const prompts = [];
  let prompt;

  while ((prompt = await fetchNextPrompt(cfg, jwtToken)) !== null) {
    console.log(`[agent] Queuing prompt "${prompt.prompt}" (board=${prompt.board_id}, priority=${prompt.priority})`);
    prompts.push(prompt);
  }

  if (prompts.length > 0) {
    await writeTask(prompts, claudeCwd);
  }
}

async function start() {
  const claudeCwd = process.argv[2] ?? findRalphShDir(process.cwd()) ?? resolve(process.cwd(), '.');

  const local = loadLocalConfig();
  const cfg = await retryOn401('fetchPlatformConfig', () => fetchPlatformConfig(local));

  console.log(`[agent] Starting — org=${cfg.organizationId}, base=${cfg.baseUrl}, cwd=${claudeCwd}`);

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
      await drainQueue(cfg, realtimeToken, claudeCwd).catch((err) =>
        console.error('[agent] Queue drain error:', err),
      );
    })
    .subscribe(async (status) => {
      await drainQueue(cfg, realtimeToken, claudeCwd).catch((err) =>
        console.error('[agent] Initial drain error:', err),
      );
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
