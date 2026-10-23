// The run loop's shell around the pure slice-state core: claim a slice, settle it after the build, and
// release claims a dead process left behind. Every step appends events and re-projects status for the
// build agent; `decide*` (slice-state.js) says what to do, this executes it.
//
// `board` is injected: { setStatus(sliceId, status), readStatus(sliceId) → status | null }. null means
// no board (--local): nothing is pushed or read, the log alone decides.

import { appendEvent, readEvents } from './slice-events.js';
import { fold, decideSettle, decideRecovery, statusKey } from './slice-state.js';
import { adoptAgentEdits, projectStatus } from './slice-projection.js';
import { discardUnfinishedWork, gitBase } from './slice-git.js';

// Appends an event and re-projects status, so the files the agent reads never lag the log.
export function recordEvent(kitDir, event, meta) {
  appendEvent(kitDir, event, meta);
  const state = fold(readEvents(kitDir));
  projectStatus(kitDir, state);
  return state;
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, just not ours; ESRCH means gone
  }
}

// The build agent's side (behind `eventmodelers slice-status`): it records the outcome of the slice the
// loop has claimed, instead of editing index.json. The loop pushes it to the board when the build ends.
// The slice is the one open claim, or the one named by id or title. Appends `agent-recorded` and
// projects straight away — the file the agent reads must never lag the log, or the next refresh would
// take the stale file for an edit.
export function recordAgentStatus({ kitDir, status, sliceId, meta }) {
  const claimed = Object.entries(fold(readEvents(kitDir)).slices).filter(([, s]) => s.claim);
  let match;
  if (sliceId) {
    const wanted = sliceId.trim().toLowerCase();
    match = claimed.find(([id, s]) => id === sliceId || s.claim.title?.toLowerCase() === wanted);
    if (!match) throw new Error(`slice "${sliceId}" is not claimed by the run loop — only a slice the loop is building has its status recorded here`);
  } else if (claimed.length === 1) {
    match = claimed[0];
  } else if (claimed.length > 1) {
    throw new Error(`${claimed.length} slices are claimed (${claimed.map(([, s]) => s.claim.title).join(', ')}) — name one with --slice`);
  } else {
    throw new Error('no slice is claimed by the run loop. For a task from tasks.json, set the status with the update-slice-status skill instead');
  }
  const [id, { claim }] = match;
  recordEvent(kitDir, { type: 'agent-recorded', slice: id, status }, meta);
  return { slice: id, title: claim.title ?? id, status };
}

// Claims a slice before it is built. The log is the local arbiter (the first claim wins); the board is
// the cross-agent one — the claim is a compare-and-set (expectedSliceStatus = the pickup status), so the board
// refuses it unless the slice is still in the pickup status. Returns 'won', 'held'
// (another live process owns it in this kit) or 'lost' (the board refused; nothing was built).
export async function claimSlice({ kitDir, planned, board, meta, cleanTree, pid = process.pid, pickupStatus = 'Planned' }) {
  const open = fold(readEvents(kitDir)).slices[planned.id]?.claim;
  if (open && open.pid !== pid && isProcessAlive(open.pid)) return 'held';
  // Look at the board before claiming. The compare-and-set below decides a race; this read only catches a stale view early, so an
  // agent working from a stale view (Planned, while another has already built and finished it) would otherwise move
  // a Done slice back to InProgress and build it twice. What the board really shows is recorded, which also puts the
  // loop's stale local view right. (Two claims in the same instant are decided by the compare-and-set.)
  if (board) {
    let current;
    try {
      current = await board.readStatus(planned.id);
    } catch (err) {
      console.error(`[ralph] Could not read the board before claiming "${planned.title}":`, err.message);
      return 'lost';
    }
    if (current && statusKey(current) !== statusKey(pickupStatus)) {
      console.log(`[ralph] "${planned.title}" is ${current} on the board, not ${pickupStatus} — someone else got there first.`);
      recordEvent(kitDir, { type: 'board-observed', slice: planned.id, status: current }, meta);
      return 'lost';
    }
  }
  const state = recordEvent(kitDir, {
    type: 'claimed', slice: planned.id, ctx: planned.ctx, title: planned.title, pid, base: gitBase(kitDir), cleanTree,
    // What the board says about the slice at build time, when it says anything: both can change between builds.
    ...(planned.ticketNumber ? { ticketNumber: planned.ticketNumber } : {}),
    ...(planned.assignee ? { assignee: planned.assignee } : {}),
    ...(planned.feature ? { feature: planned.feature } : {}),
  }, meta);
  if (state.slices[planned.id].claim?.pid !== pid) return 'held';
  if (board) {
    try {
      await board.setStatus(planned.id, 'InProgress', pickupStatus);
    } catch (err) {
      console.error(`[ralph] Could not claim "${planned.title}" on the board:`, err.message);
      recordEvent(kitDir, { type: 'released', slice: planned.id, reason: 'lost' }, meta);
      // Counted like any attempt that did not move the slice, so one the board keeps refusing is switched away from.
      recordEvent(kitDir, { type: 'attempt-failed', slice: planned.id, reason: 'claim-lost', lastReply: null }, meta);
      return 'lost';
    }
  }
  recordEvent(kitDir, { type: 'claim-confirmed', slice: planned.id }, meta);
  return 'won';
}

// Executes what decideSettle / decideRecovery returned for one slice. false when the board refused the
// push — no `settled` is appended then, so the claim stays open and the next iteration settles it again.
async function runActions({ kitDir, planned, board, meta, actions, details }) {
  const unfinished = actions.some((a) => a.type === 'discard');
  let discarded = null;
  for (const a of actions) {
    if (a.type === 'discard') {
      discarded = discardUnfinishedWork(kitDir, planned, !a.skip, a.base);
    } else if (a.type === 'push') {
      if (board) {
        try {
          await board.setStatus(planned.id, a.status);
        } catch (err) {
          console.error(`[ralph] Could not settle the status of "${planned.title}":`, err.message);
          return false;
        }
      }
      recordEvent(kitDir, { type: 'settled', slice: planned.id, status: a.status }, meta);
      console.log(`[ralph] "${planned.title}" InProgress → ${a.status}.`);
    } else if (a.type === 'release') {
      recordEvent(kitDir, { type: 'released', slice: planned.id, reason: a.reason }, meta);
    }
  }
  // Counted once the slice is actually back, so a retried settle cannot count the attempt twice.
  if (unfinished) {
    recordEvent(kitDir, {
      type: 'attempt-failed',
      slice: planned.id,
      reason: details.built === false ? 'turn-failed' : 'no-outcome',
      status: actions.find((a) => a.type === 'push')?.status,
      lastReply: details.lastReply ?? null,
      ...(discarded ?? {}),
    }, meta);
    console.log(`[ralph] "${planned.title}" ended without an outcome.`);
  }
  return true;
}

// After a build: the outcome the agent recorded is pushed to the board; no outcome means unfinished —
// its work is discarded and the slice goes back to `pickupStatus`. Returns true once settled; false when
// it could not be (the claim stays open and the loop tries again at the top of its next iteration).
export async function settleSlice({ kitDir, planned, board, meta, pickupStatus = 'Planned', details = {} }) {
  const state = adoptAgentEdits(kitDir, fold(readEvents(kitDir)), meta);
  if (!state.slices[planned.id]?.claim) return true;
  let boardStatus = null;
  if (board) {
    try {
      boardStatus = await board.readStatus(planned.id);
    } catch (err) {
      console.error(`[ralph] Could not read the board to settle "${planned.title}":`, err.message);
      return false;
    }
  }
  const actions = decideSettle(state, planned.id, { boardStatus, pickupStatus });
  return runActions({ kitDir, planned, board, meta, actions, details });
}

// Claims still open at the top of an iteration are leftovers: the process died mid-build, or settling
// failed last time. Each is settled like a finished build; one held by another live process is left alone.
export async function settleLeftoverClaims({ kitDir, board, meta, pickupStatus = 'Planned', selfPid = process.pid, isAlive = isProcessAlive }) {
  const state = adoptAgentEdits(kitDir, fold(readEvents(kitDir)), meta);
  const boardStatuses = {};
  const unreadable = new Set();
  for (const [id, s] of Object.entries(state.slices)) {
    if (!s.claim || !board || (s.claim.pid !== selfPid && isAlive(s.claim.pid))) continue;
    try {
      boardStatuses[id] = await board.readStatus(id);
    } catch (err) {
      console.error(`[ralph] Could not read the board to settle the leftover claim on "${s.claim.title ?? id}":`, err.message);
      unreadable.add(id);
    }
  }
  for (const { slice, actions } of decideRecovery(state, { isAlive, selfPid, boardStatuses, pickupStatus })) {
    if (unreadable.has(slice)) continue;
    const claim = state.slices[slice].claim;
    const planned = { id: slice, title: claim.title ?? slice, ctx: claim.ctx };
    console.log(`[ralph] Found an unsettled claim on "${planned.title}" — settling it.`);
    await runActions({ kitDir, planned, board, meta, actions, details: { built: false } });
  }
}
