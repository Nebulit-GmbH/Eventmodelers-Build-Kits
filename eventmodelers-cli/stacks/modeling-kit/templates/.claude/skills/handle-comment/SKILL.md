---
name: handle-comment
description: Place, resolve, or delete a comment on an eventmodelers board node. Action is determined by the first argument: place (default), resolve, or delete.
---

# Handle Comment

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

---

## Step 1 — Parse arguments

From `$ARGUMENTS` or the calling skill's context, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `action` | First word: `place`, `resolve`, or `delete` | `place` |
| `nodeId` | UUID of the target node | **required** |
| `text` | Comment text (place) or substring to match (resolve/delete) | required for `place`; used to look up comment when `commentId` is absent |
| `commentId` | UUID of the comment to resolve/delete | preferred over `text` for resolve/delete |
| `type` | `COMMENT`, `TASK`, or `QUESTION` | `QUESTION` (place only) |
| `author` | Author identifier string | `agent` (place only) |
| `boardId` | Board UUID | from `connect` skill (`BOARD_ID`) |

Route to the matching section below based on `action`.

---

## Action: place

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"<text>","type":"<type>","author":"<author>"}'
```

Response: `201 {"id":"<commentId>"}`

**Batching (when called in bulk, e.g. from `wdyt`):** send one request per comment — there is no batch endpoint for comments. Fire them sequentially, not in a single payload.

**Report:**
```
Comment posted on node <nodeId>
Type: <type> | Author: <author>
"<text>"
```

---

## Action: resolve

**Step A — Resolve comment ID** (skip if `commentId` was provided directly):

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments" \
  -H "Authorization: Bearer $TOKEN"
```

Find the comment whose `text` contains the `text` argument (case-insensitive). If multiple match, list them and ask the user to confirm. If none match, stop: "No comment found matching '<text>' on node `<nodeId>`."

**Step B — Resolve:**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments/$COMMENT_ID/resolve" \
  -H "Authorization: Bearer $TOKEN"
```

**Report:** `Resolved comment <commentId> on node <nodeId>`

---

## Action: delete

**Step A — Resolve comment ID** (same lookup as resolve; skip if `commentId` was provided directly).

**Step B — Confirm before deleting:**
```
About to delete comment on node <nodeId>:
"<comment text>"

Confirm? (yes / no)
```
Wait for an explicit "yes". On any other response, stop: "Deletion cancelled."

**Step C — Delete:**

```bash
curl -s -X DELETE "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments/$COMMENT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

**Report:** `Deleted comment <commentId> from node <nodeId>`