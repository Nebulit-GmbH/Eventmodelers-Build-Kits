// Pushes local model edits back to the board. What changed is found by comparing each slice.json with its baseline
// (the copy taken at fetch time, advanced after every sync). Only attributes with an exact board write are synced —
// a field list or a description on an element that owns its node, and an HTML screen's pages (screens-sync.js). Everything else is listed as "not synced".
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { changedSlices, loadSlices, paths, readBaseline, readJson, same, writeBaseline } from './state.js';
import { screenOps, syncScreens } from './screens-sync.js';

export const KINDS = ['commands', 'events', 'readmodels', 'screens', 'processors'];
const SYNCED = new Set(['fields', 'description']);
const IGNORED = new Set(['comments', 'linkedId', 'prototype', 'sketched']);

/** { ops, notSynced } for one slice. An op is { nodeId, kind, title, attr, value, was }. */
export function diffSlice(base, cur) {
  const ops = [];
  const notSynced = [];
  for (const kind of KINDS) {
    const before = Object.fromEntries((base[kind] || []).map((e) => [e.id, e]));
    const after = Object.fromEntries((cur[kind] || []).map((e) => [e.id, e]));
    for (const e of Object.values(after)) if (!before[e.id]) notSynced.push(`new ${e.type} "${e.title}" (adding elements is not synced)`);
    for (const e of Object.values(before)) if (!after[e.id]) notSynced.push(`removed ${e.type} "${e.title}" (removing elements is not synced)`);
    for (const e of Object.values(after)) {
      const b = before[e.id];
      if (!b) continue;
      for (const key of new Set([...Object.keys(b), ...Object.keys(e)])) {
        if (IGNORED.has(key) || same(b[key], e[key])) continue;
        const label = `${e.type} "${e.title}"`;
        if (!SYNCED.has(key)) notSynced.push(`${label}: ${key} changed (${key === 'title' ? 'renames' : key === 'dependencies' ? 'wiring' : 'this attribute'} is not synced)`);
        else if (e.elementCopy) notSynced.push(`${label}: ${key} changed on a linked copy — change the original element instead`);
        else ops.push({ nodeId: e.id, kind, title: e.title, type: e.type, attr: key, value: e[key] ?? (key === 'fields' ? [] : ''), was: b[key] });
      }
    }
  }
  for (const key of ['specifications', 'storylines']) {
    if (!same(base[key], cur[key])) notSynced.push(`${key} changed (scenario and storyline changes are not synced yet)`);
  }
  return { ops, notSynced };
}

const summary = (op) => {
  if (op.attr === 'description') return `description`;
  const names = (v) => new Map((v || []).map((f) => [f.name, f]));
  const was = names(op.was), now = names(op.value);
  const parts = [];
  for (const [n, f] of now) parts.push(!was.has(n) ? `+${n}` : same(was.get(n), f) ? null : `~${n}`);
  for (const n of was.keys()) if (!now.has(n)) parts.push(`-${n}`);
  return `fields ${parts.filter(Boolean).join(' ') || '(reordered)'}`;
};

/** The pending changes across all slices, without touching the board. */
export function pending(cwd) {
  const p = paths(cwd);
  return changedSlices(p).map(({ id, slice, file }) => ({ id, file, slice, title: slice.title, base: readBaseline(p, id) || { commands: [], events: [], readmodels: [], screens: [], processors: [] }, ...diffSlice(readBaseline(p, id) || { commands: [], events: [], readmodels: [], screens: [], processors: [] }, slice) }));
}

/** Edits that are not on the board yet: in the slices (fields, descriptions …) or in an HTML screen. */
export const hasLocalChanges = (cwd) => changedSlices(paths(cwd)).length > 0 || screenOps(cwd).length > 0;

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** Shows the pending changes and, when `yes` or confirmed, writes them to the board. Returns { synced, skipped }. */
export async function runSync({ cwd, cfg, yes = false, dryRun = false, quiet = false, fetchImpl = fetch }) {
  const log = quiet ? () => {} : console.log;
  const p = paths(cwd);
  const state = readJson(p.state, {});
  const changes = pending(cwd);
  const ops = changes.flatMap((c) => c.ops.map((op) => ({ ...op, sliceId: c.id, slice: c.title })));
  for (const c of changes) {
    if (!c.ops.length && !c.notSynced.length) continue;
    log(`\n${c.title}`);
    for (const op of c.ops) log(`  sync      ${op.type} "${op.title}": ${summary(op)}`);
    for (const n of c.notSynced) log(`  not synced  ${n}`);
  }
  const screens = screenOps(cwd);
  for (const sc of screens) log(`  sync      HTML_SCREEN "${sc.title}": pages`);
  if (!ops.length && !screens.length) {
    log(changes.length ? '\nNothing that can be synced yet.' : 'Nothing to sync — the local model matches the board as last fetched or synced.');
    return { synced: 0, skipped: 0 };
  }
  const total = ops.length + screens.length;
  if (dryRun) return { synced: 0, skipped: total };
  if (!yes && !(await confirm(`\nWrite ${total} change${total === 1 ? '' : 's'} to the board?`))) return { synced: 0, skipped: total };

  const api = `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
  const headers = { 'x-token': cfg.token, 'x-user-id': 'prototype-sync', 'content-type': 'application/json', ...(cfg.agentId ? { 'x-agent-id': cfg.agentId } : {}) };

  // Conflicts: an attribute the board has changed since the baseline is never overwritten.
  const board = {};
  if (ops.length) {
    const res = await fetchImpl(`${api}/slicedata?contextName=${encodeURIComponent(state.context)}&format=json`, { headers });
    if (!res.ok) throw new Error(`Reading the board before syncing failed: HTTP ${res.status} ${await res.text()}`);
    for (const s of (await res.json()).slices || []) for (const k of KINDS) for (const e of s[k] || []) board[e.id] = e;
  }
  const ready = [];
  for (const op of ops) {
    const now = board[op.nodeId];
    if (!now) log(`  skipped   ${op.type} "${op.title}" no longer exists on the board`);
    else if (!same(now[op.attr] ?? (op.attr === 'fields' ? [] : ''), op.was ?? (op.attr === 'fields' ? [] : ''))) log(`  conflict  ${op.type} "${op.title}": ${op.attr} changed on the board since the fetch — not overwritten (run \`prototype --refresh --force\` to take the board's version)`);
    else ready.push(op);
  }
  if (ready.length) {
    const events = ready.map((op) => ({ id: randomUUID(), eventType: 'node:changed', nodeId: op.nodeId, changedAttributes: [`meta.${op.attr}`], meta: { [op.attr]: op.value } }));
    const post = await fetchImpl(`${api}/nodes/events`, { method: 'POST', headers, body: JSON.stringify(events) });
    if (!post.ok) throw new Error(`Writing to the board failed: HTTP ${post.status} ${await post.text()}`);
    // Advance the baseline for exactly what went through, so the rest stays pending.
    for (const c of changes) {
      const done = ready.filter((op) => op.sliceId === c.id);
      if (!done.length) continue;
      const base = structuredClone(c.base);
      for (const op of done) for (const e of base[op.kind] || []) if (e.id === op.nodeId) e[op.attr] = op.value;
      writeBaseline(p, c.id, base);
    }
  }
  // The screens: each HTML screen edited here, as the node:changed of its pages.
  const sent = screens.length ? await syncScreens(cwd, cfg, { log: (l) => log(l), fetchImpl }) : [];
  const screensDone = sent.filter((x) => x.status === 'submitted' || x.status === 'already').length;
  const synced = ready.length + screensDone;
  log(`\nSynced ${synced} of ${total} change${total === 1 ? '' : 's'}${synced < total ? ` — ${total - synced} left pending` : ''}.`);
  return { synced, skipped: total - synced };
}
