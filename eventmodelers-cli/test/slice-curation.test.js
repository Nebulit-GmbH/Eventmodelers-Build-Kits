import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { mergeLearnings, recordLearning } from '../shared/build-kit/lib/slice-learnings.js';
import { curateIfDue, curationThreshold } from '../shared/build-kit/lib/slice-curation.js';
import { quiet, tempKit } from './helpers.js';

// When the loop spends a turn on the learnings: enough new ones, no build in progress. The LLM only writes
// events (merge / retract); the loop marks the review done afterwards, whatever came of the turn.

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };
const kitDir = (t) => { const kit = join(tempKit(t), '.build-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const learn = (kit, n) => Array.from({ length: n }, (_, i) => recordLearning({ kitDir: kit, text: `learning ${i + 1}` }));
const state = (kit) => fold(readEvents(kit));

test('nothing happens below the threshold, without a curator, or when it is switched off', async (t) => {
  quiet(t);
  const kit = kitDir(t);
  learn(kit, 3);
  let turns = 0;
  const onCurate = async () => { turns++; };
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, onCurate, threshold: 5 }), false);
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, onCurate: undefined, threshold: 1 }), false);
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, onCurate, threshold: 0 }), false);
  assert.equal(turns, 0);
  assert.equal(readEvents(kit).some((e) => e.type === 'learnings-curated'), false);
});

test('a due turn gets the learnings and the guard env, and is then marked reviewed', async (t) => {
  quiet(t);
  const kit = kitDir(t);
  const ids = learn(kit, 3).map((l) => l.id);
  let prompt; let options;
  const ran = await curateIfDue({ kitDir: kit, meta: META, threshold: 3, onCurate: async (p, o) => { prompt = p; options = o; } });
  assert.equal(ran, true);
  // handed to the turn, not set on process.env: the runners build their child environment at load time
  assert.deepEqual(options, { env: { EVENTMODELERS_CURATING: '1' } });
  assert.equal(process.env.EVENTMODELERS_CURATING, undefined);
  for (const id of ids) assert.match(prompt, new RegExp(id.slice(0, 8)));
  assert.deepEqual(state(kit).learnings.map((l) => l.curated), [true, true, true]);
  assert.deepEqual(readEvents(kit).find((e) => e.type === 'learnings-curated').meta, META);
});

test('what the curator merges during the turn is part of the review', async (t) => {
  quiet(t);
  const kit = kitDir(t);
  const [a, b] = learn(kit, 4);
  await curateIfDue({ kitDir: kit, meta: META, threshold: 4, onCurate: async () => { mergeLearnings({ kitDir: kit, ids: [a.id, b.id], text: 'merged 1 and 2', reason: 'same' }); } });
  assert.deepEqual(state(kit).learnings.map((l) => [l.text, l.curated]), [['merged 1 and 2', true], ['learning 3', true], ['learning 4', true]]);
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, threshold: 1, onCurate: async () => { throw new Error('must not run again'); } }), false);
});

test('a curator that fails is logged and still marks the review done, so the loop does not retry in a tight loop', async (t) => {
  quiet(t);
  const kit = kitDir(t);
  learn(kit, 3);
  const ran = await curateIfDue({ kitDir: kit, meta: META, threshold: 3, onCurate: async () => { throw new Error('agent crashed'); } });
  assert.equal(ran, true);
  assert.equal(readEvents(kit).filter((e) => e.type === 'learnings-curated').length, 1);
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, threshold: 3, onCurate: async () => { throw new Error('again'); } }), false);
});

test('new learnings after a review count towards the next one', async (t) => {
  quiet(t);
  const kit = kitDir(t);
  learn(kit, 2);
  await curateIfDue({ kitDir: kit, meta: META, threshold: 2, onCurate: async () => {} });
  recordLearning({ kitDir: kit, text: 'a third' });
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, threshold: 2, onCurate: async () => {} }), false);
  recordLearning({ kitDir: kit, text: 'a fourth' });
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, threshold: 2, onCurate: async () => {} }), true);
});

test('no turn is spent while a slice is being built', async (t) => {
  quiet(t);
  const kit = kitDir(t);
  learn(kit, 3);
  appendEvent(kit, { type: 'claimed', slice: 's1', ctx: 'cart', title: 'Add item', pid: process.pid, base: null, cleanTree: true });
  let turns = 0;
  assert.equal(await curateIfDue({ kitDir: kit, meta: META, threshold: 3, onCurate: async () => { turns++; } }), false);
  assert.equal(turns, 0);
});

test('the threshold is RALPH_CURATE_AFTER, 10 by default, 0 to switch curation off', () => {
  assert.equal(curationThreshold({}), 10);
  assert.equal(curationThreshold({ RALPH_CURATE_AFTER: '4' }), 4);
  assert.equal(curationThreshold({ RALPH_CURATE_AFTER: '0' }), 0);
  assert.equal(curationThreshold({ RALPH_CURATE_AFTER: 'many' }), 10);
  assert.equal(curationThreshold({ RALPH_CURATE_AFTER: '-3' }), 10);
});
