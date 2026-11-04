import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { applyBoardStatus, projectStatus } from '../shared/build-kit/lib/slice-projection.js';
import { coalesce } from '../shared/build-kit/lib/slice-refresh.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { handleSliceChanged } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

// A burst of slice:changed events must not become a burst of board reads, and a plain status change must
// not need one at all. The log still owns status: a claim held here wins over what the board announces.

const cfg = { baseUrl: 'http://board.test', organizationId: 'o', boardId: 'b', token: 't', agentId: 'me' };
const BASE = { branch: 'main', commit: 'abc' };

function kitWith(t, { status = 'Planned' } = {}) {
  const kit = join(tempKit(t), '.build-kit');
  const dir = join(kit, '.slices', 'cart');
  mkdirSync(join(dir, 'additem'), { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ slices: [{ id: 's1', slice: 'Add item', folder: 'additem', status, definition: { id: 's1', title: 'Add item', status } }] }));
  writeFileSync(join(dir, 'additem', 'slice.json'), JSON.stringify({ id: 's1', title: 'Add item', status, commands: ['AddItem'] }));
  return kit;
}
const indexEntry = (kit) => JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'index.json'), 'utf-8')).slices[0];
const sliceJson = (kit) => JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'additem', 'slice.json'), 'utf-8'));
const statusEvent = (over = {}) => ({ sliceId: 's1', sliceTitle: null, sliceStatus: 'Done', assignee: null, ticketNumber: null, feature: null, agentId: 'other', ...over });
const noBoardRead = (t) => t.mock.method(globalThis, 'fetch', async () => { throw new Error('the board must not be read'); });

// ── coalesce ────────────────────────────────────────────────────────────────────

test('requests within the delay share one run', async () => {
  let runs = 0;
  const request = coalesce(async () => { runs++; }, 10);
  await Promise.all([request(), request(), request(), request(), request()]);
  assert.equal(runs, 1);
});

test('a request made while a run is in flight gets a fresh run — what that run read may predate it', async () => {
  let runs = 0;
  let release;
  const request = coalesce(() => { runs++; return runs === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); }, 5);
  const first = request();
  await new Promise((r) => setTimeout(r, 30)); // first run started and is blocked
  const second = request();
  release();
  await Promise.all([first, second]);
  assert.equal(runs, 2);
});

test('a failed run rejects the requests it served, and the next request runs again', async () => {
  let runs = 0;
  const request = coalesce(async () => { runs++; if (runs === 1) throw new Error('boom'); }, 5);
  await assert.rejects(request(), /boom/);
  await request();
  assert.equal(runs, 2);
});

// ── applyBoardStatus ────────────────────────────────────────────────────────────

test('a status change for a listed slice is written to index.json and slice.json without reading the board', (t) => {
  quiet(t);
  noBoardRead(t);
  const kit = kitWith(t);
  assert.equal(applyBoardStatus(kit, 's1', 'InProgress', {}), true);
  assert.equal(indexEntry(kit).status, 'InProgress');
  assert.equal(indexEntry(kit).definition.status, 'InProgress');
  assert.equal(sliceJson(kit).status, 'InProgress');
  assert.deepEqual(sliceJson(kit).commands, ['AddItem'], 'the rest of slice.json is left alone');
});

test('an unknown slice, or a status the list does not use, is left for a full refresh', (t) => {
  quiet(t);
  const kit = kitWith(t);
  assert.equal(applyBoardStatus(kit, 'nope', 'Done', {}), false);
  assert.equal(applyBoardStatus(kit, 's1', 'Archived', {}), false);
  assert.equal(applyBoardStatus(kit, 's1', undefined, {}), false);
  assert.equal(indexEntry(kit).status, 'Planned');
});

test("the legacy status 'Handover' is Waiting, as in the slice list", (t) => {
  quiet(t);
  const kit = kitWith(t);
  assert.equal(applyBoardStatus(kit, 's1', 'Handover', {}), true);
  assert.equal(indexEntry(kit).status, 'Waiting');
});

test('the same status twice adds no second event to the log', (t) => {
  quiet(t);
  const kit = kitWith(t);
  applyBoardStatus(kit, 's1', 'Done', {});
  const events = readEvents(kit).length;
  applyBoardStatus(kit, 's1', 'Done', {});
  assert.equal(readEvents(kit).length, events);
});

test("a slice this agent has claimed keeps the status it recorded when the board announces InProgress", (t) => {
  quiet(t);
  const kit = kitWith(t);
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Planned' });
  appendEvent(kit, { type: 'claimed', slice: 's1', ctx: 'cart', title: 'Add item', pid: 1, base: BASE, cleanTree: true });
  appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
  appendEvent(kit, { type: 'agent-recorded', slice: 's1', status: 'Done' });
  projectStatus(kit, fold(readEvents(kit)));
  assert.equal(applyBoardStatus(kit, 's1', 'InProgress', {}), true);
  assert.equal(indexEntry(kit).status, 'Done');
  assert.equal(sliceJson(kit).status, 'Done');
});

// ── handleSliceChanged ──────────────────────────────────────────────────────────

test('another writer\'s plain status change updates the files and reads no board', async (t) => {
  quiet(t);
  noBoardRead(t);
  const kit = kitWith(t);
  let refreshes = 0;
  await handleSliceChanged(statusEvent({ sliceStatus: 'InProgress' }), cfg, kit, async () => { refreshes++; });
  assert.equal(refreshes, 0);
  assert.equal(indexEntry(kit).status, 'InProgress');
});

test('a change that touches the title, assignee, ticket or feature is read from the board', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  for (const over of [{ sliceTitle: 'Renamed' }, { assignee: 'u1' }, { ticketNumber: 'P-1' }, { feature: 'cart' }]) {
    let refreshes = 0;
    await handleSliceChanged(statusEvent(over), cfg, kit, async () => { refreshes++; });
    assert.equal(refreshes, 1, JSON.stringify(over));
  }
});

test('a slice the agent has not listed yet is read from the board', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  let refreshes = 0;
  await handleSliceChanged(statusEvent({ sliceId: 'new-slice' }), cfg, kit, async () => { refreshes++; });
  assert.equal(refreshes, 1);
});

test('an event without a status is read from the board', async (t) => {
  quiet(t);
  const kit = kitWith(t);
  let refreshes = 0;
  await handleSliceChanged(statusEvent({ sliceStatus: null, sliceTitle: 'x' }), cfg, kit, async () => { refreshes++; });
  assert.equal(refreshes, 1);
});

test("this agent's own write is dropped: no board read, no file change", async (t) => {
  quiet(t);
  noBoardRead(t);
  const kit = kitWith(t);
  let refreshes = 0;
  await handleSliceChanged(statusEvent({ agentId: 'me' }), cfg, kit, async () => { refreshes++; });
  assert.equal(refreshes, 0);
  assert.equal(indexEntry(kit).status, 'Planned');
});
