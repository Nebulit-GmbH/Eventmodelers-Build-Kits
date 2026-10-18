import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { prunableEvents, pruneLog, rememberPruneAnswer, shouldOfferPrune } from '../shared/build-kit/lib/event-prune.js';
import { tempKit } from './helpers.js';

// The log grows without bound; most of it is the journal of prompts that are long finished. Pruning removes that
// and nothing the state is derived from.

const kitDir = (t) => { const kit = join(tempKit(t), '.agent-modeling-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const received = (kit, id) => appendEvent(kit, { type: 'prompt-received', pid: 1, prompt: { id, text: id } });
const finished = (kit, id) => appendEvent(kit, { type: 'prompt-finished', prompt: id, outcome: 'worked' });

test('only the events of finished prompts are prunable — an open prompt keeps its whole journal', (t) => {
  const kit = kitDir(t);
  received(kit, 'done'); appendEvent(kit, { type: 'tool-call', prompt: 'done', tool: 'get_node' }); finished(kit, 'done');
  received(kit, 'open'); appendEvent(kit, { type: 'prompt-action', prompt: 'open', action: 'commented' });
  appendEvent(kit, { type: 'learning-recorded', text: 'a learning', topic: 'T', scope: 'repo' });
  assert.deepEqual(prunableEvents(readEvents(kit)).map((e) => e.type), ['prompt-received', 'tool-call', 'prompt-finished']);
});

test('pruning deletes their files and index lines and leaves the folded state exactly as it was', (t) => {
  const kit = kitDir(t);
  received(kit, 'a'); finished(kit, 'a');
  received(kit, 'open');
  appendEvent(kit, { type: 'learning-recorded', text: 'keep me', topic: 'T', scope: 'repo' });
  const before = fold(readEvents(kit));
  assert.deepEqual(pruneLog(kit), { removed: 2, kept: 2 });
  assert.deepEqual(fold(readEvents(kit)), before);
  assert.equal(readdirSync(join(kit, 'events')).filter((f) => f.endsWith('.json')).length, 2);
  assert.deepEqual(pruneLog(kit), { removed: 0, kept: 2 });
});

test('a log with nothing prunable is left alone', (t) => {
  const kit = kitDir(t);
  appendEvent(kit, { type: 'learning-recorded', text: 'x', topic: 'T', scope: 'repo' });
  assert.deepEqual(pruneLog(kit), { removed: 0, kept: 1 });
});

test('the offer comes at 1000, again at 2000, and a "no" is not repeated before the next multiple', (t) => {
  const kit = kitDir(t);
  assert.equal(shouldOfferPrune(kit, 999), false);
  assert.equal(shouldOfferPrune(kit, 1000), true);
  rememberPruneAnswer(kit, 1000);
  assert.equal(shouldOfferPrune(kit, 1000), false);
  assert.equal(shouldOfferPrune(kit, 1999), false);
  assert.equal(shouldOfferPrune(kit, 2000), true);
  rememberPruneAnswer(kit, 400); // pruned down: the next offer is at 1000 again
  assert.equal(shouldOfferPrune(kit, 1000), true);
  assert.ok(existsSync(join(kit, 'events', '.prune-asked')));
});
