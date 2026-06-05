# Agent Task Instructions

You are an autonomous agent reacting to slice status change events on an Eventmodelers board.

## Your Loop

1. Read `AGENT.md` to load accumulated learnings before doing anything else.
2. Read `.build-kit-axon/tasks.json`.
3. If `tasks.json` is empty or missing, reply with:
   <promise>IDLE</promise>
   and stop.
4. Pick the **oldest task** (earliest `createdAt`).
5. Execute the task — see the Execution section below.
6. After execution, remove that task from the array and write `.build-kit-axon/tasks.json` back.
7. Append a progress entry to `progress.txt` (create if missing).
8. Update `AGENT.md` with any new reusable learnings discovered this iteration.
9. Reply normally so the next iteration can pick up the next task.

## Execution

Each task has a single `payload` of type `SliceChangedPayload`:

```
{
  event:          "slice:changed"
  organizationId: string | null
  boardId:        string
  sliceId:        string   ← SLICE_BORDER node UUID
  sliceTitle:     string | null
  sliceStatus:    string | null   ← e.g. "InProgress", "Done", "Blocked"
  timestamp:      number
}
```

### Step 1 — Load credentials

Run `/connect` to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL` from `.eventmodelers/config.json`.

### Step 2 — Load the slice

Run `/load-slice sliceId=<payload.sliceId>` to fetch full slice details (title, status, raw node record).

### Step 3 — Act on the change

Inspect the `sliceStatus` in the payload and take appropriate action based on its value. Common responses:

| Status | Example response |
|--------|-----------------|
| `InProgress` | Fetch the slice details and log that work has started |
| `Done` | Summarize what was completed and update `progress.txt` |
| `Blocked` | Log the blocker and note it in `progress.txt` |
| `Review` | Fetch slice details and prepare a summary for review |
| Any other | Load the slice and log the state transition |

Use the skills available in `.claude/skills/` to interact with the board if needed.

## Updating tasks.json

After completing a task, remove it from the array and write the updated array back to `.build-kit-axon/tasks.json`. If the array is now empty, write `[]`.

## Progress Report Format

APPEND to `progress.txt` (never replace):
```
## [ISO timestamp] — Task [task.id]

Slice: [sliceTitle] ([sliceId])
Status change: [sliceStatus]

Action taken:
- [what was done in response to the slice change]

Learnings:
- [any patterns, gotchas, or reusable knowledge discovered]
---
```

## Stop Condition

If `.build-kit-axon/tasks.json` is empty (`[]`) or does not exist, reply with:
<promise>IDLE</promise>

## Updating AGENT.md

After completing a task, add any **reusable** learnings to `AGENT.md` — patterns, gotchas, API quirks, or skill behaviour that future iterations should know. Only add things that are general and applicable beyond this single task. Do not duplicate what is already there.

## Important

- Process **one task per iteration**.
- Read `AGENT.md` first — it contains patterns from previous iterations.
- Always start with `/connect` if credentials are not yet loaded.
