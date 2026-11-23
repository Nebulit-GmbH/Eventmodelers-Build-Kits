import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { recordLearning } from '../shared/build-kit/lib/slice-learnings.js';
import { quiet, tempKit } from './helpers.js';

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };
const kitDir = (t) => { const kit = join(tempKit(t), '.build-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const learn = (kit, n) => Array.from({ length: n }, (_, i) => recordLearning({ kitDir: kit, text: `learning ${i + 1}` }));
const state = (kit) => fold(readEvents(kit));

// `learnings --curate` works with any agent: it only answers, the CLI applies its MERGE / RETRACT lines.
import { applyCurationReply, curationReplyRequest } from '../shared/build-kit/lib/slice-learnings.js';

test('a curator reply of MERGE and RETRACT lines is applied; a bad line is skipped, not half-applied', (t) => {
  quiet(t);
  const kit = kitDir(t);
  const [a, b, c, d] = learn(kit, 4).map((l) => l.id.slice(0, 8));
  const reply = [
    'Here is what I found:',
    `MERGE ${a},${b} | one and two | same fact`,
    `RETRACT ${c} | the code no longer does this`,
    `MERGE ${d},deadbeef | nope | unknown id`,
    `RETRACT ${d}`,
  ].join('\n');
  const result = applyCurationReply({ kitDir: kit, reply, meta: META });
  assert.deepEqual([result.merged, result.retracted, result.skipped.length], [1, 1, 1]);
  assert.deepEqual(state(kit).learnings.map((l) => l.text), ['one and two', 'learning 4']);
});

test('NONE, an empty reply and fenced examples change nothing', (t) => {
  quiet(t);
  const kit = kitDir(t);
  const [a, b] = learn(kit, 2).map((l) => l.id.slice(0, 8));
  for (const reply of ['NONE', '', null, `\`\`\`\nMERGE ${a},${b} | x | y\n\`\`\``]) {
    assert.deepEqual(applyCurationReply({ kitDir: kit, reply, meta: META }), { merged: 0, retracted: 0, rewritten: 0, split: 0, changes: [], skipped: [] });
  }
  assert.equal(state(kit).learnings.length, 2);
  assert.match(curationReplyRequest(state(kit).learnings), /MERGE <id,id,…>/);
});

// `learn` enforces the form: a short problem, a short solution, a topic.
import { composeLearning, MAX_LEARNING_LENGTH_TOTAL } from '../shared/build-kit/lib/slice-learnings.js';

test('a learning is a short problem and solution under a topic, and nothing else is accepted', () => {
  assert.deepEqual(composeLearning({ problem: '  A stale branch touches a slice.\n', solution: 'Check the merge-base first', topic: ' git ' }), { text: 'A stale branch touches a slice → Check the merge-base first', topic: 'git' });
  assert.throws(() => composeLearning({ problem: 'p', solution: '', topic: 't' }), /needs --solution/);
  assert.throws(() => composeLearning({ problem: 'p', solution: 's' }), /needs --topic/);
  assert.throws(() => composeLearning({ problem: 'x'.repeat(300), solution: 'y'.repeat(300), topic: 't' }), /learning is \d+ characters, at most 500/);
  assert.equal(composeLearning({ problem: 'p'.repeat(70), solution: 's'.repeat(MAX_LEARNING_LENGTH_TOTAL - 73), topic: 't' }).text.length, MAX_LEARNING_LENGTH_TOTAL);
});

// The curator can also REWRITE: the same learning, in the problem → solution form, checked like a `learn`.
test('REWRITE turns a free-text learning into problem → solution under a topic and keeps what it said', (t) => {
  quiet(t);
  const kit = kitDir(t);
  const [a, b, c] = learn(kit, 3).map((l) => l.id);
  const reply = [
    `REWRITE ${a.slice(0, 8)} | Tests need running | Run the suite with npm test | testing`,
    `REWRITE ${b.slice(0, 8)} | ${'x'.repeat(600)} | too long | testing`,
    `REWRITE ${c.slice(0, 8)} | only a problem | | testing`,
  ].join('\n');
  const result = applyCurationReply({ kitDir: kit, reply, meta: META });
  assert.deepEqual([result.rewritten, result.skipped.length], [1, 2]);
  const [first, second] = state(kit).learnings;
  assert.deepEqual([first.id, first.text, first.topic], [a, 'Tests need running → Run the suite with npm test', 'testing']);
  assert.equal(second.text, 'learning 2');
  const event = readEvents(kit).find((e) => e.type === 'learning-rewritten');
  assert.deepEqual([event.learning, event.was], [a, 'learning 1']);
});

test('a dry run says what would change and writes nothing', (t) => {
  quiet(t);
  const kit = kitDir(t);
  const [a, b, c] = learn(kit, 3).map((l) => l.id.slice(0, 8));
  const before = readEvents(kit).length;
  const reply = [`MERGE ${a},${b} | one and two | same`, `RETRACT ${c} | gone`, `REWRITE ${a} | P | S | t`, `REWRITE deadbeef | P | S | t`].join('\n');
  const result = applyCurationReply({ kitDir: kit, reply, meta: META, dryRun: true });
  assert.deepEqual([result.merged, result.retracted, result.rewritten, result.skipped.length], [1, 1, 1, 1]);
  assert.deepEqual(result.changes.map((c) => c.kind), ['merge', 'retract', 'rewrite']);
  assert.equal(readEvents(kit).length, before);
  assert.equal(state(kit).learnings.length, 3);
});

// A learning of two independent rules is split; a learning that is only long is summarized (a REWRITE), never split.
test('SPLIT replaces one learning by its parts, all or nothing, and keeps scope and tags', (t) => {
  quiet(t);
  const kit = kitDir(t);
  const [a, b] = [recordLearning({ kitDir: kit, text: 'two rules in one', scope: 'system', tags: ['x'] }), recordLearning({ kitDir: kit, text: 'another long one' })].map((l) => l.id);
  const reply = [
    `SPLIT ${a.slice(0, 8)} | Rule one applies | Do one | git`,
    `SPLIT ${a.slice(0, 8)} | Rule two applies | Do two | testing`,
    `SPLIT ${b.slice(0, 8)} | Only part | Do it | git`,
  ].join('\n');
  const result = applyCurationReply({ kitDir: kit, reply, meta: META });
  assert.deepEqual([result.split, result.skipped.length], [1, 1]);
  assert.match(result.skipped[0], /at least two parts/);
  const learnings = state(kit).learnings;
  assert.deepEqual(learnings.map((l) => l.text), ['another long one', 'Rule one applies → Do one', 'Rule two applies → Do two']);
  assert.deepEqual([learnings[1].scope, learnings[1].tags], ['system', ['x', 'split']]);
  // one bad part and nothing is written
  const before = readEvents(kit).length;
  const bad = [`SPLIT ${b.slice(0, 8)} | ok | fine | git`, `SPLIT ${b.slice(0, 8)} | ${'x'.repeat(600)} | too long | git`].join('\n');
  assert.equal(applyCurationReply({ kitDir: kit, reply: bad, meta: META }).split, 0);
  assert.equal(readEvents(kit).length, before);
});

test('the curator is told which learnings are already in the required form, by the CLI and not by a guess', () => {
  const done = 'A short problem → a short solution';
  const long = `A problem that is too long → ${'x'.repeat(520)}`;
  const learnings = [done, long, 'free text'].map((text, i) => ({ id: `0000000${i}aaaa`, text, scope: 'repo', tags: [] }));
  const prompt = curationReplyRequest(learnings);
  assert.match(prompt, /00000000  \[General\]  \(repo\)  ✓ A short problem/);
  assert.doesNotMatch(prompt, /✓ A problem that is too long/);
  assert.doesNotMatch(prompt, /✓ free text/);
  assert.match(prompt, /summarize it to fit/);
});
