import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, decideSettle, decideRecovery } from '../shared/build-kit/lib/slice-state.js';

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
