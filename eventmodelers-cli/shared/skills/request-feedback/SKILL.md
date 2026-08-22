---
name: request-feedback
description: Post a QUESTION comment on a slice and mark it Blocked when the slice's requirements are genuinely ambiguous, contradictory, or missing something a decision depends on. This is an escalation path, not a routine step — reach for it only when you cannot proceed without guessing.
---

# Request Feedback

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

---

## When to use this skill — the exception, not the rule

Building a slice is normally unambiguous: `slice.json` names every command field, event field, and
GWT scenario, and the matching build skill (`build-state-change`, `build-state-view`,
`build-automation`, ...) tells you exactly how to turn that into code. **Read `slice.json` fully, and
read the build skill's own instructions and reference docs, before ever concluding something is
missing.** Most slices need none of this.

Only invoke `request-feedback` when, after that reading, a decision the implementation depends on
still cannot be made without guessing — for example:

- A business rule mentioned in `description`/`comments`/`notes` isn't backed by any field, event, or
  `specifications[]` scenario, so there's no way to encode it.
- Two fields, or a field and an `idAttribute` flag, contradict each other about what the slice is
  supposed to do.
- A `specifications[]` scenario references a prior event or state that no command/event in this slice
  (or its declared dependencies) actually produces.
- The slice depends on another slice, screen, or read model that doesn't exist yet and it's unclear
  whether one should be created, or the dependency was meant to point elsewhere.

**Do not use this skill for:**
- Implementation-detail choices the build skill's own instructions already answer (e.g. package
  naming, file layout, which annotation to use) — those aren't ambiguity in the slice, they're just
  reading the skill more carefully.
- Style or naming preferences with no functional consequence — pick the reasonable option and move on.
- "This would be nice to confirm" — if you *can* proceed correctly from what `slice.json` says, proceed.

When in doubt, prefer finishing the slice over escalating. Escalating on every minor uncertainty
defeats the purpose — it should be rare enough that a `Blocked` slice reliably means "a human needs to
look at this," not "the agent didn't feel like deciding."

**When this skill does apply: do not guess and build anyway.** Post the question and stop work on this
slice for this run — do not implement your best interpretation first. A wrong guess encoded into
working, tested, committed code is harder to catch and undo than an unbuilt slice waiting for an
answer.

---

## Step 1 — Parse arguments

From `$ARGUMENTS` or the calling skill's context, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `sliceName` or `sliceId` | the slice being worked on | **required** — one of the two |
| `question` | the specific ambiguity or missing piece, phrased as a question | **required** |
| `author` | author identifier string | `agent` |

## Step 2 — Resolve the slice's node id

Prefer MCP:

```
mcp__eventmodelers__list_slices { "boardId": "<BOARD_ID>" }
```

**Fallback (no MCP):**

```bash
curl -s \
  -H "x-token: <TOKEN>" \
  -H "x-board-id: <BOARD_ID>" \
  -H "x-user-id: request-feedback-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slicedata/slices"
```

Find the slice whose `title` matches `sliceName` (case-insensitive), or whose `id` matches `sliceId`.
If no match is found, stop and list the available slice titles so the caller can pick one. Save the
matched slice's `id` as `SLICE_NODE_ID` and its current `status` as `CURRENT_STATUS`.

## Step 3 — Post the QUESTION comment

Prefer MCP:

```
mcp__eventmodelers__add_comment { "boardId": "<BOARD_ID>", "nodeId": "<SLICE_NODE_ID>", "text": "<question>", "type": "QUESTION", "author": "<author>" }
```

**Fallback (no MCP):**

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<SLICE_NODE_ID>/comments" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text":"<question>","type":"QUESTION","author":"<author>"}'
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
  -H "x-board-id: <BOARD_ID>" \
  -H "x-user-id: request-feedback-skill" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:changed",
    "nodeId": "<SLICE_NODE_ID>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "changedAttributes": ["sliceStatus"],
    "meta": {
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
```

Then stop work on this slice for this run. If the caller has other, unrelated slices queued, it may
move on to those — but this specific slice stays untouched until the question is answered and the
slice is moved out of `Blocked`.
