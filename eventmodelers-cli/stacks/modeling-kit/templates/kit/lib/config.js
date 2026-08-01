// Config resolution for a modeling-kit install. A modeling agent has exactly one
// runtime mode (the CLI's warm, direct-dispatch loop — see `eventmodelers run
// --modeling`), so unlike build-kit there's no ralph loop / tasks.json queue
// living alongside this — just the shared, read-only config-file-walk logic.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

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
      console.warn(`[modeling] Skipping invalid config at ${candidate}`);
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
    console.log(`[modeling] Merged config from: ${sources.join(', ')}`);
  } else if (sources.length === 1 && sources[0] !== join(kitDir, '.eventmodelers', 'config.json')) {
    console.log(`[modeling] Using credentials from ${sources[0]}`);
  } else if (sources.length === 0) {
    console.warn(`[modeling] Note: no .eventmodelers/config.json found — platform sync disabled.`);
    console.warn(`           To enable board sync, follow: https://app.eventmodelers.ai/documentation`);
  }

  return merged;
}

// boardId is required — a modeling agent always runs for exactly one board, and
// /prompts/next needs it to scope which board's queue it drains.
function hasCredentials(cfg) {
  return !!(cfg.token && cfg.organizationId && cfg.boardId && cfg.baseUrl);
}

async function fetchPlatformConfig(local) {
  const remote = await fetchJSON(`${local.baseUrl}/api/config`, {
    headers: { 'x-token': local.token },
  });
  return { ...local, ...remote };
}

export { loadLocalConfig, fetchPlatformConfig, hasCredentials };
