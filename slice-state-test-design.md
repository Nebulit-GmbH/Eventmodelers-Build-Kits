# Event-sourced local slice state — test design

Test-first design. The 16 numbered cases below are from `slice-state-learnings.md`. The point of this
doc: pick the seams so that almost every case is a pure function on a list of events, and only git
and file I/O need real fixtures.

## Shape: functional core, imperative shell

```
events/<id>.json + events.log ──read──▶ fold(events) ──▶ State ──▶ decide*(State, facts) ──▶ Action[]
                                                                    │
                                   shell executes actions (board POST, git discard, project files)
                                   and appends the resulting events
```

- `fold(events) → State` — pure. Unknown event types are ignored.
- `decide*` — pure. Takes the state plus injected facts (`boardStatus`, `isAlive(pid)`), returns actions.
  No fetch, no git, no clock.
- Shell (`ralph.js`) — appends events, runs actions, regenerates the projection files. Kept thin.

### Events (one writer per type)

| event | writer | payload |
|---|---|---|
| `board-observed` | loop (refresh) | `slice, status` |
| `claimed` | loop | `slice, ctx, title, pid, base, cleanTree` |
| `claim-confirmed` | loop | `slice` |
| `agent-recorded` | agent, via `slice-status` command | `slice, status` |
| `settled` | loop | `slice, status` — the outcome is on the board |
| `released` | loop | `slice, reason: lost \| unconfirmed \| moved` — claim ended with nothing pushed |
| `attempt-failed` | loop | `slice, reason, lastReply` |
| `blocked` | loop | `slice, reason` |
| `learning-recorded` | agent, via a `learn` command | `text, topic?, slice?, scope: system \| repo` (default `repo`) |
| `learning-retracted` | agent or curator | `learning: <event id>` |
| `learning-merged` | curator (LLM) | `learnings: [ids], text, topic?, scope?` |
| `learnings-curated` | curator (LLM) | — marks every learning recorded so far as reviewed |

### State

```
slices[id] = {
  status,          // what the agent and the projection files see
  claim,           // null | { pid, confirmed, base, cleanTree, claimedAt }  — open until settled/released
  pendingOutcome,  // null | status the agent recorded that is not yet on the board
  lastBoardStatus, // last board-observed, kept even while a claim masks it
  attempts,        // count of attempt-failed since the slice last left Planned
  blocked,         // null | { reason, at }
}
learnings[]        // { id, text, topic, slice, scope, curated } — recorded, minus retracted, with merges applied
```

### Learnings: AGENTS.md is a projection

`progress.txt` and `progress.pending.txt` are removed. A learning is a `learning-recorded` event
(`text`, optional `topic`, optional `slice`); a wrong or obsolete one is withdrawn with
`learning-retracted`. `AGENTS.md` is `renderLearnings(state)`: grouped by topic in order of first
appearance, one line each, duplicates dropped (ignoring case and whitespace), regenerated from the log
and never edited by hand.

`scope` says who the learning is for: `system` (the modeled domain — the board owns the system) or `repo`
(the codebase that builds it). How each scope is shared across machines (platform for `system`, git for
`repo`, or both on one transport) is open; until it is decided every event store stays local.

**The LLM is a writer of events, never part of the fold.** A curator turn reads the learnings (with their
ids) and appends `learning-merged` for near-duplicates, `learning-retracted` for wrong or obsolete ones,
and finally `learnings-curated`. `renderLearnings` stays deterministic, and every curation decision is an
auditable, replayable event. `needsCuration(state, threshold)` says when a turn is worth it: enough
learnings recorded since the last review. The build agent also records and retracts at write time — it
reads `AGENTS.md` at the start of a session, so it can skip what is already there. No agent turn folds anything, so there is no pending list and no
"keep the pending file" logic. `attempt-failed` and `blocked` are slice state (attempt count, blocked
note), not learnings.

### The precedence rule (this is what ends the Done→Planned loop)

1. While a claim is **open**, `board-observed` does not change `status`. It only updates
   `lastBoardStatus`. A stale refresh therefore cannot revert what the agent recorded.
2. `agent-recorded` after the open claim sets `status` and `pendingOutcome`.
3. `settled` closes the claim, clears `pendingOutcome`, sets `status` to the pushed value.
4. With **no** open claim, the last of `board-observed` / `settled` wins.
5. Two `claimed` for the same slice with no release between: the **first** owns it, the second is
   rejected by the fold (`claim.owner` is the first pid). This is local mutual exclusion by log order.
6. A claim stays open until `settled` or `released`. A failed board write appends nothing, so the claim
   simply stays open and the next iteration retries.

## Test layers

### A. `fold` — pure, table-driven (`events → expected State`)

| test | covers |
|---|---|
| `claimed` opens a claim, status `InProgress` | 3 |
| `claim-confirmed` sets `confirmed` | 3 |
| `released{lost}` after `claimed` leaves no claim, no status change | 1 |
| `claimed, agent-recorded Done, board-observed InProgress` → status `Done`, `pendingOutcome: Done` | revert-loop regression |
| `claimed, agent-recorded Done, settled Done` → claim null, `pendingOutcome` null | 5 |
| second `claimed` while the first is open → first stays owner | rule 5 |
| no open claim, `board-observed A` then `settled B` → `B`; reversed order → `A` | rule 4 |
| `attempt-failed` ×N counts, reset when the board status leaves `Planned` | replaces the in-memory `plannedAttempts` map |
| `blocked` sets `blocked`; a later `board-observed Planned` clears it | |
| `learning-recorded` accumulates in order; `learning-retracted` removes it (unknown id: no change); attempt/blocked events are not learnings | learnings |
| a learning carries its `scope` (default `repo`); `learning-merged` replaces its known sources by one learning in the first one's slot (unknown ids ignored, none known = no change), keeping their scope unless named; `learnings-curated` marks all curated; `needsCuration(state, n)` counts uncurated | curator |
| `renderLearnings`: grouped by topic in first-appearance order, deduped, `General` for topic-less, empty for none | learnings |
| unknown event types are ignored | robustness |

### B. `decide*` — pure

`decideSettle(state, slice, { boardStatus, pickupStatus })` (`pickupStatus` is `Planned`, or `Handover` for UI kits):

| facts | actions | covers |
|---|---|---|
| `pendingOutcome: Done`, board `InProgress` | `[push Done]` | 5 |
| no `pendingOutcome`, status `InProgress`, board `InProgress` | `[discard, push Planned]` | 6 |
| board is `Blocked` (someone else moved it) | `[release moved]`, **no push**, no discard | 7 |
| claim `confirmed: false` | `[release unconfirmed]`, never a push | 4 |

Case 8 needs no `decide` test: the shell appends `settled` only after a successful push, and the
fold test "claim stays open without `settled`" covers it. One shell test checks the board rejecting
the push leaves no `settled`.

`decideRecovery(state, { isAlive, selfPid, boardStatuses, pickupStatus })` (a leftover claim of this very process is settled too):

| facts | actions | covers |
|---|---|---|
| open claim, pid dead, confirmed, no outcome | `[discard, push Planned]` — settled like a finished build | 9 |
| open claim, pid dead, confirmed, outcome recorded | `[push <outcome>]` | 9 |
| open claim, pid dead, unconfirmed | `[release unconfirmed]` | 9 |
| open claim, pid alive (incl. EPERM) | `[]` | 10 |
| open claim, `cleanTree: false` | discard action carries `skip: true` | 14 |

### C. Event store (real files, `tempKit`)

Every event is stamped with `id`, `at` and, when known, `meta: { agent_id, organization_id, board_id }`
(supplied by the caller from the loop's config; only those three keys survive, blanks dropped; a `meta`
smuggled into the event itself is ignored) and optional `tags` (any event; trimmed, de-duplicated, blanks
dropped; `readEvents(kitDir, { tag })` filters). Each event is a standalone JSON file `.build-kit/events/<id>.json`; `.build-kit/events.log` only
indexes them, one id per line, and its order is the event order. The event file is written whole
(temp file, rename) *before* its id is indexed, so the index line is what commits the event.

- `append` creates the dir, the file and the index, and stamps `at` and `id` (the event cannot override its id).
- Tags and `meta` are normalised on write; an event without usable ones has no such field. The refresh stamps
  its `board-observed` events with this agent, organization and board (agent id from `cfg.agentId`, else
  `RALPH_AGENT_ID` / `EVENTMODELERS_AGENT_ID`, the same lookup as the platform headers).
- Every event is a valid standalone JSON file; events read back in index order.
- A file the index doesn't list (crash between the two writes) is never applied.
- An indexed id with a missing or corrupt file is skipped; the rest still load.
- A torn index line is ignored, and the next id starts on a fresh line instead of being glued onto it.
- An id indexed twice is applied once; `append` never rewrites earlier files or index lines; no temp files remain.
- Two processes appending 100 events each with 100 KB payloads lose and tear nothing. Indexing only the id
  is what keeps this safe at any event size.

### D. Projection

- After `fold`, `index.json` `status` and `definition.status` and `slice.json` `status` match the state.
- Revert-loop regression end to end: claim, agent records `Done`, a refresh delivers a stale
  `InProgress` → projection still says `Done`.
- The refresh still merges non-status fields and clears `ticketNumber` to `null` when the summary
  omits it. The log owns **status only**.

### E. Git discard (real git, ported as-is from `slice-claim.test.js`)

Cases 11–16 are about git and `progress.txt`, not state, so they port unchanged. The only difference:
`base` and `cleanTree` come from the `claimed` event instead of `.claim.json`. Cases 11, 12, 13, 15, 16
need no change at all.

### F. Board client (fake fetch)

Case 2, retry-forgiveness: a first POST that lands but returns 503, whose retry is rejected 409, still
counts as success, and a 409 on the first attempt is a lost race. This is independent of state and stays
as its own small test. Case 1 is a shell test: a rejected claim appends `released{lost}` and no board write.

## Coverage map

| case | layer | case | layer |
|---|---|---|---|
| 1 | A + F | 9 | B |
| 2 | F | 10 | B |
| 3 | A | 11 | E |
| 4 | B | 12 | E |
| 5 | A + B | 13 | E |
| 6 | B | 14 | B + E |
| 7 | B | 15 | E |
| 8 | A + F | 16 | E |

## Decisions I need from you

1. **Attempts survive restarts.** Today `plannedAttempts` is an in-memory `Map`; after a restart a
   stuck slice gets a fresh budget. With `attempt-failed` events it would not. I think that is the
   right behaviour (a slice that keeps failing should stay blocked), but it is a behaviour change.
2. **First claim wins** locally (rule 5), instead of today's "foreign pid alive → wait 5 s". Same
   outcome, but it makes the log the arbiter. OK to replace the pid-wait loop?
3. **Location**: `.build-kit/events/` (one file per event) and `.build-kit/events.log` (the index), both git-ignored like `progress.pending.txt`. Decided: local only.
4. **No compaction.** A slice produces a handful of events per build; revisit only if the directory ever
   gets large.
