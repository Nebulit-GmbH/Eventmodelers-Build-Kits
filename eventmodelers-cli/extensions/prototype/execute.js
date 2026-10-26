// Stage three: a change is executed as recorded — no agent involved. The local model first (a node:changed sets its attribute on the node in
// slice.json; the page is rebuilt afterwards), then the board: the node:changed event itself, or the recorded tool call.
// Returns { applied, status, note }: `applied` — the local model/page side is done; `status` — what happened on the board
// (submitted | already | conflict | gone | not-synced when the board was not asked to take it yet).
import { callTool } from './mcp.js';
import { findNode } from './changes.js';
import { KINDS } from './sync.js';
import { paths, readBaseline, readJson, same, writeBaseline, writeScreenPages } from './state.js';
import { submitScreenPages } from './screens-sync.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSlices } from './state.js';

const empty = (attribute) => (attribute === 'fields' ? [] : '');

/** The local half of a node:changed: set the event's attributes on the node in its slice.json (found by node id). */
function applyLocal(cwd, event) {
  // An HTML screen's pages are files of its folder, not part of slice.json.
  if (event.meta.pages) { writeScreenPages(paths(cwd), event.nodeId, event.meta.pages); return; }
  for (const { file } of loadSlices(paths(cwd))) {
    const slice = JSON.parse(readFileSync(file, 'utf8'));
    for (const kind of KINDS) {
      for (const node of slice[kind] || []) {
        if (node.id !== event.nodeId) continue;
        for (const [attribute, value] of Object.entries(event.meta)) node[attribute] = value;
        writeFileSync(file, JSON.stringify(slice, null, 2));
        return;
      }
    }
  }
  throw new Error('the node is no longer in the local model');
}

/** Sends the change's node:changed event verbatim, unless the board changed an attribute since the baseline (never overwritten) or already has the value. */
async function submitNodeChanged(cwd, cfg, change, fetchImpl) {
  const p = paths(cwd);
  const { event } = change.exec;
  if (event.meta.pages) return submitScreenPages(cwd, cfg, { nodeId: event.nodeId, pages: event.meta.pages, eventId: event.id }, fetchImpl);
  const local = findNode(cwd, { nodeId: event.nodeId });
  if (!local) return { status: 'gone', note: `${change.target.nodeTitle} is no longer in the local model` };
  const base = readBaseline(p, local.sliceId) || { commands: [], events: [], readmodels: [], screens: [], processors: [] };
  const baseEl = (base[local.kind] || []).find((e) => e.id === local.node.id);
  const state = readJson(p.state, {});
  const api = `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
  const headers = { 'x-token': cfg.token, 'x-user-id': 'prototype-sync', 'content-type': 'application/json', ...(cfg.agentId ? { 'x-agent-id': cfg.agentId } : {}) };
  const res = await fetchImpl(`${api}/slicedata?contextName=${encodeURIComponent(state.context)}&format=json`, { headers });
  if (!res.ok) throw new Error(`Reading the board before submitting failed: HTTP ${res.status} ${await res.text()}`);
  let onBoard;
  for (const s of (await res.json()).slices || []) for (const k of KINDS) for (const e of s[k] || []) if (e.id === local.node.id) onBoard = e;
  if (!onBoard) return { status: 'gone', note: `${local.node.title} no longer exists on the board` };
  const attributes = Object.keys(event.meta);
  const value = (el, a) => el[a] ?? empty(a);
  const advance = () => {
    const next = structuredClone(base);
    for (const e of next[local.kind] || []) if (e.id === local.node.id) for (const a of attributes) e[a] = event.meta[a];
    writeBaseline(p, local.sliceId, next);
  };
  if (attributes.every((a) => same(value(onBoard, a), event.meta[a]))) { advance(); return { status: 'already', note: 'the board already has this value' }; }
  const conflict = baseEl && attributes.find((a) => !same(value(onBoard, a), value(baseEl, a)));
  if (conflict) return { status: 'conflict', note: `${conflict} changed on the board since the fetch — not overwritten` };
  const post = await fetchImpl(`${api}/nodes/events`, { method: 'POST', headers, body: JSON.stringify([event]) });
  if (!post.ok) throw new Error(`Writing to the board failed: HTTP ${post.status} ${await post.text()}`);
  advance();
  return { status: 'submitted', note: `node:changed ${attributes.join(', ')} of ${local.node.title}` };
}

/**
 * Executes one change. `cfg` null / `toBoard` false: only the local half (a tool call has none, so it waits for the board).
 * An error in the local half rejects; one from the board is reported as status 'failed' so the order carries on.
 */
export async function executeChange(cwd, cfg, change, { toBoard = true, fetchImpl = fetch, skipLocal = false } = {}) {
  const { exec } = change;
  if (exec.kind === 'node:changed') {
    if (!skipLocal) applyLocal(cwd, exec.event); // skipLocal: it was applied earlier (a run without the board) — only the board is left
    if (!toBoard) return { applied: true, status: null, note: 'applied to the local model' };
    try { return { applied: true, ...(await submitNodeChanged(cwd, cfg, change, fetchImpl)) }; } catch (err) { return { applied: true, status: 'failed', note: err.message }; }
  }
  if (!toBoard) return { applied: false, status: null, note: 'a board tool call — waits for the board' };
  try {
    const note = await callTool(cfg, exec.call.name, exec.call.arguments, fetchImpl);
    return { applied: true, status: 'submitted', note: `${exec.call.name}${note ? `: ${note}` : ''}` };
  } catch (err) { return { applied: false, status: 'failed', note: `${exec.call.name}: ${err.message}` }; }
}
