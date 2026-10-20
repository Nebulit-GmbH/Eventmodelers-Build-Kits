import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { pruneLog } from '../shared/build-kit/lib/event-prune.js';
import { tempKit } from './helpers.js';

const kit = (t) => { const dir = join(tempKit(t), '.build-kit'); mkdirSync(dir, { recursive: true }); return dir; };

test('every recorded event gets the next sequence number, and it defines the order', (t) => {
  const dir = kit(t);
  const ids = ['a', 'b', 'c'].map((type) => appendEvent(dir, { type }, {}));
  const events = readEvents(dir);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(events.map((e) => e.id), ids);
  assert.equal(JSON.parse(readFileSync(join(dir, 'events', `${ids[2]}.json`), 'utf-8')).seq, 3, 'stored with the event');
});

test('a log written before events were numbered is numbered on read, and the next event continues it', (t) => {
  const dir = kit(t);
  const first = appendEvent(dir, { type: 'old' }, {});
  const file = join(dir, 'events', `${first}.json`);
  const { seq: _drop, ...legacy } = JSON.parse(readFileSync(file, 'utf-8'));
  writeFileSync(file, JSON.stringify(legacy));
  appendEvent(dir, { type: 'new' }, {});
  assert.deepEqual(readEvents(dir).map((e) => e.seq), [1, 2]);
});

test('two events that drew the same number are renumbered in index order', (t) => {
  const dir = kit(t);
  const a = appendEvent(dir, { type: 'a' }, {});
  const b = appendEvent(dir, { type: 'b' }, {});
  const file = join(dir, 'events', `${b}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf-8')), seq: 1 }));
  assert.deepEqual(readEvents(dir).map((e) => [e.id, e.seq]), [[a, 1], [b, 2]]);
});

test('the last used number is remembered: pruning never makes a number come back', (t) => {
  const dir = kit(t);
  appendEvent(dir, { type: 'prompt-received', prompt: { id: 'p1', text: 'x' }, pid: 1 }, {});
  appendEvent(dir, { type: 'prompt-finished', prompt: 'p1', outcome: 'worked' }, {});
  pruneLog(dir);
  appendEvent(dir, { type: 'after' }, {});
  assert.deepEqual(readEvents(dir).map((e) => e.seq), [3], 'the pruned journal used 1 and 2');
  assert.equal(readFileSync(join(dir, 'events.seq'), 'utf-8'), '3');
});
