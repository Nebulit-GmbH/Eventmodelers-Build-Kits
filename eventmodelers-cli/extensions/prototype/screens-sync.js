// Screens go to the board too: an HTML screen's pages are the `meta.pages` of its node, written like a node's fields — one node:changed event.
// A screen edited here (state.js: editedScreens) is sent unless the board changed its pages since the fetch; never forced.
import { randomUUID } from 'node:crypto';
import { editedScreens, loadScreens, loadSlices, baselinePagesHash, pagesHashOf, paths, snapshotScreen } from './state.js';

const apiOf = (cfg) => `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
const headersOf = (cfg) => ({ 'x-token': cfg.token, 'x-user-id': 'prototype-sync', 'content-type': 'application/json', ...(cfg.agentId ? { 'x-agent-id': cfg.agentId } : {}) });

/** The HTML screens edited here and not on the board yet: [{ nodeId, title, pages }]. Sketch screens have no pages and are not synced. */
export function screenOps(cwd) {
  const p = paths(cwd);
  const screens = loadScreens(p);
  return editedScreens(p).filter((id) => Array.isArray(screens[id].pages)).map((id) => ({ nodeId: id, title: screens[id].title || id, pages: screens[id].pages }));
}

/** The pages the board has for these screen nodes: { id: pages | null }. */
async function boardPages(cwd, cfg, ids, fetchImpl) {
  const res = await fetchImpl(`${apiOf(cfg)}/nodes/query`, { method: 'POST', headers: headersOf(cfg), body: JSON.stringify({ ids }) });
  if (!res.ok) throw new Error(`Reading the screens from the board failed: HTTP ${res.status} ${await res.text()}`);
  const out = {};
  for (const node of await res.json()) {
    const meta = typeof node.meta === 'string' ? JSON.parse(node.meta) : node.meta || {};
    out[node.id] = meta.pages ?? null;
  }
  return out;
}

/**
 * Writes one screen's pages to the board (`eventId` becomes the event's id — a change's id, so it is idempotent). Returns { status, note }:
 * submitted | already (the board has these pages) | conflict (the board changed them since the fetch) | gone (no such node on the board).
 */
export async function submitScreenPages(cwd, cfg, { nodeId, pages, eventId = randomUUID() }, fetchImpl = fetch) {
  const p = paths(cwd);
  const board = await boardPages(cwd, cfg, [nodeId], fetchImpl);
  if (!(nodeId in board)) return { status: 'gone', note: `the screen no longer exists on the board` };
  const there = pagesHashOf(board[nodeId]);
  if (there === pagesHashOf(pages)) { snapshotScreen(p, nodeId); return { status: 'already', note: 'the board already has these pages' }; }
  const known = baselinePagesHash(p, nodeId);
  if (known !== undefined && there !== known) return { status: 'conflict', note: 'the screen changed on the board since the fetch — not overwritten' };
  const event = { id: eventId, eventType: 'node:changed', nodeId, changedAttributes: ['meta.pages'], meta: { pages } };
  const post = await fetchImpl(`${apiOf(cfg)}/nodes/events`, { method: 'POST', headers: headersOf(cfg), body: JSON.stringify([event]) });
  if (!post.ok) throw new Error(`Writing the screen to the board failed: HTTP ${post.status} ${await post.text()}`);
  snapshotScreen(p, nodeId);
  return { status: 'submitted', note: 'node:changed pages' };
}

/** Every screen edited here, to the board. Returns [{ nodeId, title, status, note }]; a board error on one is reported on it and the rest go on. */
export async function syncScreens(cwd, cfg, { log = () => {}, fetchImpl = fetch } = {}) {
  const out = [];
  for (const op of screenOps(cwd)) {
    let r;
    try { r = await submitScreenPages(cwd, cfg, op, fetchImpl); } catch (err) { r = { status: 'failed', note: err.message }; }
    log(`  ${r.status === 'submitted' || r.status === 'already' ? 'synced   ' : r.status === 'conflict' ? 'conflict ' : 'skipped  '} HTML_SCREEN "${op.title}": pages — ${r.status}${r.note ? ` (${r.note})` : ''}`);
    out.push({ nodeId: op.nodeId, title: op.title, ...r });
  }
  return out;
}

/**
 * The HTML screens that exist on the board but have no design yet — "Untitled screen — design pending": a slice that was created by a tool call
 * (create_slice) brings its screen node without pages. Returns [{ sliceTitle, sliceType, screenId, title, fields, connectedTo }] for whoever designs them.
 */
export function screensToDesign(cwd) {
  const p = paths(cwd);
  const screens = loadScreens(p);
  const out = [];
  for (const { slice } of loadSlices(p)) {
    for (const node of slice.screens || []) {
      const id = node.linkedId || node.id;
      const rec = screens[id];
      if (!rec || (rec.type || node.type) !== 'HTML_SCREEN') continue;
      const blank = !Array.isArray(rec.pages) || !rec.pages.length || rec.pages.every((pg) => !String(typeof pg === 'string' ? pg : pg.html || '').trim());
      if (blank) out.push({ sliceTitle: slice.title, sliceType: slice.sliceType, screenId: id, title: node.title || rec.title || '', fields: (node.fields || []).map((f) => f.name), connectedTo: (node.dependencies || []).map((d) => `${d.type === 'OUTBOUND' ? '→' : '←'} ${d.title} (${d.elementType})`) });
    }
  }
  return out;
}
