import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { observeBoard, projectStatus } from '../shared/build-kit/lib/slice-projection.js';
import { fetchAndPersistSlices } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

// Design: slice-state-test-design.md (layer D). The log owns slice *status*; index.json / slice.json are
// read-only views of it for the build agent.

const cfg = { baseUrl: 'http://board.test', organizationId: 'o', boardId: 'b', token: 't' };
const BASE = { branch: 'main', commit: 'abc' };

// A kit dir with one context holding slice s1 (folder additem).
function kitWith(t, { status = 'Planned', slice = {} } = {}) {
  const kit = join(tempKit(t), '.build-kit');
  const dir = join(kit, '.slices', 'cart');
  mkdirSync(join(dir, 'additem'), { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ slices: [{ id: 's1', slice: 'Add item', folder: 'additem', status, definition: { id: 's1', title: 'Add item', status } }] }));
  writeFileSync(join(dir, 'additem', 'slice.json'), JSON.stringify({ id: 's1', title: 'Add item', status, commands: ['AddItem'], ...slice }));
  return kit;
}
const indexEntry = (kit) => JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'index.json'), 'utf-8')).slices[0];
const sliceJson = (kit) => JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'additem', 'slice.json'), 'utf-8'));
const claim = (kit) => {
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Planned' });
  appendEvent(kit, { type: 'claimed', slice: 's1', ctx: 'cart', title: 'Add item', pid: 1, base: BASE, cleanTree: true });
};

// Board stand-in serving the slice summary list.
function board(t, slices) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ slices }), { status: 200 }));
}

// ── projectStatus ───────────────────────────────────────────────────────────────

test('projection writes the derived status into index.json (entry and definition) and slice.json', (t) => {
  const kit = kitWith(t);
  claim(kit);
  assert.equal(projectStatus(kit, fold(readEvents(kit))), 2);
  assert.equal(indexEntry(kit).status, 'InProgress');
  assert.equal(indexEntry(kit).definition.status, 'InProgress');
  assert.equal(sliceJson(kit).status, 'InProgress');
});

test('projection keeps every other field of both files', (t) => {
  const kit = kitWith(t);
  claim(kit);
  projectStatus(kit, fold(readEvents(kit)));
  assert.deepEqual(sliceJson(kit).commands, ['AddItem']);
  assert.equal(indexEntry(kit).folder, 'additem');
  assert.equal(indexEntry(kit).definition.title, 'Add item');
});

test('projection of a blocked slice writes its reason and time; unblocking clears them', (t) => {
  const kit = kitWith(t);
  appendEvent(kit, { type: 'blocked', slice: 's1', reason: 'five failed builds', at: '2026-10-18T10:00:00.000Z' });
  projectStatus(kit, fold(readEvents(kit)));
  assert.equal(indexEntry(kit).status, 'Blocked');
  assert.equal(indexEntry(kit).blockedReason, 'five failed builds');
  assert.equal(sliceJson(kit).blockedAt, '2026-10-18T10:00:00.000Z');
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Planned' });
  projectStatus(kit, fold(readEvents(kit)));
  assert.equal(indexEntry(kit).status, 'Planned');
  assert.equal('blockedReason' in indexEntry(kit), false);
  assert.equal('blockedAt' in sliceJson(kit), false);
});

test('a failed attempt is projected into slice.json (not index.json) so the next build sees what went wrong', (t) => {
  const kit = kitWith(t);
  appendEvent(kit, { type: 'attempt-failed', slice: 's1', reason: 'no-outcome', lastReply: 'gave up', branch: 'feature/x', created: ['feature/x'], changed: ' M code.txt', status: 'Planned', at: '2026-10-18T10:00:00.000Z' });
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Planned' });
  projectStatus(kit, fold(readEvents(kit)));
  assert.deepEqual(sliceJson(kit).lastAttempt, { at: '2026-10-18T10:00:00.000Z', reason: 'no-outcome', lastReply: 'gave up', branch: 'feature/x', created: ['feature/x'], changed: ' M code.txt' });
  assert.equal('lastAttempt' in indexEntry(kit), false);
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Done' });
  projectStatus(kit, fold(readEvents(kit)));
  assert.equal('lastAttempt' in sliceJson(kit), false);
});

test('projection leaves slices the log knows nothing about, and writes nothing when nothing changed', (t) => {
  const kit = kitWith(t, { status: 'Done' });
  assert.equal(projectStatus(kit, fold([])), 0);
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Done' });
  assert.equal(projectStatus(kit, fold(readEvents(kit))), 0);
  assert.equal(indexEntry(kit).status, 'Done');
});

test('projection tolerates a kit without slices', (t) => {
  const kit = join(tempKit(t), '.build-kit');
  assert.equal(projectStatus(kit, fold([])), 0);
});

// ── observeBoard ────────────────────────────────────────────────────────────────

test('observing the board appends one event per slice whose status changed, and nothing for a repeat', (t) => {
  const kit = kitWith(t);
  observeBoard(kit, [{ id: 's1', status: 'Planned' }, { id: 's2', status: 'Done' }]);
  observeBoard(kit, [{ id: 's1', status: 'Planned' }, { id: 's2', status: 'Done' }]);
  assert.equal(readEvents(kit).length, 2);
  observeBoard(kit, [{ id: 's1', status: 'Blocked' }]);
  assert.deepEqual(readEvents(kit).map((e) => `${e.slice}:${e.status}`), ['s1:Planned', 's2:Done', 's1:Blocked']);
});

test('observed events carry the metadata they were given', (t) => {
  const kit = kitWith(t);
  observeBoard(kit, [{ id: 's1', status: 'Planned' }], { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' });
  assert.deepEqual(readEvents(kit)[0].meta, { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' });
});

test('observing the board returns the folded state', (t) => {
  const kit = kitWith(t);
  const state = observeBoard(kit, [{ id: 's1', status: 'Planned' }]);
  assert.equal(state.slices.s1.status, 'Planned');
});

// ── the refresh (fetchAndPersistSlices) ─────────────────────────────────────────

test('a stale refresh during a claim cannot revert the status the agent recorded — the Done→Planned loop', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  claim(kit);
  appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
  appendEvent(kit, { type: 'agent-recorded', slice: 's1', status: 'Done' });
  projectStatus(kit, fold(readEvents(kit))); // every event is projected as it is appended (recordEvent)
  board(t, [{ id: 's1', title: 'Add item', status: 'InProgress', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(indexEntry(kit).status, 'Done');
  assert.equal(indexEntry(kit).definition.status, 'Done');
  assert.equal(sliceJson(kit).status, 'Done');
});

test('an outcome the agent wrote into index.json mid-build survives a refresh and is recorded as its own event', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  claim(kit);
  appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
  projectStatus(kit, fold(readEvents(kit)));
  assert.equal(indexEntry(kit).status, 'InProgress');
  // the build agent records its outcome by editing the file itself
  const index = JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'index.json'), 'utf-8'));
  index.slices[0].status = 'Done';
  writeFileSync(join(kit, '.slices', 'cart', 'index.json'), JSON.stringify(index));
  board(t, [{ id: 's1', title: 'Add item', status: 'InProgress', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(indexEntry(kit).status, 'Done');
  assert.equal(sliceJson(kit).status, 'Done');
  const recorded = readEvents(kit).filter((e) => e.type === 'agent-recorded');
  assert.deepEqual(recorded.map((e) => e.status), ['Done']);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(readEvents(kit).filter((e) => e.type === 'agent-recorded').length, 1);
});

test('an edit to a slice nobody has claimed is not adopted — the board decides', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  const index = JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'index.json'), 'utf-8'));
  index.slices[0].status = 'Done';
  writeFileSync(join(kit, '.slices', 'cart', 'index.json'), JSON.stringify(index));
  board(t, [{ id: 's1', title: 'Add item', status: 'Planned', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(readEvents(kit).some((e) => e.type === 'agent-recorded'), false);
  assert.equal(indexEntry(kit).status, 'Planned');
});

test('without a claim the refresh shows the board status, and the board then wins', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  board(t, [{ id: 's1', title: 'Add item', status: 'Planned', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(indexEntry(kit).status, 'Planned');
  board(t, [{ id: 's1', title: 'Add item', status: 'Blocked', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(indexEntry(kit).status, 'Blocked');
  assert.equal(sliceJson(kit).status, 'Blocked');
});

test('the refresh still merges onto slice.json and clears a removed ticketNumber', async (t) => {
  quiet(t);
  const kit = kitWith(t, { slice: { ticketNumber: 'T-1' } });
  board(t, [{ id: 's1', title: 'Add item', status: 'Planned', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.deepEqual(sliceJson(kit).commands, ['AddItem']);
  assert.equal(sliceJson(kit).ticketNumber, null);
});

test('a refresh stamps its events with this agent, organization and board', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  board(t, [{ id: 's1', title: 'Add item', status: 'Planned', contextName: 'cart' }]);
  await fetchAndPersistSlices({ ...cfg, agentId: 'agent-7' }, kit);
  assert.deepEqual(readEvents(kit)[0].meta, { agent_id: 'agent-7', organization_id: 'o', board_id: 'b' });
});

test('without cfg.agentId the agent id comes from RALPH_AGENT_ID, like the platform headers', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  const before = process.env.RALPH_AGENT_ID;
  process.env.RALPH_AGENT_ID = 'from-env';
  t.after(() => { if (before === undefined) delete process.env.RALPH_AGENT_ID; else process.env.RALPH_AGENT_ID = before; });
  board(t, [{ id: 's1', title: 'Add item', status: 'Planned', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(readEvents(kit)[0].meta.agent_id, 'from-env');
});

test('a refresh records only changes: a second identical one adds no events', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  board(t, [{ id: 's1', title: 'Add item', status: 'Planned', contextName: 'cart' }]);
  await fetchAndPersistSlices(cfg, kit);
  await fetchAndPersistSlices(cfg, kit);
  assert.equal(readEvents(kit).length, 1);
});
