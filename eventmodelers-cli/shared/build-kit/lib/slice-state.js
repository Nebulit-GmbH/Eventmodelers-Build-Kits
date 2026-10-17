// Local slice state as an event log: `fold` derives it, `decide*` turn it into actions. Both are pure —
// the run loop appends the events, executes the actions and appends what came of them.
// Design and the precedence rule: slice-state-test-design.md.
//
// Events (one writer per type): board-observed, claimed, claim-confirmed, agent-recorded, settled,
// released, attempt-failed, blocked, learning-recorded, learning-retracted, learning-merged, learnings-curated. Unknown types are ignored, so a
// newer loop's log is readable.

const emptySlice = () => ({
  status: undefined,
  claim: null,
  pendingOutcome: null,
  lastBoardStatus: undefined,
  attempts: 0,
  blocked: null,
});

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

const apply = {
  // While a claim is open the board's view is recorded but does not touch `status`: a refresh that
  // still shows InProgress must not revert the outcome the agent recorded. Attempts reset only between
  // builds — our own claim moving the board to InProgress is not the slice leaving Planned.
  'board-observed'(s, e) {
    s.lastBoardStatus = e.status;
    if (s.claim) return;
    s.status = e.status;
    if (!same(e.status, 'Planned')) s.attempts = 0;
    if (same(e.status, 'Planned')) s.blocked = null;
  },
  // First claim wins: while one is open a second `claimed` for the slice is ignored.
  claimed(s, e) {
    if (s.claim) return;
    s.claim = { pid: e.pid, confirmed: false, base: e.base ?? null, cleanTree: e.cleanTree, ctx: e.ctx, title: e.title, prevStatus: s.status };
    s.pendingOutcome = null;
    s.status = 'InProgress';
  },
  'claim-confirmed'(s) {
    if (s.claim) s.claim.confirmed = true;
  },
  'agent-recorded'(s, e) {
    s.status = e.status;
    if (s.claim) s.pendingOutcome = e.status;
  },
  settled(s, e) {
    s.claim = null;
    s.pendingOutcome = null;
    s.status = e.status;
    s.lastBoardStatus = e.status;
  },
  // The claim ended without anything pushed: the slice shows what the board last said (someone else may
  // have moved it meanwhile), or what it was before the claim if the board was never observed.
  released(s) {
    if (!s.claim) return;
    s.status = s.lastBoardStatus ?? s.claim.prevStatus;
    s.claim = null;
    s.pendingOutcome = null;
  },
  'attempt-failed'(s) {
    s.attempts += 1;
  },
  blocked(s, e) {
    s.blocked = { reason: e.reason, at: e.at };
    s.status = 'Blocked';
  },
};

// The curator's merge: the known sources are replaced by one learning, in the slot of the first of them.
function mergeLearnings(learnings, e) {
  const sources = learnings.filter((l) => e.learnings?.includes(l.id));
  if (!sources.length) return learnings;
  const tags = [...new Set([...sources.flatMap((l) => l.tags), ...(e.tags ?? [])])];
  const merged = { id: e.id, text: e.text, topic: e.topic, slice: undefined, scope: e.scope ?? sources[0].scope, tags, curated: true };
  return learnings.flatMap((l) => (l === sources[0] ? [merged] : sources.includes(l) ? [] : [l]));
}

export function fold(events) {
  const slices = {};
  let learnings = [];
  for (const e of events) {
    if (!e) continue;
    // Learnings are not about one slice (the slice is just where it was learned), so they sit beside them.
    if (e.type === 'learning-recorded') learnings.push({ id: e.id, text: e.text, topic: e.topic, slice: e.slice, scope: e.scope ?? 'repo', tags: e.tags ?? [], curated: false });
    else if (e.type === 'learning-retracted') learnings = learnings.filter((l) => l.id !== e.learning);
    else if (e.type === 'learning-merged') learnings = mergeLearnings(learnings, e);
    else if (e.type === 'learnings-curated') learnings = learnings.map((l) => ({ ...l, curated: true }));
    if (!e.slice || !Object.hasOwn(apply, e.type)) continue;
    apply[e.type](slices[e.slice] ??= emptySlice(), e);
  }
  return { slices, learnings };
}

// The curator (an LLM, writing events) is worth a turn once this many learnings have been recorded since
// it last reviewed them.
export function needsCuration(state, threshold) {
  return state.learnings.filter((l) => !l.curated).length >= threshold && threshold > 0;
}

// AGENTS.md: the learnings, grouped by topic (in order of first appearance), one line each, duplicates
// dropped. Nothing is written into the file by hand — it is regenerated from the log.
export function renderLearnings(state) {
  const topics = new Map();
  const seen = new Set();
  for (const { text, topic } of state.learnings) {
    const key = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const name = topic?.trim() || 'General';
    if (!topics.has(name)) topics.set(name, []);
    topics.get(name).push(String(text).trim());
  }
  if (!topics.size) return '';
  const body = [...topics].map(([name, lines]) => `## ${name}\n${lines.map((l) => `- ${l}`).join('\n')}\n`).join('\n');
  return `<!-- Generated from the slice-state event log. Record learnings with the learn command; do not edit. -->\n\n${body}`;
}

// What to do with a claimed slice once its build is over. `boardStatus` is the board's current status
// for it (null when unknown or there is no board); `pickupStatus` is what an unfinished slice goes back
// to (Planned, or Handover for UI kits). Actions: discard {base, skip}, push {status}, release {reason} —
// the loop appends `settled` after a successful push and `released` for a release. A failed push appends
// nothing, so the claim stays open and the next iteration settles it again.
export function decideSettle(state, sliceId, { boardStatus = null, pickupStatus = 'Planned' } = {}) {
  const s = state.slices[sliceId];
  const claim = s?.claim;
  if (!claim) return [];
  // Never confirmed on the board: nothing of ours to push there — the slice may belong to the winner of the race.
  if (!claim.confirmed) return [{ type: 'release', reason: 'unconfirmed' }];
  // Someone else moved it (a person, request-feedback's Blocked) — theirs to keep.
  if (boardStatus && !same(boardStatus, 'InProgress')) return [{ type: 'release', reason: 'moved' }];
  const outcome = s.pendingOutcome;
  const unfinished = !outcome || same(outcome, 'InProgress') || same(outcome, pickupStatus);
  if (!unfinished) return [{ type: 'push', status: outcome }];
  // `skip`: the tree already held someone's edits at claim time, so none of it is the build's debris.
  return [{ type: 'discard', base: claim.base, skip: !claim.cleanTree }, { type: 'push', status: pickupStatus }];
}

// Claims still open at the top of a loop iteration are leftovers: the process died mid-build, or settling
// failed last time. Each is settled the way a finished build is. A claim held by another live process
// belongs to it — left alone.
export function decideRecovery(state, { isAlive, selfPid, boardStatuses = {}, pickupStatus = 'Planned' }) {
  const result = [];
  for (const [slice, s] of Object.entries(state.slices)) {
    if (!s.claim) continue;
    if (s.claim.pid !== selfPid && isAlive(s.claim.pid)) continue;
    result.push({ slice, actions: decideSettle(state, slice, { boardStatus: boardStatuses[slice] ?? null, pickupStatus }) });
  }
  return result;
}
