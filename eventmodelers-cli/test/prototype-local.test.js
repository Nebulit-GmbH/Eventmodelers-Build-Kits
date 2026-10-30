import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, plan, status } from '../extensions/prototype/local-build.js';
import { buildWalkthrough, walkthroughHtml } from '../extensions/prototype/walkthrough.js';
import { diffSlice, hasLocalChanges as hasLocalChangesOf, pending, runSync } from '../extensions/prototype/sync.js';
import { claim, control, markProcessed, record, stateOf } from '../extensions/prototype/control.js';
import { submitFeedback } from '../extensions/prototype/feedback.js';
import { serve } from '../extensions/prototype/serve.js';
import { playLink, share } from '../extensions/prototype/share.js';
import { createEmptyPrototype } from '../extensions/prototype/empty.js';
import { BOARD_WRITE_TOOLS, denyBoardWrites, refetchSafely } from '../extensions/prototype/index.js';
import { syncScreens } from '../extensions/prototype/screens-sync.js';
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
  const fetch = record(cwd, 'FetchRequested');
  const sync = record(cwd, 'SyncRequested');
  const rebuild = record(cwd, 'RebuildRequested');
  assert.deepEqual(control(cwd).pending.map((e) => e.type), ['FetchRequested', 'SyncRequested', 'RebuildRequested'], 'oldest first');
  assert.equal(stateOf(control(cwd), fetch.id), 'sent');
  claim(cwd, fetch.id);
  assert.equal(stateOf(control(cwd), fetch.id), 'working');
  markProcessed(cwd, fetch.id, 'applied', 'fetched');
  assert.equal(stateOf(control(cwd), fetch.id), 'applied');
  markProcessed(cwd, sync.id, 'needs-you', 'a conflict');
  assert.equal(stateOf(control(cwd), sync.id), 'needs-you');
  // A different process (or the next run) sees only the open request — the processed ones are remembered in the log itself.
  assert.deepEqual(control(cwd).pending.map((e) => e.id), [rebuild.id]);
  assert.throws(() => markProcessed(cwd, rebuild.id, 'done'), /outcome is one of/);
  assert.throws(() => record(cwd, 'ControlProcessed', {}), /Not an event the player records/);
});

test('feedback is not a request: the player cannot record it, and an old feedback event in the log is not open', (t) => {
  const { cwd, p } = project(t);
  for (const type of ['FeedbackRecorded', 'FeedbackAnswered', 'FeedbackDiscarded', 'FeedbackSubmitted']) assert.throws(() => record(cwd, type, { feedbacks: [{ id: 'f' }] }), /Not an event the player records/, type);
  // a log written by an older version: its feedback events are history, nothing waits for them
  mkdirSync(join(p.root, 'events'), { recursive: true });
  writeFileSync(join(p.root, 'events', 'old.json'), JSON.stringify({ id: 'old', seq: 1, type: 'FeedbackRecorded', at: new Date().toISOString(), data: { name: 'x', events: [], feedbacks: [{ id: 'f', comment: 'x' }] } }));
  assert.deepEqual(control(cwd).pending, []);
});

const CFG = { baseUrl: 'http://board.test', organizationId: 'o', boardId: 'b', token: 't' };

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

// A project with a page assembled from a block per slice, as after the build.
function builtProject(t) {
  const { cwd, p } = project(t);
  for (const s of status(cwd).slices) {
    writeFileSync(join(p.blocks, `${s.id}.html`), `<script type="text/plain" data-em-slice="${s.id}" data-em-title="${s.title}" data-em-hash="${s.hash}">\nEMRuntime.defineSlice({});\n</script>\n`);
  }
  assemble(cwd);
  return { cwd, p };
}
const SHARE_CFG = { baseUrl: 'https://api.test', organizationId: 'org1', boardId: 'board1', token: 'tok' };

test('share posts the assembled page to the context\'s prototype endpoint, the way the platform skill\'s upload does', async (t) => {
  const { cwd, p } = builtProject(t);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, text: async () => JSON.stringify({ contextName: 'Understanding Eventsourcing', bytes: 10, gzippedBytes: 5, removed: [] }) }; };
  const r = await share(cwd, SHARE_CFG, { fetchImpl, contexts: async () => [{ id: 'ctx-1', title: 'Understanding Eventsourcing', type: 'CHAPTER' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/api/org/org1/boards/board1/prototype/ctx-1');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'text/html; charset=utf-8');
  assert.deepEqual(calls[0].init.body, readFileSync(p.page));
  assert.deepEqual(r.warnings, []);
  assert.equal(playLink('https://app.test', SHARE_CFG, r.contextId, r.context), 'https://app.test/play?org=org1&board=board1&chapter=ctx-1&title=Understanding+Eventsourcing');
});

test('share refuses a missing page and a page behind the model, and warns about edits that are not on the board', async (t) => {
  const { cwd, p } = project(t);
  const never = async () => { throw new Error('must not upload'); };
  await assert.rejects(share(cwd, SHARE_CFG, { fetchImpl: never }), /no page yet/);
  for (const s of status(cwd).slices) writeFileSync(join(p.blocks, `${s.id}.html`), `<script type="text/plain" data-em-slice="${s.id}" data-em-title="${s.title}" data-em-hash="${s.hash}">\n</script>\n`);
  assemble(cwd);
  writeJson(p.state, { context: 'Understanding Eventsourcing', contextId: 'ctx-1' });
  editSlice(p, 'Change Price', (s) => { s.description = 'edited'; });
  await assert.rejects(share(cwd, SHARE_CFG, { fetchImpl: never }), /behind the model — 1 slice.*Change Price/);
});

test('share warns when the model has edits the board does not, and reports a refusal', async (t) => {
  const { cwd, p } = builtProject(t);
  writeJson(p.state, { context: 'Understanding Eventsourcing', contextId: 'ctx-1' });
  const refuse = async () => ({ ok: false, status: 403, text: async () => 'no license' });
  await assert.rejects(share(cwd, SHARE_CFG, { fetchImpl: refuse }), /refused the upload \(HTTP 403\): no license/);
  const ok = async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ contextName: 'x', bytes: 1, gzippedBytes: 1, removed: [] }) });
  assert.deepEqual((await share(cwd, SHARE_CFG, { fetchImpl: ok })).warnings, []);
  // Without a baseline every slice counts as not yet on the board.
  rmSync(p.baseline, { recursive: true, force: true });
  assert.match((await share(cwd, SHARE_CFG, { fetchImpl: ok })).warnings[0], /not synced/);
});

// ---- feedback goes to the platform ----

// The platform's feedback endpoint: records what it received (gunzipped) and answers as told.
function platform(answer) {
  const got = [];
  const impl = async (url, init = {}) => {
    got.push({ url: String(url), method: init.method, headers: init.headers, body: JSON.parse(gunzipSync(init.body).toString('utf8')) });
    const body = typeof answer === 'function' ? answer() : answer;
    return { ok: body.status < 300, status: body.status, text: async () => JSON.stringify(body.json ?? {}) };
  };
  return { impl, got };
}
const SUBMISSION = { name: 'Round one', events: [{ type: 'ListCreated' }], feedbacks: [{ id: 'f1', comment: 'Show the count' }] };

test('Submit files the feedback on the platform for the prototype\'s context: gzipped JSON, with the folder\'s token', async (t) => {
  const { cwd, p } = project(t);
  writeJson(p.state, { context: 'Understanding Eventsourcing', contextId: 'ctx-1' });
  const fake = platform({ status: 201, json: { id: 'sub-9' } });
  assert.deepEqual(await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: fake.impl }), { ok: true, id: 'sub-9' });
  assert.equal(fake.got.length, 1);
  assert.equal(fake.got[0].url, 'http://board.test/api/org/o/boards/b/prototype/ctx-1/feedback');
  assert.equal(fake.got[0].method, 'POST');
  assert.equal(fake.got[0].headers['x-token'], 't');
  assert.equal(fake.got[0].headers['content-type'], 'application/gzip');
  assert.deepEqual(fake.got[0].body, SUBMISSION, 'the whole named set, as the player collected it');
  assert.deepEqual(control(cwd).events.filter((e) => /Feedback/.test(e.type)), [], 'nothing is recorded locally: the platform applies it');
});

test('Submit looks the context up by name when the folder has no id, and says so plainly when it cannot file anything', async (t) => {
  const { cwd } = project(t);
  const fake = platform({ status: 201, json: { id: 'x' } });
  const found = await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: fake.impl, contexts: async () => [{ id: 'ctx-2', title: 'Understanding Eventsourcing' }] });
  assert.equal(found.ok, true);
  assert.match(fake.got[0].url, /\/prototype\/ctx-2\/feedback$/);

  const none = platform({ status: 201 });
  const noContext = await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: none.impl, contexts: async () => [] });
  assert.equal(noContext.ok, false);
  assert.match(noContext.problems[0], /not tied to a context/);
  const noBoard = await submitFeedback(cwd, { ...CFG, boardId: undefined }, SUBMISSION, { fetchImpl: none.impl });
  assert.match(noBoard.problems[0], /No board is connected/);
  assert.equal(none.got.length, 0, 'nothing was sent');
});

test('Submit reports what the platform says: the problems of a refused structure, no access, no license, a dead network', async (t) => {
  const { cwd, p } = project(t);
  writeJson(p.state, { context: 'c', contextId: 'ctx-1' });
  const refused = await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: platform({ status: 400, json: { code: 'PROTOTYPE_FEEDBACK_INVALID', context: { problems: ['feedbacks[0].comment: must be 1–2000 characters', 7] } } }).impl });
  assert.deepEqual(refused, { ok: false, problems: ['feedbacks[0].comment: must be 1–2000 characters'] });
  assert.match((await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: platform({ status: 403 }).impl })).problems[0], /refused these credentials.*403/);
  assert.match((await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: platform({ status: 402 }).impl })).problems[0], /license/);
  assert.match((await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: platform({ status: 500, json: { error: 'boom' } }).impl })).problems[0], /HTTP 500: boom/);
  const down = await submitFeedback(cwd, CFG, SUBMISSION, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false);
  assert.match(down.problems[0], /Could not reach the platform: ECONNREFUSED/);
});

test('the player\'s server files Submit through /api/feedback and records only Sync, Fetch and Rebuild as requests', async (t) => {
  const { cwd } = project(t);
  const seen = [];
  const server = await serve({ cwd, port: 4390, submitFeedback: async (submission) => { seen.push(submission); return { ok: true, id: 'sub-1' }; } });
  t.after(() => server.close());
  const base = server.url.replace('localhost', '127.0.0.1');
  const post = (path, body) => fetch(base + path.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const filed = await post('/api/feedback', SUBMISSION);
  assert.deepEqual(await filed.json(), { ok: true, id: 'sub-1' });
  assert.deepEqual(seen, [SUBMISSION]);
  assert.equal((await post('/api/control', { type: 'SyncRequested', data: {} })).status, 200);
  assert.equal((await post('/api/control', { type: 'FeedbackRecorded', data: SUBMISSION })).status, 400, 'feedback is no control request');
  assert.deepEqual(control(cwd).pending.map((e) => e.type), ['SyncRequested']);
  assert.equal((await fetch(base + 'api/control/anything')).status, 404, 'no question modal behind it any more');
});
