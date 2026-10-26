import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, plan, status } from '../extensions/prototype/local-build.js';
import { buildWalkthrough, walkthroughHtml } from '../extensions/prototype/walkthrough.js';
import { diffSlice, hasLocalChanges as hasLocalChangesOf, pending, runSync } from '../extensions/prototype/sync.js';
import { claim, control, detail, markProcessed, markTranslated, record, stateOf } from '../extensions/prototype/control.js';
import { addChange, listChanges } from '../extensions/prototype/changes.js';
import { runChanges, submitApplied } from '../extensions/prototype/pipeline.js';
import { createEmptyPrototype } from '../extensions/prototype/empty.js';
import { BOARD_WRITE_TOOLS, denyBoardWrites, refetchSafely } from '../extensions/prototype/index.js';
import { screensToDesign, syncScreens } from '../extensions/prototype/screens-sync.js';
import { editedScreens, loadScreens, loadSlices, paths, readBaseline, snapshotBaseline, snapshotScreens, writeJson, writeScreens } from '../extensions/prototype/state.js';

const DEMO = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'demo-slices', 'Understanding Eventsourcing');

// A project as `prototype` leaves it after the first fetch: the demo model under .prototype/.slices, baseline taken.
function project(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'proto-'));
  const p = paths(cwd);
  mkdirSync(join(p.slices, 'understandingeventsourcing'), { recursive: true });
  cpSync(DEMO, join(p.slices, 'understandingeventsourcing'), { recursive: true });
  mkdirSync(p.root, { recursive: true });
  writeJson(p.state, { context: 'Understanding Eventsourcing' });
  snapshotBaseline(p);
  return { cwd, p };
}

const editSlice = (p, title, fn) => {
  const e = loadSlices(p).find((s) => s.slice.title === title);
  fn(e.slice);
  writeFileSync(e.file, JSON.stringify(e.slice, null, 2));
  return e;
};

test('with no page yet every slice is new; a block for each assembles, and only an edited slice is changed afterwards', (t) => {
  const { cwd, p } = project(t);
  const first = status(cwd);
  assert.ok(first.slices.length > 0 && first.slices.every((s) => s.state === 'new'));
  assert.throws(() => assemble(cwd), /missing block/);
  for (const s of first.slices) {
    writeFileSync(join(p.blocks, `${s.id}.html`), `<script type="text/plain" data-em-slice="${s.id}" data-em-title="${s.title}" data-em-hash="${s.hash}">\nEMRuntime.defineSlice({});\n</script>\n`);
  }
  assemble(cwd);
  assert.ok(existsSync(p.page));
  assert.ok(plan(cwd).slices.every((s) => s.state === 'unchanged'));

  editSlice(p, 'Change Price', (s) => { s.commands[0].fields.push({ name: 'currency', type: 'String', example: '', mapping: '', optional: false, subfields: [], cardinality: 'Single', idAttribute: false }); });
  const next = plan(cwd);
  assert.deepEqual(next.slices.filter((s) => s.state === 'changed').map((s) => s.title), ['Change Price']);
});

test('a changed slice keeps its previous block in the work folder to be patched, and assemble takes its own status when there is none', (t) => {
  const { cwd, p } = project(t);
  for (const s of status(cwd).slices) {
    writeFileSync(join(p.blocks, `${s.id}.html`), `<script type="text/plain" data-em-slice="${s.id}" data-em-title="${s.title}" data-em-hash="${s.hash}">\nEMRuntime.defineSlice({});\n</script>\n`);
  }
  assemble(cwd);
  const edited = editSlice(p, 'Change Price', (s) => { s.description = 'changed'; s.commands[0].description = 'changed'; });
  const report = status(cwd);
  const changed = report.slices.find((s) => s.title === 'Change Price');
  assert.equal(changed.state, 'changed');
  // The previous block is there (old hash), so it is patched with Edit instead of written from nothing; assemble refuses until it has the new hash.
  const kept = readFileSync(join(p.blocks, `${changed.id}.html`), 'utf8');
  assert.match(kept, /EMRuntime\.defineSlice/);
  assert.throws(() => assemble(cwd), /data-em-hash is/);
  writeFileSync(join(p.blocks, `${changed.id}.html`), kept.replace(/data-em-hash="[^"]*"/, `data-em-hash="${changed.hash}"`));
  rmSync(join(p.work, 'status.json'));
  assemble(cwd); // no status.json: assemble takes one itself
  assert.ok(plan(cwd).slices.every((s) => s.state === 'unchanged'));
  assert.ok(edited);
});

test('a status change on a slice rebuilds nothing', (t) => {
  const { cwd, p } = project(t);
  const first = status(cwd);
  for (const s of first.slices) writeFileSync(join(p.blocks, `${s.id}.html`), `<script type="text/plain" data-em-slice="${s.id}" data-em-title="x" data-em-hash="${s.hash}">\n</script>\n`);
  assemble(cwd);
  editSlice(p, 'Add Item', (s) => { s.status = 'Done'; });
  assert.ok(plan(cwd).slices.every((s) => s.state === 'unchanged'));
});

test('diff: fields and description sync, a new element, a rename and a linked copy do not', () => {
  const field = (name) => ({ name, type: 'String', example: '', mapping: '', optional: false, subfields: [], cardinality: 'Single', idAttribute: false });
  const el = (id, title, extra = {}) => ({ id, title, type: 'COMMAND', fields: [field('a')], description: '', dependencies: [], elementCopy: false, ...extra });
  const base = { commands: [el('c1', 'Do'), el('c2', 'Copy', { elementCopy: true })], events: [], readmodels: [], screens: [], processors: [], specifications: [] };
  const cur = structuredClone(base);
  cur.commands[0].fields.push(field('b'));
  cur.commands[0].description = 'now documented';
  cur.commands[0].title = 'Do It';
  cur.commands[1].fields.push(field('z'));
  cur.commands.push(el('c3', 'Fresh'));
  cur.specifications = [{ title: 'new scenario' }];
  const { ops, notSynced } = diffSlice(base, cur);
  assert.deepEqual(ops.map((o) => `${o.nodeId}:${o.attr}`).sort(), ['c1:description', 'c1:fields']);
  assert.equal(notSynced.length, 4);
  assert.ok(notSynced.some((n) => /renames/.test(n)) && notSynced.some((n) => /linked copy/.test(n)) && notSynced.some((n) => /new COMMAND/.test(n)) && notSynced.some((n) => /scenario/.test(n)));
});

function board(slices, calls) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/slicedata')) return { ok: true, json: async () => ({ slices }) };
    return { ok: true, text: async () => '' };
  };
}
const cfg = { token: 't', organizationId: 'o', boardId: 'b' };

test('sync writes one node:changed batch, then the baseline has caught up and nothing is pending', async (t) => {
  const { cwd, p } = project(t);
  const original = structuredClone(loadSlices(p).map((e) => e.slice));
  editSlice(p, 'Change Price', (s) => { s.commands[0].fields[0].example = '9.99'; s.events[0].description = 'price changed'; });
  const calls = [];
  const result = await runSync({ cwd, cfg, yes: true, quiet: true, fetchImpl: board(original, calls) });
  assert.equal(result.synced, 2);
  const posts = calls.filter((c) => c.init.method === 'POST');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].url.endsWith('/nodes/events'));
  const events = JSON.parse(posts[0].init.body);
  assert.deepEqual(events.map((e) => e.changedAttributes[0]).sort(), ['meta.description', 'meta.fields']);
  assert.ok(events.every((e) => e.eventType === 'node:changed' && e.id && e.id !== e.nodeId));
  assert.equal(pending(cwd).length, 0);
  assert.equal(readBaseline(p, original.find((s) => s.title === 'Change Price').id).commands[0].fields[0].example, '9.99');
});

test('sync never overwrites an attribute the board changed in the meantime', async (t) => {
  const { cwd, p } = project(t);
  const onBoard = structuredClone(loadSlices(p).map((e) => e.slice));
  onBoard.find((s) => s.title === 'Change Price').commands[0].fields[0].example = 'someone else';
  editSlice(p, 'Change Price', (s) => { s.commands[0].fields[0].example = '9.99'; });
  const calls = [];
  const result = await runSync({ cwd, cfg, yes: true, quiet: true, fetchImpl: board(onBoard, calls) });
  assert.deepEqual(result, { synced: 0, skipped: 1 });
  assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0);
  assert.equal(pending(cwd).length, 1);
});

test('a dry run writes nothing and a clean project has nothing to sync', async (t) => {
  const { cwd, p } = project(t);
  assert.deepEqual(await runSync({ cwd, cfg, yes: true, quiet: true, fetchImpl: () => assert.fail('no request') }), { synced: 0, skipped: 0 });
  editSlice(p, 'Change Price', (s) => { s.commands[0].description = 'x'; });
  assert.deepEqual(await runSync({ cwd, cfg, dryRun: true, quiet: true, fetchImpl: () => assert.fail('no request') }), { synced: 0, skipped: 1 });
});

test('screens live as real html files in their own folder and read back unchanged; editing one rebuilds the slices that show it', (t) => {
  const { cwd, p } = project(t);
  const withScreen = loadSlices(p).find((e) => (e.slice.screens || []).length);
  const id = withScreen.slice.screens[0].linkedId || withScreen.slice.screens[0].id;
  const screens = { [id]: { type: 'HTML_SCREEN', title: 'Cart', pages: ['<div>one</div>', '<div>two</div>'], marks: [{ x: 1 }], cssFrameworks: ['bulma'] }, other: { type: 'HTML_SCREEN', pages: [{ name: 'p', html: '<p>x</p>' }], marks: null } };
  writeScreens(p, screens);
  assert.equal(readFileSync(join(p.screens, id, 'page-2.html'), 'utf8'), '<div>two</div>');
  assert.deepEqual(loadScreens(p), { [id]: { ...screens[id], id }, other: { ...screens.other, id: 'other' } });
  const before = plan(cwd);
  writeFileSync(join(p.screens, id, 'page-1.html'), '<div>edited</div>');
  const after = plan(cwd);
  const flagged = after.slices.filter((s, i) => s.hash !== before.slices[i].hash).map((s) => s.id);
  assert.deepEqual(flagged, loadSlices(p).filter((e) => (e.slice.screens || []).some((x) => (x.linkedId || x.id) === id)).map((e) => e.id));
});

test('the control log: the player records requests, the agent claims and processes them, and what is processed is never open again', (t) => {
  const { cwd } = project(t);
  const fb = record(cwd, 'FeedbackRecorded', { name: 'Todo App', events: [], feedbacks: [{ id: 'f1', comment: 'Show the count', element: { tag: 'main', path: 'main', text: '', html: '' }, trail: { screen: 'My Lists', slice: 'Change Price', events: [], interactions: [] } }] });
  const sync = record(cwd, 'SyncRequested');
  const rebuild = record(cwd, 'RebuildRequested');
  record(cwd, 'FeedbackSubmitted', { name: 'Round one', feedbacks: [{ id: 'f2', comment: 'later' }] });
  assert.deepEqual(control(cwd).pending.map((e) => e.type), ['FeedbackRecorded', 'SyncRequested', 'RebuildRequested'], 'oldest first; Submit is no request');
  assert.deepEqual(control(cwd).pending.map((e) => e.seq), [1, 2, 3]);
  assert.equal(stateOf(control(cwd), fb.id), 'sent');
  claim(cwd, fb.id);
  assert.equal(stateOf(control(cwd), fb.id), 'working');
  markProcessed(cwd, fb.id, 'applied', 'changed the model');
  assert.equal(stateOf(control(cwd), fb.id), 'applied');
  markProcessed(cwd, sync.id, 'needs-you', 'a conflict');
  assert.equal(stateOf(control(cwd), sync.id), 'needs-you');
  // A different process (or the next run) sees only the open request — the processed ones are remembered in the log itself.
  assert.deepEqual(control(cwd).pending.map((e) => e.id), [rebuild.id]);
  assert.throws(() => markProcessed(cwd, rebuild.id, 'done'), /outcome is one of/);
  assert.throws(() => record(cwd, 'ControlProcessed', {}), /Not an event the player records/);
  assert.throws(() => record(cwd, 'FeedbackRecorded', { feedbacks: [] }), /no feedback/);
});

test('a feedback event carries the slice title of the trail, whether the page marked the slice by title or id', (t) => {
  const { cwd, p } = project(t);
  mkdirSync(p.work, { recursive: true });
  writeJson(join(p.work, 'status.json'), { slices: [{ id: 'abc', title: 'Change Price' }] });
  const byTitle = record(cwd, 'FeedbackRecorded', { feedbacks: [{ id: '1', comment: 'x', trail: { slice: 'Change Price' } }] });
  const byId = record(cwd, 'FeedbackRecorded', { feedbacks: [{ id: '2', comment: 'x', trail: { slice: 'abc' } }] });
  assert.equal(byTitle.data.feedbacks[0].trail.sliceTitle, 'Change Price');
  assert.equal(byId.data.feedbacks[0].trail.sliceTitle, 'Change Price');
});

// ---- multi-stage update: feedback → executable changes → executed one by one ----

const feedback = (cwd, comment = 'x') => record(cwd, 'FeedbackRecorded', { name: 't', feedbacks: [{ id: comment, comment, trail: { slice: 'Change Price' } }] });
const priceCommand = (p) => loadSlices(p).find((s) => s.slice.title === 'Change Price').slice.commands[0];
const field = (name) => ({ name, type: 'String', example: '', mapping: '', optional: false, subfields: [], cardinality: 'Single', idAttribute: false, generated: false, edited: false, tag: false, query: false, technicalAttribute: false, showAttributes: false });
const nodeChange = (p, value, extra = {}) => ({
  summary: 'Add a currency field', scope: 'node', target: { sliceTitle: 'Change Price', nodeTitle: priceCommand(p).title }, action: 'add-field',
  change: { details: 'a currency field', after: 'currency' }, exec: { kind: 'node:changed', attribute: 'fields', value }, ...extra,
});

// A board that has the model as last fetched, answers the node event, and the MCP tool call.
function fakeBoard(cwd, { override = null } = {}) {
  const sent = { events: [], tools: [], order: [] };
  const p = paths(cwd);
  const impl = async (url, init = {}) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (String(url).includes('/slicedata')) {
      const slices = loadSlices(p).map(({ id }) => readBaseline(p, id));
      if (override) for (const s of slices) for (const k of ['commands', 'events', 'readmodels', 'screens', 'processors']) for (const e of s[k] || []) if (e.id === override.id) e[override.attr] = override.value;
      return ok({ slices });
    }
    if (String(url).endsWith('/nodes/events')) { sent.events.push(...JSON.parse(init.body)); sent.order.push('node:changed'); return ok({}); }
    if (String(url).endsWith('/mcp')) { const call = JSON.parse(init.body).params; sent.tools.push(call); sent.order.push(call.name); return ok({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }); }
    throw new Error(`unexpected ${url}`);
  };
  return { impl, sent };
}
const CFG = { baseUrl: 'http://board.test', organizationId: 'o', boardId: 'b', token: 't' };

test('a change names exactly what to change and carries the ids; changes and events share one global order', (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd);
  const cmd = priceCommand(p);
  const change = addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  const later = record(cwd, 'SyncRequested');
  assert.deepEqual([fb.seq, change.seq, later.seq], [1, 2, 3], 'one counter for the events and the changes');
  assert.equal(change.target.nodeId, cmd.id, 'the names were resolved against the model');
  assert.equal(change.exec.kind, 'node:changed');
  // the full instructions: the complete node event, its id the change's id — executed verbatim
  assert.deepEqual(change.exec.event, { id: change.id, eventType: 'node:changed', nodeId: cmd.id, changedAttributes: ['meta.fields'], meta: { fields: [...cmd.fields, field('currency')] } });
  assert.deepEqual(listChanges(cwd).map((c) => c.seq), [2]);
  assert.throws(() => addChange(cwd, fb.id, nodeChange(p, [], { target: { sliceTitle: 'Change Price', nodeTitle: 'No Such Thing' } })), /No such node/);
  assert.throws(() => addChange(cwd, fb.id, nodeChange(p, 'text')), /whole list of fields/);
  assert.throws(() => addChange(cwd, fb.id, { ...nodeChange(p, []), exec: { kind: 'tool-call', tool: 'delete_node', input: { nodeId: 'x' } } }), /never executed from feedback/);
  assert.throws(() => addChange(cwd, fb.id, { ...nodeChange(p, []), exec: undefined }), /what to execute/);
});

test('changes are executed one by one in order, locally and on the board, and the feedback follows them', async (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd);
  const cmd = priceCommand(p);
  const first = addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  const second = addChange(cwd, fb.id, { summary: 'Mark the slice Planned', scope: 'slice', target: { sliceTitle: 'Change Price' }, action: 'set-status', change: { details: 'Planned' }, exec: { kind: 'tool-call', tool: 'mcp__eventmodelers__update_slice_status', input: { sliceId: 'x', status: 'Planned' } } });
  markTranslated(cwd, fb.id, ['Which currencies?']);
  assert.equal(stateOf(control(cwd), fb.id), 'working', 'translated: the request follows its changes');
  assert.deepEqual(control(cwd).pending.map((e) => e.id), [], 'a translated feedback is not translated again');

  const board = fakeBoard(cwd);
  const { local, toolCalls } = await runChanges(cwd, CFG, { toBoard: true, fetchImpl: board.impl });
  assert.ok(local && toolCalls);
  assert.deepEqual(board.sent.events.map((e) => [e.id, e.eventType, e.changedAttributes[0]]), [[first.id, 'node:changed', 'meta.fields']], 'the node event: its id is the change id');
  assert.deepEqual(board.sent.events[0].meta.fields.map((f) => f.name), [...cmd.fields.map((f) => f.name), 'currency']);
  assert.deepEqual(board.sent.tools.map((c) => [c.name, c.arguments.boardId, c.arguments.status]), [['update_slice_status', 'b', 'Planned']], 'the tool call as recorded, boardId filled in');
  assert.ok(priceCommand(p).fields.some((f) => f.name === 'currency'), 'applied to the local model');
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['submitted', 'submitted']);
  assert.equal(stateOf(control(cwd), fb.id), 'needs-you', 'the open question is still the person\'s');
  assert.match(control(cwd).processed.get(fb.id).note, /2 of 2 changes applied.*question: Which currencies/);
  // the baseline advanced for exactly that attribute: sync has nothing left to send for it
  assert.deepEqual(pending(cwd).flatMap((c) => c.ops), []);
  assert.deepEqual(second.seq > first.seq, true);
});

test('without the board a change is applied locally and waits; a tool call keeps the order and waits too; Sync writes them', async (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd);
  const cmd = priceCommand(p);
  addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  addChange(cwd, fb.id, { summary: 'A scenario', scope: 'slice', target: { sliceTitle: 'Change Price' }, action: 'add-scenario', change: { details: 'x' }, exec: { kind: 'tool-call', tool: 'add_scenario', input: {} } });
  markTranslated(cwd, fb.id);
  const first = await runChanges(cwd, null, { toBoard: false });
  assert.equal(first.results.length, 1, 'stopped at the tool call: the order is kept');
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['applied', 'requested']);
  assert.equal(stateOf(control(cwd), fb.id), 'working');

  const board = fakeBoard(cwd);
  assert.equal((await submitApplied(cwd, CFG, () => {}, board.impl)).length, 1, 'the applied one goes to the board, in order');
  assert.equal(board.sent.events.length, 1);
  await runChanges(cwd, CFG, { toBoard: true, fetchImpl: board.impl });
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['submitted', 'submitted']);
  assert.equal(stateOf(control(cwd), fb.id), 'applied');
});

test('a node event is never forced over a change made on the board, and a failed tool call does not stop the rest', async (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd);
  const cmd = priceCommand(p);
  addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  addChange(cwd, fb.id, { summary: 'Broken call', scope: 'board', target: {}, action: 'x', change: { details: 'x' }, exec: { kind: 'tool-call', tool: 'create_slice', input: {} } });
  markTranslated(cwd, fb.id);
  const board = fakeBoard(cwd, { override: { id: cmd.id, attr: 'fields', value: [field('changed-on-the-board')] } });
  const failing = async (url, init) => (String(url).endsWith('/mcp') ? ({ ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'no such thing' }] } }) }) : board.impl(url, init));
  const { results } = await runChanges(cwd, CFG, { toBoard: true, fetchImpl: failing });
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['conflict', 'failed']);
  assert.equal(board.sent.events.length, 0, 'nothing was written over the board\'s change');
  assert.equal(results.length, 2);
  assert.equal(stateOf(control(cwd), fb.id), 'needs-you');
  assert.match(control(cwd).processed.get(fb.id).note, /failed: Broken call \(create_slice: no such thing\).*conflict on the board/);
});

test('Sync is one ordered pass: a change applied earlier is written before the tool call that came after it', async (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd);
  const cmd = priceCommand(p);
  addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  addChange(cwd, fb.id, { summary: 'Planned', scope: 'slice', target: { sliceTitle: 'Change Price' }, action: 'set-status', change: { details: 'x' }, exec: { kind: 'tool-call', tool: 'update_slice_status', input: {} } });
  addChange(cwd, fb.id, { summary: 'Describe it', scope: 'node', target: { sliceTitle: 'Change Price', nodeTitle: cmd.title }, action: 'set-description', change: { details: 'x' }, exec: { kind: 'node:changed', attribute: 'description', value: 'Changes the price' } });
  markTranslated(cwd, fb.id);
  await runChanges(cwd, null, { toBoard: false }); // local only: the first change is applied, the tool call stops it
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['applied', 'requested', 'requested']);
  const board = fakeBoard(cwd);
  await runChanges(cwd, CFG, { toBoard: true, fetchImpl: board.impl });
  assert.deepEqual(board.sent.order, ['node:changed', 'update_slice_status', 'node:changed'], 'global order, one pass');
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['submitted', 'submitted', 'submitted']);
});

test('a screen edited here is told from the board\'s version: the fetch baseline survives a new slice baseline, and an edit shows until it is kept', (t) => {
  const { cwd, p } = project(t);
  const screens = { s1: { type: 'HTML_SCREEN', title: 'Home', pages: ['<p>board</p>'], marks: null, cssFrameworks: [] }, s2: { type: 'HTML_SCREEN', title: 'Other', pages: ['<p>other</p>'], marks: null, cssFrameworks: [] } };
  writeScreens(p, screens);
  assert.deepEqual(editedScreens(p), [], 'nothing remembered yet: nothing is an edit');
  snapshotScreens(p);
  snapshotBaseline(p); // a new slice baseline must not forget the screens
  assert.deepEqual(editedScreens(p), []);
  writeFileSync(join(p.screens, 's1', 'page-1.html'), '<p>edited here</p>');
  assert.deepEqual(editedScreens(p), ['s1'], 'only the edited screen');
  snapshotScreens(p, ['s1']); // a fetch that kept it: still an edit afterwards
  assert.deepEqual(editedScreens(p), ['s1']);
  snapshotScreens(p); // taking the board's version again
  assert.deepEqual(editedScreens(p), []);
});

test('an empty prototype is one Hello World slice with its page, already built, with nothing to sync and nothing stale — and no board needed', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'proto-empty-'));
  const made = createEmptyPrototype(cwd);
  const p = paths(cwd);
  assert.equal(loadSlices(p).length, 1);
  assert.equal(loadSlices(p)[0].slice.title, 'Hello World');
  assert.equal(Object.values(loadScreens(p)).length, 1);
  assert.match(readFileSync(p.page, 'utf8'), /Hello World/);
  assert.deepEqual(plan(cwd).slices.map((s) => s.state), ['unchanged'], 'built: nothing stale');
  assert.equal(plan(cwd).context, 'My Prototype');
  assert.deepEqual(pending(cwd), [], 'nothing to sync');
  assert.deepEqual(editedScreens(p), [], 'the screen is the baseline');
  assert.ok(made.sliceId && made.screenId);
});

// ---- screens go to the board too ----

// A board whose screen nodes hold the given pages, recording what is written to it.
function screenBoard(pages) {
  const sent = [];
  const impl = async (url, init = {}) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (String(url).endsWith('/nodes/query')) return ok(JSON.parse(init.body).ids.map((id) => ({ id, type: 'HTML_SCREEN', meta: { pages: pages[id] } })));
    if (String(url).endsWith('/nodes/events')) { sent.push(...JSON.parse(init.body)); return ok({}); }
    throw new Error(`unexpected ${url}`);
  };
  return { impl, sent };
}

test('an HTML screen edited here is written to the board as node:changed meta.pages, never over a board change, and the baseline follows', async (t) => {
  const { cwd, p } = project(t);
  const board = { s1: ['<p>board one</p>'], s2: ['<p>board two</p>'] };
  writeScreens(p, { s1: { type: 'HTML_SCREEN', title: 'Home', pages: [...board.s1], marks: null, cssFrameworks: [] }, s2: { type: 'HTML_SCREEN', title: 'Other', pages: [...board.s2], marks: null, cssFrameworks: [] } });
  snapshotScreens(p);
  assert.equal(hasLocalChangesOf(cwd), false);
  writeFileSync(join(p.screens, 's1', 'page-1.html'), '<p>edited here</p>');
  assert.equal(hasLocalChangesOf(cwd), true, 'an edited screen is a local change');
  const fake = screenBoard(board);
  const first = await syncScreens(cwd, CFG, { fetchImpl: fake.impl });
  assert.deepEqual(first.map((r) => [r.nodeId, r.status]), [['s1', 'submitted']]);
  assert.deepEqual(fake.sent.map((e) => [e.eventType, e.nodeId, e.changedAttributes[0], e.meta.pages]), [['node:changed', 's1', 'meta.pages', ['<p>edited here</p>']]]);
  assert.deepEqual(editedScreens(p), [], 'the baseline follows what was written');
  assert.equal(hasLocalChangesOf(cwd), false);

  // The board changed the screen since the fetch: not overwritten.
  writeFileSync(join(p.screens, 's2', 'page-1.html'), '<p>edited here too</p>');
  const changed = screenBoard({ ...board, s2: ['<p>someone else on the board</p>'] });
  const second = await syncScreens(cwd, CFG, { fetchImpl: changed.impl });
  assert.deepEqual(second.map((r) => [r.nodeId, r.status]), [['s2', 'conflict']]);
  assert.equal(changed.sent.length, 0);
});

test('feedback can change a screen: a node:changed of pages is applied to the local files and written to the board as the change\'s event', async (t) => {
  const { cwd, p } = project(t);
  const withScreen = loadSlices(p).find(({ slice }) => (slice.screens || []).length);
  const node = withScreen.slice.screens[0];
  const contentId = node.linkedId || node.id;
  writeScreens(p, { [contentId]: { type: 'HTML_SCREEN', title: node.title, pages: ['<p>old</p>'], marks: null, cssFrameworks: [] } });
  snapshotScreens(p);
  const fb = record(cwd, 'FeedbackRecorded', { name: 't', feedbacks: [{ id: 'f', comment: 'x', trail: { slice: withScreen.slice.title } }] });
  const change = addChange(cwd, fb.id, { summary: 'Add a description input', scope: 'node', target: { sliceTitle: withScreen.slice.title, nodeTitle: node.title, nodeType: node.type }, action: 'edit-screen', change: { details: 'x' }, exec: { kind: 'node:changed', attribute: 'pages', value: ['<p>new with description</p>'] } });
  assert.equal(change.exec.event.nodeId, contentId);
  assert.deepEqual(change.exec.event.changedAttributes, ['meta.pages']);
  assert.throws(() => addChange(cwd, fb.id, { summary: 'x', scope: 'node', target: { sliceTitle: withScreen.slice.title, nodeTitle: node.title }, action: 'x', change: { details: 'x' }, exec: { kind: 'node:changed', attribute: 'pages', value: [] } }), /whole list of pages/);
  markTranslated(cwd, fb.id);
  const fake = screenBoard({ [contentId]: ['<p>old</p>'] });
  await runChanges(cwd, CFG, { toBoard: true, fetchImpl: fake.impl });
  assert.equal(readFileSync(join(p.screens, contentId, 'page-1.html'), 'utf8'), '<p>new with description</p>', 'applied locally');
  assert.deepEqual(fake.sent.map((e) => [e.id, e.meta.pages]), [[change.id, ['<p>new with description</p>']]]);
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['submitted']);
  assert.deepEqual(editedScreens(p), [], 'written to the board: the baseline follows');
});

test('a feedback can ask with options, be answered in the modal, and be discarded — which removes the change files that were not executed yet', async (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd, 'make it better');
  const cmd = priceCommand(p);
  addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  markTranslated(cwd, fb.id, [{ question: 'Which currencies?', options: ['EUR only', 'EUR and USD', 'EUR only', ''] }, 'Free text?']);
  const d = detail(cwd, fb.id);
  assert.deepEqual(d.questions.map((q) => [q.question, q.options]), [['Which currencies?', ['EUR only', 'EUR and USD', 'EUR only']], ['Free text?', []]], 'structured questions, plain text allowed');
  assert.equal(d.comments[0].comment, 'make it better');
  assert.equal(d.state, 'working', 'its change has not run yet');

  // the person answers one by option, one in their own words
  const [q1, q2] = d.questions;
  const answered = record(cwd, 'FeedbackAnswered', { ref: fb.id, answers: [{ question: q1.id, answer: 'EUR and USD' }, { question: q2.id, answer: 'only for new lists' }] });
  assert.deepEqual(answered.data.answers.map((a) => [a.text, a.answer]), [['Which currencies?', 'EUR and USD'], ['Free text?', 'only for new lists']], 'the question text travels with the answer');
  assert.deepEqual(control(cwd).pending.map((e) => e.type), ['FeedbackAnswered'], 'an answer is a request: the next iteration translates it');
  assert.throws(() => record(cwd, 'FeedbackAnswered', { ref: fb.id, answers: [{ question: q1.id, answer: '  ' }] }), /no answer/);
  addChange(cwd, answered.id, { summary: 'Describe it', scope: 'node', target: { sliceTitle: 'Change Price', nodeTitle: cmd.title }, action: 'set-description', change: { details: 'x' }, exec: { kind: 'node:changed', attribute: 'description', value: 'Prices in EUR and USD' } });
  markTranslated(cwd, answered.id);
  assert.equal(listChanges(cwd).length, 2);

  // discard: both changes were not executed yet — their files go, the log keeps the story
  record(cwd, 'FeedbackDiscarded', { ref: fb.id });
  assert.equal(listChanges(cwd).length, 0, 'the change files are removed');
  assert.equal(stateOf(control(cwd), fb.id), 'discarded', 'even a feedback that was waiting for an answer (processed as needs-you)');
  assert.equal(stateOf(control(cwd), answered.id), 'discarded');
  assert.deepEqual(control(cwd).pending, []);
  assert.ok(control(cwd).events.some((e) => e.type === 'FeedbackDiscarded'));
});

test('discarding keeps what was already executed', async (t) => {
  const { cwd, p } = project(t);
  const fb = feedback(cwd);
  const cmd = priceCommand(p);
  addChange(cwd, fb.id, nodeChange(p, [...cmd.fields, field('currency')]));
  addChange(cwd, fb.id, { summary: 'Describe it', scope: 'node', target: { sliceTitle: 'Change Price', nodeTitle: cmd.title }, action: 'set-description', change: { details: 'x' }, exec: { kind: 'node:changed', attribute: 'description', value: 'later' } });
  markTranslated(cwd, fb.id, ['Sure?']);
  await runChanges(cwd, null, { toBoard: false });
  assert.deepEqual(control(cwd).changes.map((c) => c.state), ['applied', 'applied']);
  record(cwd, 'FeedbackDiscarded', { ref: fb.id });
  assert.equal(listChanges(cwd).length, 2, 'applied changes stay: they are history');
});

test('a screen of a slice created by a tool call has no design: it is found for the loop to design, and gone once it has pages', (t) => {
  const { cwd, p } = project(t);
  const withScreen = loadSlices(p).find(({ slice }) => (slice.screens || []).length);
  const node = withScreen.slice.screens[0];
  const id = node.linkedId || node.id;
  writeScreens(p, { [id]: { type: 'HTML_SCREEN', title: node.title, pages: null, marks: null, cssFrameworks: [] } });
  assert.deepEqual(screensToDesign(cwd).map((s) => [s.screenId, s.sliceTitle]), [[id, withScreen.slice.title]], 'design pending');
  writeScreens(p, { [id]: { type: 'HTML_SCREEN', title: node.title, pages: ['   '], marks: null, cssFrameworks: [] } });
  assert.equal(screensToDesign(cwd).length, 1, 'blank pages are no design either');
  writeScreens(p, { [id]: { type: 'HTML_SCREEN', title: node.title, pages: ['<p>designed</p>'], marks: null, cssFrameworks: [] } });
  assert.deepEqual(screensToDesign(cwd), []);
});

test('the board\'s write tools are denied in a prototype folder, reads and the rest of the settings stay', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'proto-deny-'));
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ env: { EVENTMODELERS_TOKEN: 'x' }, permissions: { deny: ['Bash(rm:*)'], allow: ['Read'] } }));
  denyBoardWrites(cwd);
  denyBoardWrites(cwd); // twice: no duplicates
  const s = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(s.env.EVENTMODELERS_TOKEN, 'x');
  assert.deepEqual(s.permissions.allow, ['Read']);
  assert.ok(s.permissions.deny.includes('Bash(rm:*)'));
  for (const w of ['create_slice', 'place_element', 'submit_node_events', 'set_connection', 'add_scenario', 'delete_node']) assert.ok(s.permissions.deny.includes(`mcp__eventmodelers__${w}`), w);
  for (const r of ['get_nodes', 'get_board_outline', 'list_slices', 'validate_model']) assert.ok(!s.permissions.deny.includes(`mcp__eventmodelers__${r}`), `${r} stays readable`);
  assert.equal(new Set(s.permissions.deny).size, s.permissions.deny.length);
  denyBoardWrites(cwd, false);
  const back = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(back.permissions.deny, ['Bash(rm:*)'], 'only what was added is removed');
  assert.ok(BOARD_WRITE_TOOLS.length > 25);
});

test('a failing fetch inside the running player rejects instead of ending the process (it used to turn the page white)', async (t) => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'No context or timeline found', code: 'CONTEXT_NOT_FOUND' })); });
  await new Promise((ok) => server.listen(0, ok));
  t.after(() => server.close());
  const { cwd } = project(t);
  const realExit = process.exit;
  const cfg = { baseUrl: `http://127.0.0.1:${server.address().port}`, organizationId: 'o', boardId: 'b', token: 't' };
  await assert.rejects(() => refetchSafely(cwd, { cfg, reprompt: async () => cfg }, 'Gone'), /fetch failed/);
  assert.equal(process.exit, realExit, 'process.exit is put back');
});

test('walkthrough: one step per slice that differs from the board', (t) => {
  const { cwd, p } = project(t);
  assert.equal(buildWalkthrough(cwd).steps.length, 0);
  const [{ file, slice }] = loadSlices(p);
  const e = slice.events[0];
  e.fields = [...(e.fields || []), { name: 'walkthroughField', type: 'String' }];
  e.title = `${e.title} Renamed`;
  writeFileSync(file, JSON.stringify(slice));
  const w = buildWalkthrough(cwd);
  assert.equal(w.steps.length, 1);
  assert.equal(w.steps[0].status, 'changed');
  assert.ok(w.steps[0].changes.some((c) => c.includes('add field walkthroughField')));
  assert.ok(w.steps[0].notSynced.some((c) => c.includes('renames')));
  assert.match(walkthroughHtml({ ...w, studio: 'https://x/?board=1' }), /Open the board/);
  rmSync(cwd, { recursive: true, force: true });
});
