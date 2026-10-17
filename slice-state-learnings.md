# Local slice state — what we learned the hard way

Source: `eventmodelers-cli/test/slice-claim.test.js` on branch `wip/claim-record` (commit `1da02da`), the
first attempt at making the run loop own slice status. That attempt kept state in mutable files
(`.claim.json`, `index.json`, `slice.json`). It is parked; the next attempt keeps local state as an
append-only event log and derives everything else from it. These are the cases any design has to
satisfy — port each one as an acceptance test of the new fold.

## Who owns what

- The **loop** owns slice status. It claims a slice (`InProgress`) before the build and pushes the agent's
  recorded outcome afterwards. An agent that edits status itself (e.g. finds the slice "already built")
  gets its local status reverted by the next board refresh and the slice loops until auto-blocked.
- The **kit dir** (`.build-kit`: slices, learnings, claim record), `.eventmodelers` and `progress.txt`
  belong to the loop and the agent's bookkeeping. They are outside every working-tree check and every discard.

## Claiming

1. A claim that the board **rejects** is lost: no build, no claim record left behind, no board write.
2. A claim whose first POST **landed but lost its response** (503) is still won: the retry is rejected by
   the same-status guard (409 `ALREADY_IN_STATUS`), and that 4xx is forgiven **only on a retry**. A 4xx on
   the first attempt is a genuine lost race.
3. A won claim is recorded as confirmed. Confirmation rests on the accepted write alone — a board re-read
   that returns no slice data must not undo it.
4. An **unconfirmed** claim never touches the board when released: the slice may belong to the agent
   that won the race.

## Settling after the build

5. Agent outcome `Done` → push `Done` to the board.
6. Unfinished slice (still `InProgress` locally) → back to `Planned`, locally **and** on the board, and
   the half-done working tree is discarded.
7. If someone else already moved the slice off `InProgress` on the board (e.g. `Blocked`), write nothing —
   don't override them.
8. If the board rejects the settle write, report failure so the claim is **kept** and retried next
   iteration. Never clear a claim whose outcome isn't on the board.

## Crash recovery

9. A claim left by a **dead process** (pid gone) is released at the next loop iteration:
   confirmed → `Planned` on the board; unconfirmed → no board write. Either way the claim is dropped.
10. A claim held by **another live process** is left alone (pid alive, including EPERM = exists but not ours).

## Discarding a failed attempt

11. Remove the build's uncommitted changes and untracked files, but keep the kit dir and `progress.txt`.
12. Undo the **whole** attempt, not just the tree: record the git base (branch + commit) once, on the
    first write of a claim; on failure restore that branch, delete the feature branch the attempt
    created, and reset to the base.
13. Leave the **staging** of kit files and `progress.txt` alone (don't `git reset` them away).
14. If the tree was **already dirty at claim time**, a person's edits are in it — discard nothing.
    Only a clean-tree claim lets "uncommitted changes" mean "the build's debris".
15. Kit-dir changes never make the tree dirty.
16. A discard leaves a trace in `progress.txt`: slice title, the branch deleted, why (failed/timed out),
    the agent's last reply, and the files that were reverted.

## Non-state mechanics worth keeping

- **Atomic writes**: write to `<path>.<pid>.tmp` then rename. A reader that hits a mid-write truncate
  gets `Unexpected end of JSON input`.
- **Transient vs real failures** when writing to the board: retry network/429/5xx until they go
  through; a 4xx is a real rejection and surfaces to the caller.
- A **cleared ticket** must be cleared locally too. The board summary omits `ticketNumber` when the
  slice has none, so a merge-on-refresh keeps the old one unless it is set to `null` explicitly.

## Separate feature, already extracted

`stageLearnings` / `finishLearnings` / `ensureLearningsGitRules` (progress.txt → `AGENTS.md`) are not
slice state. They were tangled into the same branch and now live on `main` (commit `0702e77`, tests in
`eventmodelers-cli/test/learnings.test.js`). `wip/claim-record` still contains its own copy — ignore it.
