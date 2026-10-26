// Stage two of a multi-stage update: feedback (FeedbackRecorded in events/) is translated into ChangeRequested events — one per thing to
// change, each saying where (a node, a slice or the board), what, and carrying what can simply be EXECUTED, no agent needed:
//
//   exec { kind: 'node:changed', event: { id, eventType: 'node:changed', nodeId, changedAttributes, meta } }
//        (meta: a node's fields / description, or an HTML screen's pages) the complete node event: applied to the local model, and sent to the board verbatim — the very event sync.js writes
//   exec { kind: 'tool-call', call: { name, arguments } }
//        the complete board tool call (an eventmodelers MCP tool: add a scenario, create a slice …), replayed as recorded (boardId is filled in)
//
// The translation (feedback → changes) is the only judgment; running them (execute.js) is deterministic. They live next to the control log,
// in .prototype/changes/, and share its global order: one counter (events.seq) numbers events and changes alike, so `seq` says what
// came before what, and changes are executed one by one in that order.
//
//   .prototype/events/    what happened: FeedbackRecorded, FeedbackTranslated, ChangeClaimed / ChangeApplied / ChangeSubmitted / ChangeFailed …
//   .prototype/changes/   what to do:    000007-<id>.json, 000009-<id>.json … the ChangeRequested events
//
// A node:changed carries the whole new value of the attribute, so changes that touch the same attribute are merged by the translation into one
// (or follow each other, each built on the last). A tool call is never a destructive one: deleting is a question for the person.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readEvents } from '../../shared/build-kit/lib/slice-events.js';
import { KINDS } from './sync.js';
import { loadScreens, loadSlices, paths } from './state.js';

export const SCOPES = ['node', 'slice', 'board'];
export const BOARD_ATTRIBUTES = ['fields', 'description'];
const SEQ_FILE = 'events.seq'; // the control log's counter (slice-events.js), shared

/** The next number of the global order: after the newest event, the newest change and whatever the counter remembers. */
function nextSeq(cwd) {
  const root = paths(cwd).root;
  const file = join(root, SEQ_FILE);
  let remembered = 0;
  try { remembered = parseInt(readFileSync(file, 'utf8'), 10) || 0; } catch { /* none yet */ }
  const events = readEvents(root);
  const newest = Math.max(0, ...events.map((e) => e.seq || 0), ...listChanges(cwd).map((c) => c.seq || 0));
  const seq = Math.max(remembered, newest) + 1;
  mkdirSync(root, { recursive: true });
  writeFileSync(file, String(seq));
  return seq;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The element a change names, on disk: by node id, else by slice title + node title. { sliceId, slice, kind, node } or null. */
export function findNode(cwd, target) {
  const p = paths(cwd);
  const sliceRef = text(target.sliceId) || text(target.sliceTitle);
  for (const { id, slice } of loadSlices(p)) {
    if (sliceRef && id !== sliceRef && slice.title !== sliceRef) continue;
    for (const kind of KINDS) {
      for (const node of slice[kind] || []) {
        if (text(target.nodeId) ? node.id === text(target.nodeId) : node.title === text(target.nodeTitle) && (!text(target.nodeType) || node.type === text(target.nodeType))) return { sliceId: id, slice, kind, node };
      }
    }
  }
  return null;
}

const TOOL = /^[a-z][a-z0-9_]*$/;
// What a feedback must never make happen unattended: removing things from the board. Those are a question for the person.
const DESTRUCTIVE = new Set(['delete_node', 'delete_column', 'remove_lane', 'clear_cell', 'delete_drawing']);

/**
 * Writes one ChangeRequested. `spec`:
 *   summary  one line a person can read
 *   scope    node | slice | board — how wide the change is;  target: node { sliceTitle|sliceId, nodeTitle|nodeId, nodeType? } · slice { sliceTitle|sliceId } · board {}
 *   action   one verb: edit-text, set-description, add-field, remove-field, rename, add-scenario, add-slice, edit-screen …
 *   change   { details, before?, after? } — the concrete change, as exact as the feedback allows
 *   exec     what to execute — { kind: 'node:changed', attribute, value } on the target node, or { kind: 'tool-call', tool, input }
 *   feedbackItem, comment — which comment it came from
 */
export function addChange(cwd, feedbackEvent, spec) {
  const scope = text(spec.scope);
  if (!SCOPES.includes(scope)) throw new Error(`scope is one of: ${SCOPES.join(', ')}`);
  const target = spec.target && typeof spec.target === 'object' ? spec.target : {};
  if (scope !== 'board' && !(text(target.sliceTitle) || text(target.sliceId))) throw new Error(`a ${scope} change names its slice (target.sliceTitle or target.sliceId)`);
  if (scope === 'node' && !(text(target.nodeTitle) || text(target.nodeId))) throw new Error('a node change names its node (target.nodeTitle or target.nodeId)');
  if (!text(spec.action)) throw new Error('say what to do: action');
  if (!text(spec.summary)) throw new Error('give a one-line summary');
  const change = spec.change && typeof spec.change === 'object' ? spec.change : {};
  if (!text(change.details)) throw new Error('say what changes: change.details (and change.before / change.after where there is a before and after)');
  const x = spec.exec && typeof spec.exec === 'object' ? spec.exec : null;
  if (!x) throw new Error('say what to execute: exec — { kind: "node:changed", attribute, value } or { kind: "tool-call", tool, input }');

  // The names are resolved against the model on disk, so a change can only point at something that exists — and carries the ids.
  const resolved = { ...(text(target.sliceId) ? { sliceId: text(target.sliceId) } : {}), ...(text(target.sliceTitle) ? { sliceTitle: text(target.sliceTitle) } : {}), ...(text(target.nodeId) ? { nodeId: text(target.nodeId) } : {}), ...(text(target.nodeTitle) ? { nodeTitle: text(target.nodeTitle) } : {}), ...(text(target.nodeType) ? { nodeType: text(target.nodeType) } : {}) };
  let hit = null;
  if (scope === 'node') {
    hit = findNode(cwd, target);
    if (!hit) throw new Error(`No such node in the model: ${text(target.nodeTitle) || text(target.nodeId)} in ${text(target.sliceTitle) || text(target.sliceId)}`);
    Object.assign(resolved, { sliceId: hit.sliceId, sliceTitle: hit.slice.title, nodeId: hit.node.id, nodeTitle: hit.node.title, nodeType: hit.node.type });
  } else if (scope === 'slice') {
    const sliceRef = text(target.sliceId) || text(target.sliceTitle);
    const s = loadSlices(paths(cwd)).find(({ id, slice }) => id === sliceRef || slice.title === sliceRef);
    if (!s) throw new Error(`No such slice in the model: ${sliceRef}`);
    Object.assign(resolved, { sliceId: s.id, sliceTitle: s.slice.title });
  }

  // The change's id is the id of its node event: sending it twice is the same event.
  const id = randomUUID();
  let exec;
  if (x.kind === 'node:changed') {
    if (!hit) throw new Error('a node:changed is a change of a node — scope "node", with its target');
    // The full event, or the shorthand { attribute, value } that is expanded into it.
    const meta = x.event ? x.event.meta : { [text(x.attribute)]: x.value };
    const attributes = Object.keys(meta || {});
    const isScreen = hit.kind === 'screens';
    const allowed = isScreen ? [...BOARD_ATTRIBUTES, 'pages'] : BOARD_ATTRIBUTES;
    if (!attributes.length || attributes.some((a) => !allowed.includes(a))) throw new Error(`the board takes these attributes exactly: ${allowed.join(', ')} — anything else is a tool call`);
    // An HTML screen's content is its pages (the page-N.html files of its folder in .prototype/screens/): the whole list, on its own, on the node that holds them.
    const pagesChange = attributes.includes('pages');
    if (pagesChange && attributes.length > 1) throw new Error('pages are changed on their own — one change for the pages, another for fields or description');
    if (pagesChange) {
      const contentId = hit.node.linkedId || hit.node.id;
      if (!Array.isArray(meta.pages) || !meta.pages.length) throw new Error('the value of pages is the whole list of pages (each the page\'s html as text, or an object with an html property)');
      if (!loadScreens(paths(cwd))[contentId]) throw new Error(`No local screen for ${hit.node.title} (.prototype/screens/${contentId}) — fetch the model first`);
      hit.contentId = contentId;
    } else if (hit.node.elementCopy) throw new Error(`${hit.node.title} is a linked copy — name the original element`);
    for (const a of attributes) {
      if (a === 'pages') continue;
      if (meta[a] === undefined) throw new Error('node:changed needs the whole new value of the attribute');
      if (a === 'fields' && !Array.isArray(meta[a])) throw new Error('the value of fields is the whole list of fields');
      if (a === 'description' && typeof meta[a] !== 'string') throw new Error('the value of description is text');
    }
    exec = { kind: 'node:changed', event: { id, eventType: 'node:changed', nodeId: hit.contentId || hit.node.id, changedAttributes: attributes.map((a) => `meta.${a}`), meta } };
  } else if (x.kind === 'tool-call') {
    const call = x.call || { name: x.tool, arguments: x.input };
    const name = text(call.name).replace(/^mcp__eventmodelers__/, '');
    if (!TOOL.test(name)) throw new Error(`not a tool name: ${text(call.name)}`);
    if (DESTRUCTIVE.has(name)) throw new Error(`${name} removes things from the board — never executed from feedback; ask the person instead (a question in "changes translated --question")`);
    if (!call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Error('a tool call has an arguments object');
    exec = { kind: 'tool-call', call: { name, arguments: call.arguments } };
  } else throw new Error('exec.kind is node:changed or tool-call');

  const seq = nextSeq(cwd);
  const record = {
    id, seq, type: 'ChangeRequested', at: new Date().toISOString(),
    from: { feedbackEvent, ...(text(spec.feedbackItem) ? { feedbackItem: text(spec.feedbackItem) } : {}), ...(text(spec.comment) ? { comment: text(spec.comment).slice(0, 500) } : {}) },
    scope, target: resolved, action: text(spec.action), change, summary: text(spec.summary).slice(0, 200), exec,
  };
  const dir = paths(cwd).changes;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${String(seq).padStart(6, '0')}-${id.slice(0, 8)}.json`), JSON.stringify(record, null, 2));
  return record;
}

/** Every change request, in global order. */
export function listChanges(cwd) {
  const dir = paths(cwd).changes;
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* none yet */ }
  const out = [];
  for (const f of files) { try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); } catch { /* unreadable — skipped */ } }
  return out;
}

/** Removes change files by id — what a discarded feedback never got to do. */
export function removeChangeFiles(cwd, ids) {
  const dir = paths(cwd).changes;
  let files = [];
  try { files = readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const f of files) if (ids.some((id) => f.includes(`-${id.slice(0, 8)}.json`))) { rmSync(join(dir, f)); n++; }
  return n;
}
