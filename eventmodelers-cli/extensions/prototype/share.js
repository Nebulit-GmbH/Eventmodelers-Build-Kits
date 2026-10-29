// `prototype share`: the local page, stored on the platform per context — what the board's ▶ button plays and what the platform `prototype`
// skill's `upload` stores (the same endpoint, so the same sanitizer). The page is the one `prototype assemble` wrote, built from the skill's own
// template and runtime, so the platform skill finds its slice blocks (data-em-hash) as the baseline of its next run.
import { existsSync, readFileSync } from 'node:fs';
import { plan } from './local-build.js';
import { hasLocalChanges } from './sync.js';
import { paths, readJson } from './state.js';

/** The address the board plays a stored prototype at (miro-eventmodeling prototypeplayer/prototypeLink.ts). */
export const playLink = (app, { organizationId, boardId }, contextId, title) => {
  const params = new URLSearchParams({ org: organizationId, board: boardId, chapter: contextId });
  if (title) params.set('title', title);
  return `${app}/play?${params}`;
};

/**
 * Uploads .prototype/index.html. `contexts` looks the context's id up by name when the project has none recorded (fetched before ids were kept).
 * Returns { stored, contextId, context, warnings }; throws when there is nothing to share or the platform refuses.
 */
export async function share(cwd, cfg, { contexts, fetchImpl = fetch } = {}) {
  const p = paths(cwd);
  const state = readJson(p.state, {});
  if (!existsSync(p.page)) throw new Error('There is no page yet — build the prototype first (the /local-prototype skill, then `eventmodelers prototype assemble`).');
  const stale = plan(cwd).slices.filter((s) => s.state !== 'unchanged');
  if (stale.length) throw new Error(`The page is behind the model — ${stale.length} slice${stale.length === 1 ? '' : 's'} need a new block (${stale.map((s) => s.title).join(', ')}). Rebuild first, otherwise what is shared is not what the model says.`);
  let contextId = state.contextId;
  if (!contextId) {
    const hit = (await contexts(cfg)).find((c) => c.title === state.context);
    if (!hit) throw new Error(`The board has no context or timeline named "${state.context}".`);
    contextId = hit.id;
  }
  const warnings = [];
  if (hasLocalChanges(cwd)) warnings.push('There are local model edits that are not synced to the board — the shared page shows them, the board\'s model does not. `eventmodelers prototype sync` first to make them the same.');
  const base = `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
  const res = await fetchImpl(`${base}/prototype/${encodeURIComponent(contextId)}`, {
    method: 'POST',
    headers: { 'x-token': cfg.token, 'x-user-id': 'prototype-local', 'content-type': 'text/html; charset=utf-8' },
    body: readFileSync(p.page),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`The board refused the upload (HTTP ${res.status}): ${text}`);
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status} ${text}`);
  return { stored: JSON.parse(text), contextId, context: state.context, warnings };
}
