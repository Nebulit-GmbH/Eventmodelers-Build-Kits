import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { observeBoard } from '../shared/build-kit/lib/slice-projection.js';
import { claimSlice, recordAgentStatus, settleSlice, settleLeftoverClaims } from '../shared/build-kit/lib/slice-run.js';
import { quiet, tempKit } from './helpers.js';

// The loop's shell around the pure core: claim → build → settle, and recovery of leftover claims.
// The board is injected, so these tests need no fetch mock. Case numbers refer to slice-state-learnings.md.

const planned = { id: 's1', title: 'Add item', ctx: 'cart' };
const DEAD = 2 ** 22 + 12345;
const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };

// A project dir with a git repo and a kit dir holding slice s1, observed as Planned on the board.
function project(t) {
  const root = tempKit(t);
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'code.txt'), 'v1');
  const kit = join(root, '.build-kit');
  mkdirSync(join(kit, '.slices', 'cart', 'additem'), { recursive: true });
  writeFileSync(join(kit, '.slices', 'cart', 'index.json'), JSON.stringify({ slices: [{ id: 's1', slice: 'Add item', folder: 'additem', status: 'Planned', definition: { id: 's1', status: 'Planned' } }] }));
  writeFileSync(join(kit, '.slices', 'cart', 'additem', 'slice.json'), JSON.stringify({ id: 's1', status: 'Planned' }));
  git('add', '-A');
  git('commit', '-qm', 'init');
  observeBoard(kit, [{ id: 's1', status: 'Planned' }], META);
  return { root, kit, git };
}

const state = (kit) => fold(readEvents(kit)).slices.s1;
const indexPath = (kit) => join(kit, '.slices', 'cart', 'index.json');
const localStatus = (kit) => JSON.parse(readFileSync(indexPath(kit), 'utf-8')).slices[0].status;
// The build agent today records its outcome by editing index.json itself.
const agentSets = (kit, status) => {
  const index = JSON.parse(readFileSync(indexPath(kit), 'utf-8'));
  index.slices[0].status = status;
  writeFileSync(indexPath(kit), JSON.stringify(index));
};

// Board stand-in: records the writes, serves a status, can reject writes or reads.
function fakeBoard({ remote = 'Planned', rejectWrites = false, failReads = false } = {}) {
  const board = {
    writes: [],
    remote,
    async setStatus(id, status) {
      if (rejectWrites) throw Object.assign(new Error('HTTP 409: ALREADY_IN_STATUS'), { status: 409 });
      board.writes.push(status);
      board.remote = status;
    },
    async readStatus() {
      if (failReads) throw new Error('board unreachable');
      return board.remote;
    },
  };
  return board;
}

const claim = (kit, board, extra = {}) => claimSlice({ kitDir: kit, planned, board, meta: META, cleanTree: true, ...extra });
const settle = (kit, board, extra = {}) => settleSlice({ kitDir: kit, planned, board, meta: META, pickupStatus: 'Planned', ...extra });

// ── claiming ────────────────────────────────────────────────────────────────────

test('a won claim is confirmed, pushes InProgress, and shows InProgress to the agent (3)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard({ remote: 'Planned' });
  assert.equal(await claim(kit, board), 'won');
  assert.deepEqual(board.writes, ['InProgress']);
  assert.equal(state(kit).claim.confirmed, true);
  assert.equal(state(kit).claim.pid, process.pid);
  assert.equal(localStatus(kit), 'InProgress');
});

test('the claim records the git state it started from and the tree\'s cleanliness', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, fakeBoard(), { cleanTree: false });
  assert.equal(state(kit).claim.cleanTree, false);
  assert.equal(state(kit).claim.base.head.length, 40);
});

test('every event of a claim carries the agent, organization and board', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, fakeBoard({ remote: 'Planned' }));
  for (const e of readEvents(kit).filter((e) => e.type !== 'board-observed')) assert.deepEqual(e.meta, META);
});

test('a claim the board rejects is lost: no build, no claim left, status back to what the board showed (1)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard({ remote: 'Planned', rejectWrites: true });
  assert.equal(await claim(kit, board), 'lost');
  assert.equal(state(kit).claim, null);
  assert.deepEqual(board.writes, []);
  assert.equal(localStatus(kit), 'Planned');
  assert.ok(readEvents(kit).some((e) => e.type === 'released' && e.reason === 'lost'));
});

test('a lost claim counts as a failed attempt, so a slice the board keeps refusing is eventually switched away from and blocked', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, fakeBoard({ remote: 'Planned', rejectWrites: true }));
  await claim(kit, fakeBoard({ remote: 'Planned', rejectWrites: true }));
  assert.equal(state(kit).attempts, 2);
  assert.equal(readEvents(kit).filter((e) => e.type === 'attempt-failed')[0].reason, 'claim-lost');
});

test('a slice another live process holds is not claimed, and the board is not touched', async (t) => {
  quiet(t);
  const { kit } = project(t);
  appendEvent(kit, { type: 'claimed', slice: 's1', ctx: 'cart', title: 'Add item', pid: process.ppid, base: null, cleanTree: true });
  const board = fakeBoard({ remote: 'Planned' });
  assert.equal(await claim(kit, board), 'held');
  assert.deepEqual(board.writes, []);
  assert.equal(state(kit).claim.pid, process.ppid);
});

test('without a board the claim is confirmed straight away', async (t) => {
  quiet(t);
  const { kit } = project(t);
  assert.equal(await claim(kit, null), 'won');
  assert.equal(state(kit).claim.confirmed, true);
  assert.equal(localStatus(kit), 'InProgress');
});

test('a slice the board no longer shows as Planned is not claimed — someone else got there first', async (t) => {
  quiet(t);
  const { kit } = project(t);
  for (const remote of ['InProgress', 'Done', 'Blocked']) {
    const board = fakeBoard({ remote });
    assert.equal(await claim(kit, board), 'lost', remote);
    assert.deepEqual(board.writes, [], `${remote}: nothing written to the board`);
    assert.equal(state(kit).claim, null);
  }
});

test('a lost claim of a stale view corrects it: the board\'s real status is recorded and shown to the loop', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, fakeBoard({ remote: 'Done' }));
  assert.equal(state(kit).status, 'Done');
  assert.equal(localStatus(kit), 'Done');
  assert.equal(readEvents(kit).filter((e) => e.type === 'board-observed').at(-1).status, 'Done');
});

test('the pickup status of the kit is what the board must show (Handover for UI kits)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  assert.equal(await claim(kit, fakeBoard({ remote: 'Handover' }), { pickupStatus: 'Handover' }), 'won');
  const other = project(t).kit;
  assert.equal(await claim(other, fakeBoard({ remote: 'Planned' }), { pickupStatus: 'Handover' }), 'lost');
});

test('a board that cannot be read is not claimed against, and an unknown status does not stop a claim', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard({ remote: 'Planned' });
  board.readStatus = async () => { throw new Error('board unreachable'); };
  assert.equal(await claim(kit, board), 'lost');
  assert.deepEqual(board.writes, []);
  const { kit: other } = project(t);
  const unknown = fakeBoard();
  unknown.readStatus = async () => null;
  assert.equal(await claim(other, unknown), 'won');
});

// ── settling ────────────────────────────────────────────────────────────────────

test('settle pushes the outcome the agent recorded in index.json and closes the claim (5)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  agentSets(kit, 'Done');
  assert.equal(await settle(kit, board), true);
  assert.deepEqual(board.writes, ['InProgress', 'Done']);
  assert.equal(state(kit).claim, null);
  assert.equal(state(kit).status, 'Done');
  assert.equal(localStatus(kit), 'Done');
});

test('settle puts an unfinished slice back to Planned, undoes the build and records the failed attempt (6)', async (t) => {
  quiet(t);
  const { root, kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  writeFileSync(join(root, 'code.txt'), 'half done');
  assert.equal(await settle(kit, board, { details: { built: false, lastReply: 'ran out of time' } }), true);
  assert.deepEqual(board.writes, ['InProgress', 'Planned']);
  assert.equal(localStatus(kit), 'Planned');
  assert.equal(readFileSync(join(root, 'code.txt'), 'utf-8'), 'v1');
  const failed = readEvents(kit).find((e) => e.type === 'attempt-failed');
  assert.equal(failed.slice, 's1');
  assert.equal(failed.lastReply, 'ran out of time');
  assert.equal(failed.status, 'Planned');
  assert.match(failed.changed, /code\.txt/);
  assert.equal(state(kit).attempts, 1);
});

test('an unfinished slice goes back to the pickup status of the kit (Handover for UI kits)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  await settle(kit, board, { pickupStatus: 'Handover' });
  assert.deepEqual(board.writes, ['InProgress', 'Handover']);
  assert.equal(readEvents(kit).find((e) => e.type === 'attempt-failed').status, 'Handover');
});

test('a build on a tree that already held someone\'s edits is never discarded (14)', async (t) => {
  quiet(t);
  const { root, kit } = project(t);
  writeFileSync(join(root, 'code.txt'), 'a person\'s edit');
  const board = fakeBoard();
  await claim(kit, board, { cleanTree: false });
  await settle(kit, board);
  assert.equal(readFileSync(join(root, 'code.txt'), 'utf-8'), 'a person\'s edit');
  assert.deepEqual(board.writes, ['InProgress', 'Planned']);
});

test('settle leaves a slice someone else moved off InProgress alone (7)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  board.remote = 'Blocked';
  assert.equal(await settle(kit, board), true);
  assert.deepEqual(board.writes, ['InProgress']);
  assert.equal(state(kit).claim, null);
  assert.ok(readEvents(kit).some((e) => e.type === 'released' && e.reason === 'moved'));
});

test('settle reports failure when the board rejects the push, and the claim stays open for a retry (8)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  agentSets(kit, 'Done');
  board.setStatus = async () => { throw Object.assign(new Error('HTTP 409'), { status: 409 }); };
  assert.equal(await settle(kit, board), false);
  assert.notEqual(state(kit).claim, null);
  assert.equal(state(kit).pendingOutcome, 'Done');
  assert.equal(readEvents(kit).some((e) => e.type === 'settled'), false);
});

test('settle reports failure when the board cannot be read, and changes nothing', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  board.readStatus = async () => { throw new Error('board unreachable'); };
  assert.equal(await settle(kit, board), false);
  assert.notEqual(state(kit).claim, null);
});

test('settling after a failed settle does not count the attempt twice', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  const push = board.setStatus;
  board.setStatus = async () => { throw Object.assign(new Error('HTTP 409'), { status: 409 }); };
  assert.equal(await settle(kit, board), false);
  board.setStatus = push;
  assert.equal(await settle(kit, board), true);
  assert.equal(state(kit).attempts, 1);
});

test('settle without a board still closes the claim and records the outcome', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, null);
  agentSets(kit, 'Done');
  assert.equal(await settle(kit, null), true);
  assert.equal(state(kit).claim, null);
  assert.equal(localStatus(kit), 'Done');
});

test('settle with no open claim does nothing', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  assert.equal(await settle(kit, board), true);
  assert.deepEqual(board.writes, []);
});

// ── recovery ────────────────────────────────────────────────────────────────────

const leftover = (kit, { pid = DEAD, confirmed = true, cleanTree = true } = {}) => {
  appendEvent(kit, { type: 'claimed', slice: 's1', ctx: 'cart', title: 'Add item', pid, base: null, cleanTree });
  if (confirmed) appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
};
const recover = (kit, board) => settleLeftoverClaims({ kitDir: kit, board, meta: META, pickupStatus: 'Planned' });

test('a confirmed claim of a dead process is released back to Planned at the next iteration (9)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  leftover(kit);
  const board = fakeBoard({ remote: 'InProgress' });
  await recover(kit, board);
  assert.deepEqual(board.writes, ['Planned']);
  assert.equal(state(kit).claim, null);
  assert.equal(localStatus(kit), 'Planned');
});

test('a dead process that had recorded its outcome gets it pushed (9)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  leftover(kit);
  agentSets(kit, 'Done');
  const board = fakeBoard({ remote: 'InProgress' });
  await recover(kit, board);
  assert.deepEqual(board.writes, ['Done']);
});

test('an unconfirmed claim of a dead process never writes to the board (4)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  leftover(kit, { confirmed: false });
  const board = fakeBoard({ remote: 'InProgress' });
  await recover(kit, board);
  assert.deepEqual(board.writes, []);
  assert.equal(state(kit).claim, null);
});

test('a claim held by another live process is left alone (10)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  leftover(kit, { pid: process.ppid });
  const board = fakeBoard({ remote: 'InProgress' });
  await recover(kit, board);
  assert.deepEqual(board.writes, []);
  assert.notEqual(state(kit).claim, null);
});

test('a claim of this very process left over from a failed settle is settled again', async (t) => {
  quiet(t);
  const { kit } = project(t);
  leftover(kit, { pid: process.pid });
  const board = fakeBoard({ remote: 'InProgress' });
  await recover(kit, board);
  assert.equal(state(kit).claim, null);
});

test('recovery with nothing left over does nothing', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard({ remote: 'InProgress' });
  await recover(kit, board);
  assert.deepEqual(board.writes, []);
  assert.equal(existsSync(join(kit, 'events')), true);
});

// ── the build agent's side: recordAgentStatus (behind `eventmodelers slice-status`) ─────────────

test('the agent records its outcome for the one slice the loop has claimed; the loop then pushes it (5)', async (t) => {
  quiet(t);
  const { kit } = project(t);
  const board = fakeBoard();
  await claim(kit, board);
  const result = recordAgentStatus({ kitDir: kit, status: 'Done', meta: META });
  assert.deepEqual(result, { slice: 's1', title: 'Add item', status: 'Done' });
  assert.equal(localStatus(kit), 'Done');
  assert.equal(state(kit).pendingOutcome, 'Done');
  assert.equal(await settle(kit, board), true);
  assert.deepEqual(board.writes, ['InProgress', 'Done']);
  const recorded = readEvents(kit).filter((e) => e.type === 'agent-recorded');
  assert.deepEqual(recorded.map((e) => [e.status, e.meta]), [['Done', META]]);
});

test('the slice can be named by id or by title, and must be one the loop has claimed', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, fakeBoard());
  assert.equal(recordAgentStatus({ kitDir: kit, status: 'Review', sliceId: 's1' }).slice, 's1');
  assert.equal(recordAgentStatus({ kitDir: kit, status: 'Done', sliceId: 'add ITEM' }).slice, 's1');
  assert.throws(() => recordAgentStatus({ kitDir: kit, status: 'Done', sliceId: 'other' }), /not claimed/);
});

test('without a claim there is nothing to record — the board owns tasks.json statuses', (t) => {
  quiet(t);
  const { kit } = project(t);
  assert.throws(() => recordAgentStatus({ kitDir: kit, status: 'Done' }), /update-slice-status/);
  assert.equal(readEvents(kit).some((e) => e.type === 'agent-recorded'), false);
});

test('with several claims the agent has to name the slice', async (t) => {
  quiet(t);
  const { kit } = project(t);
  await claim(kit, fakeBoard());
  appendEvent(kit, { type: 'claimed', slice: 's2', ctx: 'cart', title: 'Remove item', pid: process.pid, base: null, cleanTree: true });
  assert.throws(() => recordAgentStatus({ kitDir: kit, status: 'Done' }), /2 slices are claimed/);
  assert.equal(recordAgentStatus({ kitDir: kit, status: 'Done', sliceId: 's2' }).title, 'Remove item');
});

test('the claim records the slice\'s ticket and assignee when it has them, and nothing when it has none', async (t) => {
  quiet(t);
  const { kit } = project(t);
  assert.equal(await claim(kit, null, {}), 'won');
  const [bare] = readEvents(kit).filter((e) => e.type === 'claimed');
  assert.equal('ticketNumber' in bare || 'assignee' in bare, false);

  const { kit: kit2 } = project(t);
  assert.equal(await claimSlice({ kitDir: kit2, planned: { ...planned, ticketNumber: 'PROJ-7', assignee: 'user-1' }, board: null, meta: META, cleanTree: true }), 'won');
  const [full] = readEvents(kit2).filter((e) => e.type === 'claimed');
  assert.equal(full.ticketNumber, 'PROJ-7');
  assert.equal(full.assignee, 'user-1');
});
