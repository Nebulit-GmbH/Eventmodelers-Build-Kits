---
name: request-feedback
description: Post a comment on a slice and mark it Blocked — ONLY when the slice literally cannot be built, even with reasonable assumptions. The absolute exception; for unclear or missing details, assume and build instead.
---

# Request Feedback

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

---

## When to use this skill — the absolute exception

**The default is to assume and build.** A missing example value, an unclear field type, a status
mapping, a referenced event that isn't modeled yet, a dependency slice that isn't built yet — none of
these is a reason to stop. Pick the most sensible interpretation from `slice.json`, its
`specifications[]` and the surrounding model, build the slice, and record each assumption in one line
in `progress.txt` and as a code comment. **Read `slice.json` fully, and read the build skill's own
instructions and reference docs, before concluding anything is missing.**

Invoke `request-feedback` **only if the slice literally cannot be built**: even with sensible
assumptions, nothing runnable and tested can be produced. For example, the slice has no elements at
all (no command/read model, no fields), or two parts of it contradict each other so that no single
implementation satisfies both.

**Do not use this skill for:**
- Missing examples, field types, names, or status values — assume, build, note the assumption.
- A dependency (event, command, other slice) that isn't implemented yet — assume its definition from
  the model and build against it.
- Implementation-detail choices the build skill's own instructions already answer.
- Style or naming preferences, or "this would be nice to confirm".

A `Blocked` slice must reliably mean "impossible without a human", never "the agent preferred to ask".
When in doubt, build.

**When this skill does apply:** post the question and stop work on this slice for this run — an
impossible build can't be finished by guessing.

---

## Step 1 — Parse arguments

From `$ARGUMENTS` or the calling skill's context, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `sliceName` or `sliceId` | the slice being worked on | **required** — one of the two |
| `question` | the specific ambiguity or missing piece, phrased as a question | **required** |
| `author` | author identifier string | `agent-$CLAUDE_CODE_SESSION_ID` (falls back to `agent` if that env var is unset) |

## Step 2 — Resolve the slice's node id

Prefer MCP:

```
mcp__eventmodelers__list_slices { "boardId": "<BOARD_ID>" }
```

**Fallback (no MCP):**

```bash
curl -s \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: request-feedback-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slicedata/slices"
```

Find the slice whose `title` matches `sliceName` (case-insensitive), or whose `id` matches `sliceId`.
If no match is found, stop and list the available slice titles so the caller can pick one. Save the
matched slice's `id` as `SLICE_NODE_ID` and its current `status` as `CURRENT_STATUS`.

## Step 2.5 — Verify the slice is really empty, and check for duplicate names

"The slice has no elements" is the most common reason to block — and also the easiest to get wrong.
The backend resolves `contextName` to the *first* chapter/context with a matching title, so when two
chapters share a title, `slicedata?contextName=…` (and `slicedata/slices?contextName=…`) can return
nothing for a slice that is fully modeled under the twin. A comment claiming "no elements" then
blocks a healthy slice. Before posting anything:

1. **Fetch the slice by id, not by name.** Resolve the slice's chapter/context id and call
   `get_slice_data { "boardId": "<BOARD_ID>", "contextId": "<id>", "sliceId": "<SLICE_NODE_ID>" }`
   (curl: `GET …/slicedata?contextId=<id>&sliceId=<SLICE_NODE_ID>`). Fetch only this one slice.
2. **Check for duplicate chapter/context titles.** List chapters and MODEL_CONTEXT nodes
   (`get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER", "projection": "line" }`, and likewise
   `MODEL_CONTEXT`). If two or more share the slice's chapter/context title (case-insensitive), retry
   step 1 with each candidate `contextId` before concluding the slice is empty.
3. **Check for duplicate slice names.** From the `list_slices` result, note any other slice with the
   same title (case-insensitive) — in the same or another context — with its id and status.
4. **Decide:**
   - The slice has elements under some candidate id → **do not block, do not comment.** The "empty"
     reading was a lookup artefact; go back and build using the correct `contextId`. Report the
     duplicate-title problem to the caller instead.
   - The slice really is empty (or contradictory) under every candidate → continue to Step 3, and
     **name every duplicate you found in the question**, e.g. `Note: 2 timelines are titled "Teams"
     (d151f017-…, e985e6b3-…) and a slice "Add Team" also exists in <context> (<id>, <status>) — please
     check the content isn't under the twin.` so the human can tell a genuinely empty slice from a
     misplaced one.
   - Duplicates exist but the cause of the block is unrelated (e.g. a contradiction between two
     specs): still mention them in the report (Step 5), not necessarily in the comment.

---

## Step 3 — Post the comment

There is no separate `QUESTION` type at the API level — post a normal `COMMENT` worded as a question.

Prefer MCP:

```
mcp__eventmodelers__add_comment { "boardId": "<BOARD_ID>", "nodeId": "<SLICE_NODE_ID>", "text": "<question>", "type": "COMMENT", "author": "<author>" }
```

**Fallback (no MCP):**

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<SLICE_NODE_ID>/comments" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text":"<question>","type":"COMMENT","author":"<author>"}'
```

Response: `201 {"id":"<commentId>"}`. Save it as `COMMENT_ID` — the calling skill may want to reference
it later once the question is answered.

Write `<question>` so a human reading it cold understands the gap without re-reading the slice
themselves: name the slice, name the specific field/rule/scenario in question, and say what's missing
or contradictory — not just "please clarify this slice."

## Step 4 — Mark the slice Blocked

Prefer MCP:

```
mcp__eventmodelers__update_slice_status { "boardId": "<BOARD_ID>", "sliceId": "<SLICE_NODE_ID>", "newStatus": "Blocked" }
```

Also mark the slice 'blocked' locally in the index.json if possible.

**Fallback (no MCP)** — send a `node:changed` event to update the `sliceStatus` field in the
SLICE_BORDER node's meta directly:

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: request-feedback-skill" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:changed",
    "nodeId": "<SLICE_NODE_ID>",
    "changedAttributes": ["sliceStatus"],
    "meta": {
      "type": "SLICE_BORDER",
      "sliceStatus": "Blocked"
    }
  }]'
```

If `CURRENT_STATUS` was already `Blocked`, this step is a no-op — don't treat that as an error, and
don't retry. It just means someone (possibly this same agent, on an earlier prompt) already flagged it.

## Step 5 — Stop and report

Do not continue implementing the slice after this. Report back to whoever invoked this skill:

```
Requested feedback on slice "<sliceName>" (<SLICE_NODE_ID>)
Question posted: "<question>"
Status: <CURRENT_STATUS> → Blocked
Duplicates: <none | duplicate chapter titles "<title>" (<ids>) | same-titled slices "<title>" (<id> <status>, …)>
```

Then stop work on this slice for this run. If the caller has other, unrelated slices queued, it may
move on to those — but this specific slice stays untouched until the question is answered and the
slice is moved out of `Blocked`.
