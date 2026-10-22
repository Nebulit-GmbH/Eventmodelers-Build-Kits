// Where the slices come from: the board (default) or local files (--local).

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { FetchAuthError } from '../../lib/fetch.js';

export class ContextNotFoundError extends Error {}

const DEFAULT_BASE_URL = 'https://api.eventmodelers.ai';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));

// Every context on the board, as the server resolves them — a timeline with no assigned context counts as its own
// context. Derived from the slice summaries, so contexts without slices do not show up (there is nothing to export).
export async function listContexts({ cfg }) {
  const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
  const res = await fetch(`${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata/slices`, { headers: { 'x-token': cfg.token, 'x-user-id': 'cli-export' } });
  if (res.status === 401) throw new FetchAuthError(401, 'slicedata/slices: invalid or expired token');
  if (res.status === 403) throw new FetchAuthError(403, "slicedata/slices: token's organization does not match this board");
  if (res.status === 404) throw new FetchAuthError(404, `slicedata/slices: board ${cfg.boardId} not found`);
  if (!res.ok) throw new Error(`slicedata/slices: HTTP ${res.status}`);
  const counts = new Map();
  for (const s of (await res.json()).slices ?? []) {
    const name = s.contextName || 'default';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, slices]) => ({ name, slices }));
}

// Same endpoint `fetch` uses (json format); throws FetchAuthError on 401/403 so the CLI can re-prompt.
export async function loadFromBoard({ cfg, context }) {
  if (!context) throw new Error('No context given.');
  const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
  const query = UUID_RE.test(context) ? `contextId=${encodeURIComponent(context)}` : `contextName=${encodeURIComponent(context)}`;
  const url = `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata?${query}&format=json`;
  const res = await fetch(url, { headers: { 'x-token': cfg.token, 'x-user-id': 'cli-export' } });
  if (res.status === 401) throw new FetchAuthError(401, 'slicedata: invalid or expired token');
  if (res.status === 403) throw new FetchAuthError(403, "slicedata: token's organization does not match this board");
  if (res.status === 404) {
    const body = await res.json().catch(() => null);
    throw new ContextNotFoundError(`slicedata: ${body?.error || `no context or timeline named "${context}"`} (board ${cfg.boardId})`);
  }
  if (!res.ok) throw new Error(`slicedata: HTTP ${res.status}`);
  return (await res.json()).slices ?? [];
}

// `local` is true (auto-detect) or a path to a config.json, a .slices/ folder, a context folder, or a slice.json.
// Auto-detect tries ./.slices/ first, then ./config.json.
export function loadFromLocal({ cwd, local, context }) {
  const candidates = typeof local === 'string' ? [resolve(cwd, local)] : [join(cwd, '.slices'), join(cwd, 'config.json')];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`No local slices found (looked for ${candidates.join(', ')}).`);
  const slices = statSync(path).isDirectory() ? fromFolder(path) : fromFile(path);
  const wanted = context?.toLowerCase();
  return wanted ? slices.filter((s) => (s.context ?? '').toLowerCase() === wanted) : slices;
}

function fromFile(path) {
  const data = readJson(path);
  return Array.isArray(data.slices) ? data.slices : [data];
}

// A .slices/ folder holds <context>/<slice>/slice.json (and a <context>/config.json dump of the same data).
function fromFolder(dir) {
  const slices = [];
  const walk = (d, depth) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (entry.name === 'slice.json') slices.push(readJson(p));
    }
  };
  walk(dir, 0);
  // slice.json drops `index`; order from the context's index.json when there is one.
  slices.forEach((s, i) => { if (s.index === undefined) s.index = i; });
  return slices;
}
