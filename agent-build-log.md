# Agent build log — a live view of what a build agent is doing

**Off by default** — `eventmodelers run --sync` turns it on for that run. Build agents only: with
`--modeling` / `--standalone` it does nothing, and with `--local` there is no board to share with.

## Two capabilities (`shared/build-kit/lib/build-log-share.js`)

| | |
|---|---|
| **iterations** (always, build loop) | every slice build turn appends `iteration-started` and `iteration-closed` to the local event log (and `slice-done` when the turn settled the slice as Done), each carrying `slice`, `iteration` (an id), `kitType`, `boardId`, `organizationId` and the date |
| **sync** (`--sync`) | the log's events that name a slice are POSTed to the platform, on a 2 s interval for as long as the loop runs and once more at the start and end of each iteration |

`kitType` is `ui` for a kit that picks slices up from `Waiting` (the react kits), else `backend`.
Events without a slice (a learning, say) are never sent. A cursor in `.build-kit/build-log-sync.json`
(git-ignored) only moves forward when an upload succeeded; a failed one is sent again with the next. No queue.

## Platform side

```
POST /api/org/:orgId/boards/:boardId/buildlog {events: [{id, type, sliceId, agentId, seq, kitType, iteration, occurredAt, …}]}
     → {recorded, discarded}
     400  an event without sliceId, type, a uuid agentId, an integer seq, a valid kitType (backend | ui) or occurredAt — whole batch rejected
     403  no access to the org and board, or the agent is not a connected BUILD agent (heartbeat within 45s)
```

Table `agent_build_log` (org, board, slice, kit type, agent, iteration, type, time, payload). Org members may
read it (RLS); only the backend writes it.

- **`sliceId` is required**: an entry without one rejects the whole batch (400).
- **One iteration per slice and kit type**: every `iteration-started` resets that slice's log for its kit type —
  the backend log and the ui log of one slice live side by side.
- **A reopened slice starts over.** After an iteration that settled the slice as Done, the loop sends `slice-done`.
  If that is the slice's newest entry (by `seq`, across kit types) when an `iteration-started` arrives, the whole
  slice's log is reset, every kit type. The log decides by itself: no status is watched on the platform.
- At most **1000 entries** per slice and kit type; later ones are discarded.
- `seq` — the agent's own sequence number, stamped on **every** local event (`slice-events.js`, remembered in
  `.build-kit/events.seq` so it never goes back, even after a prune) — defines the order. The server only sorts
  by it; **uniqueness is not enforced**.
- A duplicate event id is ignored, so a batch can be re-sent.
