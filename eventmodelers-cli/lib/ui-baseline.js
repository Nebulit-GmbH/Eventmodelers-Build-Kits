// Decides whether a slice's UI needs work: a hash of what the board says about the UI (the screen nodes'
// node hash, the user's `codeGen.uiPrompts`) is recorded after each
// successful UI build, and compared on the next one. Only a difference sends the agent back to the UI.
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export const BASELINE_FILE = 'ui-baseline.json';

const sha = (value) => createHash('sha256').update(stable(value)).digest('hex').slice(0, 16);

// JSON with sorted keys, so key order on the board never reads as a change.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

// The slice's folder under `.slices/`, found by id or (case-insensitive) title.
export function findSliceDir(kitDir, idOrTitle) {
  const slicesDir = join(kitDir, '.slices');
  if (!existsSync(slicesDir)) return null;
  const wanted = String(idOrTitle).trim().toLowerCase();
  for (const ctx of readdirSync(slicesDir, { withFileTypes: true })) {
    if (!ctx.isDirectory()) continue;
    for (const dir of readdirSync(join(slicesDir, ctx.name), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const path = join(slicesDir, ctx.name, dir.name);
      const slice = readJson(join(path, 'slice.json'));
      if (slice && (slice.id === idOrTitle || slice.title?.toLowerCase() === wanted)) return { path, slice };
    }
  }
  return null;
}

// Lists of the slice that are not board elements (or are hashed on their own).
const NOT_ELEMENTS = new Set(['screens', 'comments', 'screenImages']);
const BATCH = 50;

// `fetchNodes(ids)` -> the board's nodes for those ids (POST /nodes/query).
// The board stamps every node with a `hash`; use it as is. Content hash only as a fallback, for a board
// (or a /nodes/query) that does not return it.
// scope 'backend' (a kit that builds no UI) leaves out the screens and the UI prompts: a screen edit must not
// make it rebuild.
export async function fingerprint({ slice, fetchNodes, scope = 'ui' }) {
  const ui = scope !== 'backend';
  const prompts = ui ? slice.codeGen?.uiPrompts ?? [] : [];
  const screens = ui ? (slice.screens ?? []).filter((s) => s?.id) : [];
  // Every element the slice carries — commands, events, read models, processors, tables, actors, aggregates,
  // specifications, ... — so a new list the export grows is covered without touching this.
  const elements = Object.entries(slice)
    .filter(([k, v]) => !NOT_ELEMENTS.has(k) && Array.isArray(v))
    .flatMap(([, v]) => v)
    .filter((e) => e && typeof e === 'object' && e.id);
  const ids = [...new Set([...screens, ...elements].map((e) => e.id))];
  const byId = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const node of await fetchNodes(ids.slice(i, i + BATCH))) byId.set(node.id, node);
  }
  const missing = screens.filter((s) => !byId.has(s.id)).map((s) => s.title ?? s.id);
  if (missing.length) throw new Error(`screen node(s) not found on the board: ${missing.join(', ')}`);
  // One entry per node, so a later check can say *which* ones moved, not just that something did.
  const entry = (kind) => (item) => {
    const node = byId.get(item.id);
    const base = { id: item.id, kind, title: item.title ?? node?.node?.data?.title ?? node?.data?.title ?? item.id };
    if (!node) return { ...base, hash: 'missing' };
    if (node.hash) return { ...base, hash: node.hash };
    return { ...base, hash: sha({ content: node.meta ?? node.data ?? null, fields: item.fields ?? [] }) };
  };
  const screenNodes = screens.map(entry('screen'));
  const elementNodes = Object.entries(slice)
    .filter(([k, v]) => !NOT_ELEMENTS.has(k) && Array.isArray(v))
    .flatMap(([k, v]) => v.filter((e) => e && typeof e === 'object' && e.id).map(entry(k)));
  return {
    screen: screenNodes.length ? sha(screenNodes.map((n) => [n.id, n.hash])) : null,
    elements: elementNodes.length ? sha(elementNodes.map((n) => [n.id, n.hash])) : null,
    prompts: sha(prompts),
    promptList: prompts,
    nodes: [...screenNodes, ...elementNodes],
  };
}

export function readBaseline(sliceDir) {
  return readJson(join(sliceDir, BASELINE_FILE));
}

export function writeBaseline(sliceDir, fp, scope = 'ui') {
  const baseline = { scope, screenHash: fp.screen, elementsHash: fp.elements, uiPromptsHash: fp.prompts, uiPrompts: fp.promptList, nodes: fp.nodes, recordedAt: new Date().toISOString() };
  writeFileSync(join(sliceDir, BASELINE_FILE), JSON.stringify(baseline, null, 2) + '\n');
  return baseline;
}

// What differs node by node, against a baseline that recorded its nodes ({id, kind, title, hash}).
function diffNodes(before, now) {
  const was = new Map(before.map((n) => [n.id, n]));
  const is = new Map(now.map((n) => [n.id, n]));
  return {
    changedNodes: now.filter((n) => was.has(n.id) && was.get(n.id).hash !== n.hash),
    addedNodes: now.filter((n) => !was.has(n.id)),
    removedNodes: before.filter((n) => !is.has(n.id)),
  };
}

// Verdict: NO_BASELINE | UNCHANGED | CHANGED, with which parts changed, which nodes, and the prompts that are new.
// A baseline from before elements/nodes were tracked has no elementsHash/nodes — that is not a change.
export function compare(baseline, fp, scope = 'ui') {
  const none = { changedNodes: [], addedNodes: [], removedNodes: [] };
  // A baseline recorded under another scope says nothing about this one.
  if (!baseline || (baseline.scope ?? 'ui') !== scope) return { verdict: 'NO_BASELINE', screenChanged: true, elementsChanged: true, promptsChanged: fp.promptList.length > 0, newPrompts: fp.promptList, ...none };
  const screenChanged = baseline.screenHash !== fp.screen;
  const elementsChanged = baseline.elementsHash !== undefined && baseline.elementsHash !== fp.elements;
  const promptsChanged = baseline.uiPromptsHash !== fp.prompts;
  const seen = new Set(baseline.uiPrompts ?? []);
  const newPrompts = promptsChanged ? fp.promptList.filter((p) => !seen.has(p)) : [];
  const nodes = Array.isArray(baseline.nodes) ? diffNodes(baseline.nodes, fp.nodes) : none;
  return { verdict: screenChanged || elementsChanged || promptsChanged ? 'CHANGED' : 'UNCHANGED', screenChanged, elementsChanged, promptsChanged, newPrompts, ...nodes };
}
