import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { blockStuckSlice } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

// An auto-blocked slice is a `blocked` event; the files the agent reads are its projection.

const planned = { id: 's1', title: 'Add item', ctx: 'cart' };

function kitWithSlice(t) {
  const kit = join(tempKit(t), '.build-kit');
  const dir = join(kit, '.slices', 'cart');
  mkdirSync(join(dir, 'additem'), { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ slices: [{ id: 's1', folder: 'additem', status: 'Planned', definition: { id: 's1', status: 'Planned' } }] }));
  writeFileSync(join(dir, 'additem', 'slice.json'), JSON.stringify({ id: 's1', status: 'Planned', commands: ['AddItem'] }));
  return kit;
}
const read = (kit, ...p) => JSON.parse(readFileSync(join(kit, '.slices', 'cart', ...p), 'utf-8'));

test('blocking a stuck slice appends one blocked event with the reason and the last reply', async (t) => {
  quiet(t);
  const kit = kitWithSlice(t);
  await blockStuckSlice(kit, {}, false, planned, 5, 'I could not find the command');
  const blocked = readEvents(kit).filter((e) => e.type === 'blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].slice, 's1');
  assert.match(blocked[0].reason, /5 times in a row/);
  assert.match(blocked[0].reason, /I could not find the command/);
  assert.equal(fold(readEvents(kit)).slices.s1.blocked.reason, blocked[0].reason);
});

test('the Blocked status and its note are projected into index.json and slice.json, nothing else touched', async (t) => {
  quiet(t);
  const kit = kitWithSlice(t);
  await blockStuckSlice(kit, {}, false, planned, 5, null);
  const entry = read(kit, 'index.json').slices[0];
  assert.equal(entry.status, 'Blocked');
  assert.equal(entry.definition.status, 'Blocked');
  assert.match(entry.blockedReason, /Auto-blocked/);
  assert.match(entry.blockedAt, /^\d{4}-\d{2}-\d{2}T/);
  const slice = read(kit, 'additem', 'slice.json');
  assert.equal(slice.status, 'Blocked');
  assert.deepEqual(slice.commands, ['AddItem']);
});

test('without a board it blocks locally and says so in progress.txt', async (t) => {
  quiet(t);
  const kit = kitWithSlice(t);
  await blockStuckSlice(kit, {}, false, planned, 5, null);
  assert.match(readFileSync(join(dirname(kit), 'progress.txt'), 'utf-8'), /Slice auto-blocked/);
  assert.equal(existsSync(join(kit, 'events.log')), true);
});
