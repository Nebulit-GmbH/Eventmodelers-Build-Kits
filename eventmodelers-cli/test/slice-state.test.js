import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, learningKey, renderLearnings, needsCuration, decideSettle, decideRecovery } from '../shared/build-kit/lib/slice-state.js';

// Design: slice-state-test-design.md (layers A and B). Case numbers refer to slice-state-learnings.md.

const BASE = { branch: 'main', commit: 'abc123' };
const claimed = (extra = {}) => ({ type: 'claimed', slice: 's1', ctx: 'cart', title: 'Add item', pid: 100, base: BASE, cleanTree: true, ...extra });
const slice = (events, id = 's1') => fold(events).slices[id];

// ── fold ────────────────────────────────────────────────────────────────────────

test('a claim opens, marks the slice InProgress and is unconfirmed (3)', () => {
  const s = slice([{ type: 'board-observed', slice: 's1', status: 'Planned' }, claimed()]);
  assert.equal(s.status, 'InProgress');
  assert.deepEqual(s.claim, { pid: 100, confirmed: false, base: BASE, cleanTree: true, ctx: 'cart', title: 'Add item', prevStatus: 'Planned' });
});

test('claim-confirmed confirms the open claim (3)', () => {
  const s = slice([claimed(), { type: 'claim-confirmed', slice: 's1' }]);
  assert.equal(s.claim.confirmed, true);
});

test('a lost claim is released: no claim, status back to what it was (1)', () => {
  const s = slice([
    { type: 'board-observed', slice: 's1', status: 'Planned' },
    claimed(),
    { type: 'released', slice: 's1', reason: 'lost' },
  ]);
  assert.equal(s.claim, null);
  assert.equal(s.status, 'Planned');
});

test('a claim released because someone else moved the slice shows the board status, not the old one (7)', () => {
  const s = slice([
    { type: 'board-observed', slice: 's1', status: 'Planned' },
    claimed(),
    { type: 'claim-confirmed', slice: 's1' },
    { type: 'board-observed', slice: 's1', status: 'Blocked' },
    { type: 'released', slice: 's1', reason: 'moved' },
  ]);
  assert.equal(s.claim, null);
  assert.equal(s.status, 'Blocked');
});

test('a stale board refresh cannot revert what the agent recorded during a claim', () => {
  const s = slice([
    { type: 'board-observed', slice: 's1', status: 'Planned' },
    claimed(),
    { type: 'claim-confirmed', slice: 's1' },
    { type: 'agent-recorded', slice: 's1', status: 'Done' },
    { type: 'board-observed', slice: 's1', status: 'InProgress' },
  ]);
  assert.equal(s.status, 'Done');
  assert.equal(s.pendingOutcome, 'Done');
  assert.equal(s.lastBoardStatus, 'InProgress');
});

test('settled closes the claim and clears the pending outcome (5)', () => {
  const s = slice([
    claimed(),
    { type: 'agent-recorded', slice: 's1', status: 'Done' },
    { type: 'settled', slice: 's1', status: 'Done' },
  ]);
  assert.equal(s.claim, null);
  assert.equal(s.pendingOutcome, null);
  assert.equal(s.status, 'Done');
});

test('the claim stays open until settled — a failed push appends nothing (8)', () => {
  const s = slice([claimed(), { type: 'agent-recorded', slice: 's1', status: 'Done' }]);
  assert.notEqual(s.claim, null);
  assert.equal(s.pendingOutcome, 'Done');
});

test('a second claim while the first is open does not take the slice', () => {
  const s = slice([claimed({ pid: 100 }), claimed({ pid: 200 })]);
  assert.equal(s.claim.pid, 100);
});

test('without an open claim the last of board-observed / settled wins', () => {
  assert.equal(slice([
    { type: 'board-observed', slice: 's1', status: 'Planned' },
    { type: 'settled', slice: 's1', status: 'Done' },
  ]).status, 'Done');
  assert.equal(slice([
    { type: 'settled', slice: 's1', status: 'Done' },
    { type: 'board-observed', slice: 's1', status: 'Planned' },
  ]).status, 'Planned');
});

test('attempt-failed counts attempts; they reset once the board shows the slice off Planned', () => {
  const failed = { type: 'attempt-failed', slice: 's1', reason: 'timeout', lastReply: null };
  const two = [{ type: 'board-observed', slice: 's1', status: 'Planned' }, failed, failed];
  assert.equal(slice(two).attempts, 2);
  assert.equal(slice([...two, { type: 'board-observed', slice: 's1', status: 'Done' }]).attempts, 0);
});

test('attempts reset against the status the slice went back to, not a hard-coded Planned (UI kits pick up Handover)', () => {
  const failed = { type: 'attempt-failed', slice: 's1', reason: 'no-outcome', lastReply: null, status: 'Handover' };
  const waiting = [failed, failed, { type: 'board-observed', slice: 's1', status: 'Handover' }];
  assert.equal(slice(waiting).attempts, 2);
  assert.equal(slice([...waiting, { type: 'board-observed', slice: 's1', status: 'Done' }]).attempts, 0);
});

test('a block starts the count afresh, so an unblocked slice gets a full budget again', () => {
  const failed = { type: 'attempt-failed', slice: 's1', reason: 'timeout', lastReply: null };
  const s = slice([failed, failed, failed, { type: 'blocked', slice: 's1', reason: 'x', at: 'now' }]);
  assert.equal(s.attempts, 0);
  assert.equal(slice([failed, { type: 'blocked', slice: 's1', reason: 'x', at: 'now' }, failed]).attempts, 1);
});

test('any status but Blocked on the board lifts the block (a person may set Handover, not only Planned)', () => {
  const blocked = { type: 'blocked', slice: 's1', reason: 'x', at: 'now' };
  assert.equal(slice([blocked, { type: 'board-observed', slice: 's1', status: 'Handover' }]).blocked, null);
  assert.notEqual(slice([blocked, { type: 'board-observed', slice: 's1', status: 'Blocked' }]).blocked, null);
});

test('the last failed attempt is kept with what it tried, and forgotten once the slice moves on', () => {
  const failed = { type: 'attempt-failed', slice: 's1', reason: 'no-outcome', at: 't1', lastReply: 'gave up', branch: 'feature/x', created: ['feature/x'], changed: ' M code.txt' };
  const s = slice([failed, { type: 'attempt-failed', slice: 's1', reason: 'turn-failed', at: 't2' }]);
  assert.deepEqual(s.lastFailure, { at: 't2', reason: 'turn-failed', lastReply: null, branch: null, created: [], changed: '' });
  assert.equal(slice([failed]).lastFailure.lastReply, 'gave up');
  assert.equal(slice([failed, { type: 'board-observed', slice: 's1', status: 'Done' }]).lastFailure, null);
  assert.equal(slice([failed, { type: 'blocked', slice: 's1', reason: 'x', at: 'now' }]).lastFailure, null);
});

test('our own claim moving the board to InProgress does not reset the attempts', () => {
  const s = slice([
    { type: 'board-observed', slice: 's1', status: 'Planned' },
    { type: 'attempt-failed', slice: 's1', reason: 'timeout', lastReply: null },
    claimed(),
    { type: 'board-observed', slice: 's1', status: 'InProgress' },
  ]);
  assert.equal(s.attempts, 1);
});

test('blocked records the reason; the board showing Planned again clears it', () => {
  const blocked = slice([{ type: 'blocked', slice: 's1', reason: 'five failed builds', at: '2026-10-18T10:00:00.000Z' }]);
  assert.deepEqual(blocked.blocked, { reason: 'five failed builds', at: '2026-10-18T10:00:00.000Z' });
  assert.equal(blocked.status, 'Blocked');
  const back = slice([
    { type: 'blocked', slice: 's1', reason: 'x', at: 'now' },
    { type: 'board-observed', slice: 's1', status: 'Blocked' },
    { type: 'board-observed', slice: 's1', status: 'Planned' },
  ]);
  assert.equal(back.blocked, null);
  assert.equal(back.status, 'Planned');
});

test('slices are tracked independently', () => {
  const state = fold([claimed({ slice: 's1' }), { type: 'board-observed', slice: 's2', status: 'Planned' }]);
  assert.equal(state.slices.s1.status, 'InProgress');
  assert.equal(state.slices.s2.status, 'Planned');
  assert.equal(state.slices.s2.claim, null);
});

test('unknown event types and events without a slice are ignored', () => {
  const s = slice([{ type: 'from-the-future', slice: 's1' }, { type: 'board-observed', status: 'Done' }, claimed()]);
  assert.equal(s.status, 'InProgress');
});

// ── learnings: AGENTS.md is a projection of these ────────────────────────────────

const learning = (id, extra = {}) => ({ type: 'learning-recorded', id, text: `learned ${id}`, ...extra });
const texts = (events) => fold(events).learnings.map((l) => l.text);

test('recorded learnings accumulate in order, with or without a slice', () => {
  assert.deepEqual(texts([learning('l1'), learning('l2', { slice: 's1' })]), ['learned l1', 'learned l2']);
});

test('a retracted learning is gone; retracting an unknown one changes nothing', () => {
  const events = [learning('l1'), learning('l2'), { type: 'learning-retracted', learning: 'l1' }, { type: 'learning-retracted', learning: 'nope' }];
  assert.deepEqual(texts(events), ['learned l2']);
});

test('events that are not learnings never show up as learnings', () => {
  assert.deepEqual(texts([claimed(), { type: 'attempt-failed', slice: 's1', reason: 'timeout' }, { type: 'blocked', slice: 's1', reason: 'x', at: 'now' }]), []);
});

test('a learning is kept with its topic and slice', () => {
  const [l] = fold([learning('l1', { topic: 'Testing', slice: 's1' })]).learnings;
  assert.deepEqual({ id: l.id, topic: l.topic, slice: l.slice }, { id: 'l1', topic: 'Testing', slice: 's1' });
});

test('a learning is scoped to the system (the board) or the repo, repo by default', () => {
  const [a, b] = fold([learning('l1', { scope: 'system' }), learning('l2')]).learnings;
  assert.equal(a.scope, 'system');
  assert.equal(b.scope, 'repo');
});

test('a learning carries its tags, none by default', () => {
  const [a, b] = fold([learning('l1', { tags: ['api', 'ui'] }), learning('l2')]).learnings;
  assert.deepEqual(a.tags, ['api', 'ui']);
  assert.deepEqual(b.tags, []);
});

// The curator is an LLM that writes events: it merges and retracts, and marks what it has reviewed.

test('learning-merged replaces its sources by one learning, in the slot of the first', () => {
  const state = fold([
    learning('l1', { topic: 'Testing', text: 'run npm test' }),
    learning('l2', { topic: 'Git', text: 'rebase before merge' }),
    learning('l3', { topic: 'Testing', text: 'tests are run with npm test' }),
    { type: 'learning-merged', id: 'm1', learnings: ['l1', 'l3'], text: 'Run the suite with npm test', topic: 'Testing' },
  ]);
  assert.deepEqual(state.learnings.map((l) => [l.id, l.text]), [['m1', 'Run the suite with npm test'], ['l2', 'rebase before merge']]);
});

test('a merged learning keeps the sources\' scope unless the merge names one, and counts as curated', () => {
  const events = [learning('l1', { scope: 'system' }), learning('l2', { scope: 'system' })];
  const kept = fold([...events, { type: 'learning-merged', id: 'm1', learnings: ['l1', 'l2'], text: 'x' }]).learnings[0];
  assert.deepEqual([kept.scope, kept.curated], ['system', true]);
  const named = fold([...events, { type: 'learning-merged', id: 'm2', learnings: ['l1', 'l2'], text: 'x', scope: 'repo' }]).learnings[0];
  assert.equal(named.scope, 'repo');
});

test('a merged learning has the tags of its sources plus the ones the merge names', () => {
  const state = fold([
    learning('l1', { tags: ['api'] }), learning('l2', { tags: ['ui', 'api'] }),
    { type: 'learning-merged', id: 'm1', learnings: ['l1', 'l2'], text: 'x', tags: ['testing'] },
  ]);
  assert.deepEqual(state.learnings[0].tags, ['api', 'ui', 'testing']);
});

test('a merge naming unknown learnings merges only the known ones; naming none changes nothing', () => {
  const events = [learning('l1'), learning('l2')];
  assert.deepEqual(texts([...events, { type: 'learning-merged', id: 'm1', learnings: ['l1', 'nope'], text: 'merged' }]), ['merged', 'learned l2']);
  assert.deepEqual(texts([...events, { type: 'learning-merged', id: 'm2', learnings: ['nope'], text: 'merged' }]), ['learned l1', 'learned l2']);
});

test('learnings-curated marks everything recorded so far; later learnings are uncurated', () => {
  const state = fold([learning('l1'), learning('l2'), { type: 'learnings-curated' }, learning('l3')]);
  assert.deepEqual(state.learnings.map((l) => l.curated), [true, true, false]);
});

test('needsCuration is true once enough learnings are waiting for review', () => {
  const state = fold([learning('l1'), { type: 'learnings-curated' }, learning('l2'), learning('l3')]);
  assert.equal(needsCuration(state, 2), true);
  assert.equal(needsCuration(state, 3), false);
  assert.equal(needsCuration(fold([]), 1), false);
});

test('renderLearnings groups by topic, one line each, topics in order of first appearance', () => {
  const state = fold([
    learning('l1', { topic: 'Testing', text: 'Run the suite with npm test' }),
    learning('l2', { topic: 'Git', text: 'Never amend a merged commit' }),
    learning('l3', { topic: 'Testing', text: 'Mock fetch, not the module' }),
  ]);
  assert.equal(renderLearnings(state), [
    '<!-- Generated from the slice-state event log. Record learnings with the learn command; do not edit. -->',
    '',
    '## Testing',
    '- Run the suite with npm test',
    '- Mock fetch, not the module',
    '',
    '## Git',
    '- Never amend a merged commit',
    '',
  ].join('\n'));
});

test('learningKey ignores case and whitespace', () => {
  assert.equal(learningKey('  Use   NPM test '), learningKey('use npm test'));
  assert.notEqual(learningKey('use npm test'), learningKey('use pnpm test'));
});

test('renderLearnings drops duplicates (ignoring case and whitespace), puts topic-less ones under General', () => {
  const state = fold([learning('l1', { text: 'Use  npm test' }), learning('l2', { text: 'use npm TEST' })]);
  assert.match(renderLearnings(state), /## General\n- Use {2}npm test\n/);
  assert.equal(renderLearnings(state).match(/^- /gm).length, 1);
});

test('renderLearnings of nothing is empty', () => {
  assert.equal(renderLearnings(fold([])), '');
});

// ── decideSettle ────────────────────────────────────────────────────────────────

const open = (extra = [], claim = {}) => fold([claimed(claim), { type: 'claim-confirmed', slice: 's1' }, ...extra]);

test('settle pushes the outcome the agent recorded (5)', () => {
  const state = open([{ type: 'agent-recorded', slice: 's1', status: 'Done' }]);
  assert.deepEqual(decideSettle(state, 's1', { boardStatus: 'InProgress' }), [{ type: 'push', status: 'Done' }]);
});

test('settle with no outcome discards the build and puts the slice back to the pickup status (6)', () => {
  assert.deepEqual(decideSettle(open(), 's1', { boardStatus: 'InProgress' }), [
    { type: 'discard', base: BASE, skip: false },
    { type: 'push', status: 'Planned' },
  ]);
  assert.deepEqual(decideSettle(open(), 's1', { boardStatus: 'InProgress', pickupStatus: 'Handover' }).at(-1), { type: 'push', status: 'Handover' });
});

test('an agent that recorded only the pickup status counts as unfinished', () => {
  const state = open([{ type: 'agent-recorded', slice: 's1', status: 'Planned' }]);
  assert.deepEqual(decideSettle(state, 's1', { boardStatus: 'InProgress' }).map((a) => a.type), ['discard', 'push']);
});

test('a slice someone else moved off InProgress is left alone (7)', () => {
  assert.deepEqual(decideSettle(open(), 's1', { boardStatus: 'Blocked' }), [{ type: 'release', reason: 'moved' }]);
  const done = open([{ type: 'agent-recorded', slice: 's1', status: 'Done' }]);
  assert.deepEqual(decideSettle(done, 's1', { boardStatus: 'Blocked' }), [{ type: 'release', reason: 'moved' }]);
});

test('an unknown board status (no board, or the slice is missing) does not stop the settle', () => {
  const state = open([{ type: 'agent-recorded', slice: 's1', status: 'Done' }]);
  assert.deepEqual(decideSettle(state, 's1', { boardStatus: null }), [{ type: 'push', status: 'Done' }]);
});

test('an unconfirmed claim is only released, never pushed (4)', () => {
  const state = fold([claimed()]);
  assert.deepEqual(decideSettle(state, 's1', { boardStatus: 'Planned' }), [{ type: 'release', reason: 'unconfirmed' }]);
});

test('settling a slice with no open claim does nothing', () => {
  assert.deepEqual(decideSettle(fold([]), 's1', { boardStatus: 'Planned' }), []);
});

test('a claim made on a dirty tree is never discarded (14)', () => {
  const state = open([], { cleanTree: false });
  assert.deepEqual(decideSettle(state, 's1', { boardStatus: 'InProgress' })[0], { type: 'discard', base: BASE, skip: true });
});

// ── decideRecovery ──────────────────────────────────────────────────────────────

const facts = (extra = {}) => ({ isAlive: () => false, selfPid: 1, boardStatuses: { s1: 'InProgress' }, ...extra });

test('a confirmed claim of a dead process is settled like a finished build (9)', () => {
  assert.deepEqual(decideRecovery(open(), facts()), [{
    slice: 's1',
    actions: [{ type: 'discard', base: BASE, skip: false }, { type: 'push', status: 'Planned' }],
  }]);
});

test('a dead process that had recorded an outcome gets it pushed (9)', () => {
  const state = open([{ type: 'agent-recorded', slice: 's1', status: 'Done' }]);
  assert.deepEqual(decideRecovery(state, facts())[0].actions, [{ type: 'push', status: 'Done' }]);
});

test('an unconfirmed claim of a dead process is only released (9)', () => {
  assert.deepEqual(decideRecovery(fold([claimed()]), facts()), [{ slice: 's1', actions: [{ type: 'release', reason: 'unconfirmed' }] }]);
});

test('a claim held by another live process is left alone (10)', () => {
  assert.deepEqual(decideRecovery(open(), facts({ isAlive: (pid) => pid === 100 })), []);
});

test('a leftover claim of this very process is settled even though the pid is alive', () => {
  const state = open([], { pid: 7 });
  assert.equal(decideRecovery(state, facts({ selfPid: 7, isAlive: () => true })).length, 1);
});

test('recovery covers every open claim and skips slices without one', () => {
  const state = fold([
    claimed({ slice: 's1' }), { type: 'claim-confirmed', slice: 's1' },
    claimed({ slice: 's2', pid: 300 }), { type: 'claim-confirmed', slice: 's2' },
    { type: 'board-observed', slice: 's3', status: 'Planned' },
  ]);
  const result = decideRecovery(state, facts({ isAlive: (pid) => pid === 300, boardStatuses: { s1: 'InProgress', s2: 'InProgress' } }));
  assert.deepEqual(result.map((r) => r.slice), ['s1']);
});
