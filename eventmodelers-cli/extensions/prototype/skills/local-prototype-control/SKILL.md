---
name: local-prototype-control
description: Work through what the person asked for in the prototype player — the Sync, Fetch and Rebuild requests recorded in the control event log (.prototype/events/) — and record what was processed. Use for "work through the requests", "what did I ask for in the prototype", "sync", "rebuild", or at the start of any run in a prototype folder.
---

# Prototype control — the player's buttons, as events

The prototype player does not run anything: a button records an event, and the agent applies it. Same event store as the build kits (`.prototype/events/`, `.prototype/events.log`), append-only. What was processed is in the log too — a request is open until a `ControlProcessed` refers to it, so you can stop and come back and never do one twice.

| Player button | Event | What you do |
|---|---|---|
| Sync | `SyncRequested` | write the local model's differences back to the board — `{{CLI}} prototype sync` |
| Fetch | `FetchRequested` | bring the board's latest slice definitions in: `{{CLI}} prototype fetch --context "<name>"` — it refuses while there are unsynced local edits (say so, sync first, never force); then rebuild what became stale |
| Rebuild | `RebuildRequested` | `local-prototype-build` — `{{CLI}} prototype status` says what is stale |

**Feedback is not a request here.** It is collected in the player and *Submit*ted to the platform; the platform's `/apply-feedback` applies it to the model. To see what it changed, fetch the model again (`FetchRequested`, or `{{CLI}} prototype fetch`) and rebuild.

## Steps

1. **Read the open requests**, oldest first:
   ```bash
   {{CLI}} prototype events --pending
   ```
   When the request names event ids, work only on those. None open: say so and stop.
2. **Take the requests in order.** Claim, do, record:
   ```bash
   {{CLI}} prototype events claim <id>
   … the work …
   {{CLI}} prototype events processed <id> --outcome applied|needs-you|failed --note "<what was done, or what you need>"
   ```
   - **`SyncRequested`** — the person wants it written. `{{CLI}} prototype sync --dry-run` lists what it will do and `{{CLI}} prototype sync --yes` does it. Conflicts and "not synced" items are reported, never forced. Several open `SyncRequested` are one sync: process them all with that outcome.
   - **`FetchRequested`** — `{{CLI}} prototype fetch --context "<name>"` (the context is in `.prototype/state.json`). It refuses while the local model has edits that are not synced yet: then record `needs-you` with "Sync first" — never `--force`. After it, build what became stale (below).
   - **`RebuildRequested`** — the local slices are the truth: `{{CLI}} prototype status` says what is new or changed (a screen edited in `.prototype/screens/` counts), `local-prototype-build` builds those (patching the previous block), then `{{CLI}} prototype assemble`. Several open ones are one rebuild.
3. **Rebuild what changed** — `{{CLI}} prototype status`, then `local-prototype-build` for the new and changed slices (patching the previous block), then `{{CLI}} prototype assemble`.
4. **Order matters.** Process in `seq` order; a Fetch is rebuilt before a later Sync writes anything back.
5. **Report** one line per request: what it was, the outcome, anything that needs the person. The player shows the outcome next to the button.

Never edit `.prototype/events/` or `events.log` by hand. Never record `processed` for a request you did not do.
