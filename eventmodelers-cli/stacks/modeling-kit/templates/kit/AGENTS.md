# Learnings

Reusable learnings accumulated while processing prompts for this board. Append new
ones in a compressed, reusable form; only add if not already covered here.

- `/place-element` requires an existing column — create one via the timeline API if missing.
- `/wdyt` posts QUESTION comments onto nodes — use for analysis only, not modifications.
- The `board_id`, `timeline_id`, and `organization_id` from each prompt provide full context — pass them to skills that need them.
- Node events POST to `/api/boards/:boardId/nodes/events` using `node:created`, `node:changed`, `node:deleted`.
- `/update-slice-status` rejects moving a slice into a status it's already in — this is a concurrency guard so two agents can't both claim the same slice. Treat this as `ALREADY_IN_STATUS`, not a task failure: drop the prompt, move on to the next task, and do not retry the same update.
- macOS/BSD `date` silently ignores GNU-only format specifiers like `%N`/`%3N` (sub-second precision) instead of erroring — it prints the literal characters, producing a malformed timestamp that only fails downstream. Don't shell out to `date` for sub-second precision; use `$(( $(date +%s) * 1000 ))` for whole-second-in-ms, or a runtime call (`Date.now()`, `process.hrtime()`) instead.
- Before retrying a failed shell command a second time, diagnose why it failed (e.g. a GNU/BSD flag mismatch) rather than re-running it unchanged — repeating the same command produces the same failure and just burns retries.