---
name: local-prototype-control
description: Work through what the person asked for in the prototype player — the requests saved feedback, Sync, Fetch and Rebuild recorded in the control event log (.prototype/events/) — as a multi-stage update, and record what was processed. Use for "work through the requests", "what did I ask for in the prototype", "sync", "rebuild", or at the start of any run in a prototype folder.
---

# Prototype control — the player's buttons, as events

The prototype player does not run anything: a button records an event, and the agent applies it. Same event store as the build kits (`.prototype/events/`, `.prototype/events.log`), append-only; **changes** (what feedback was translated into) are next to it in `.prototype/changes/`, in one global order with the events. What was processed is in the log too — a request is open until a `ControlProcessed` refers to it, so you can stop and come back and never do one twice.

| Player button | Event | What you do |
|---|---|---|
| Save (a feedback comment) | `FeedbackRecorded` | **translate** it into executable changes — `local-apply-feedback`; then **execute** them (`changes run`) and rebuild |
| Sync | `SyncRequested` | write everything back to the board: the applied changes in order, then the rest — `{{CLI}} prototype sync` after `{{CLI}} prototype changes submit` |
| Answer (in the question modal) | `FeedbackAnswered` | **translate** the answers into changes — `local-apply-feedback`, with the id of this event; then execute them and rebuild |
| Discard (in the question modal) | `FeedbackDiscarded` | nothing — already done: the feedback's pending change files were removed |
| Fetch | `FetchRequested` | bring the board's latest slice definitions in: `{{CLI}} prototype fetch --context "<name>"` — it refuses while there are unsynced local edits (say so, sync first, never force); then rebuild what became stale |
| Rebuild | `RebuildRequested` | `local-prototype-build` — `{{CLI}} prototype status` says what is stale |

## Steps — one iteration is the whole update

1. **Read the open requests**, oldest first:
   ```bash
   {{CLI}} prototype events --pending
   ```
   When the request names event ids, work only on those. None open and no pending changes (`{{CLI}} prototype changes --pending`): say so and stop.
2. **Take the requests in order.** Claim, do, record:
   ```bash
   {{CLI}} prototype events claim <id>
   … the work …
   {{CLI}} prototype events processed <id> --outcome applied|needs-you|failed --note "<what was done, or what you need>"
   ```
   - **`FeedbackRecorded`** and **`FeedbackAnswered`** — invoke `local-apply-feedback`: it records the changes and `changes translated`, which makes the request follow its changes (it is processed by itself when they are all executed — do not record it processed).
   - **`SyncRequested`** — the person wants it written. `{{CLI}} prototype sync --dry-run` lists what it will do — the pending changes first, in order, then the rest — and `{{CLI}} prototype sync --yes` does it (each change as its node:changed event or recorded tool call). Conflicts and "not synced" items are reported, never forced. Several open `SyncRequested` are one sync: process them all with that outcome.
   - **`FetchRequested`** — `{{CLI}} prototype fetch --context "<name>"` (the context is in `.prototype/state.json`). It refuses while the local model has edits that are not synced yet: then record `needs-you` with "Sync first" — never `--force`. After it, build what became stale (below).
   - **`RebuildRequested`** — the local slices are the truth: `{{CLI}} prototype status` says what is new or changed (a screen edited in `.prototype/screens/` counts), `local-prototype-build` builds those (patching the previous block), then `{{CLI}} prototype assemble`. Several open ones are one rebuild.
3. **Execute the pending changes, in the same iteration**, one by one in global order — no agent needed:
   ```bash
   {{CLI}} prototype changes run            # applied to the local model
   {{CLI}} prototype changes run --board    # …and written to the board: the node:changed events, the recorded tool calls
   ```
   Use `--board` when the person pressed Sync, or this is an unattended `--sync` run; otherwise **the changes stay local** — applied to the model, recorded in `.prototype/changes/` — until `prototype sync` executes them against the board. A tool call waits for `--board` (the order is kept). A failed change is recorded failed and the rest go on; the feedback ends `needs-you` with what failed. After tool calls ran, the board changed, not the local model: `{{CLI}} prototype fetch --context "<name>"` (it refuses while there are unsynced local edits — sync first) brings it in.
3b. **New slices need a screen design.** After tool calls created slices, `{{CLI}} prototype fetch` brings them in; a slice whose screen is still "Untitled screen — design pending" (an HTML_SCREEN with no pages) gets its screen designed locally — `local-prototype-model` with the `html-screen` skill, in the look of the existing screens, from the fields of the slice — and reaches the board with the next sync, as the screen's pages.
4. **Rebuild what changed** — `{{CLI}} prototype status`, then `local-prototype-build` for the new and changed slices (patching the previous block), then `{{CLI}} prototype assemble`.
5. **Order matters.** Process in `seq` order; feedback is translated, executed and rebuilt before a later Sync writes it back.
6. **Report** one line per request and per change: what it was, the outcome, anything that needs the person. The player shows the outcome next to the button.

Never edit `.prototype/events/`, `events.log` or `.prototype/changes/` by hand. Never record `processed` for a request you did not do.
