---
name: update-slice-status
description: Update the status of a single slice on an eventmodelers board by changing the SLICE_BORDER node's sliceStatus field
---

# Update Slice Status

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

---

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `sliceName` | the slice title to update (case-insensitive match) | **required** |
| `newStatus` | the target status value | **required** |
| `statusReason` | ONE sentence saying why the status changes | optional, but you **should** set it |

Valid status values (case-sensitive):

| Value | Meaning |
|-------|---------|
| `Created` | Default — slice has been created but not started |
| `Ready` | Modeling is done — specified and ready to be planned for implementation |
| `Planned` | Work is planned — queued for the backend build kit |
| `InProgress` | Work is actively in progress |
| `Waiting` | Backend built and its UI contract published (`## UI Contract` in the slice's markdown note) — queued for the UI build kit |
| `Review` | Ready for review |
| `Done` | Completed |
| `Blocked` | Blocked by something |
| `Assigned` | Assigned to someone |
| `Informational` | Informational / reference slice |

If `newStatus` is not one of these exact values, stop and tell the user the valid options.

### Give a reason (optional, but you should)

`statusReason` is optional — a status change works without it — but whenever you change a status you **should** send one: **one sentence**, in plain words, saying *why* the status changes
("Backend built and tested, UI contract published.", "Blocked: the order total rule is unclear.", "Reviewed and approved by Anna.").
It is stored next to `sliceStatus` in the SLICE_BORDER's meta and shown to people as an exclamation-mark icon in the planning view and on the slice header,
so write it for a person who was not watching. Say what happened, not the status name again. For `Blocked`, also post a comment with the details (see `request-feedback`) and let `statusReason` be its short summary. Don't leave an old reason in place when the status changes — send a new one each time.

---

## Step 2 — List all slices

Prefer the MCP tool when `mcp__eventmodelers__*` tools are visible in this session:

```
mcp__eventmodelers__list_slices { "boardId": "<BOARD_ID>" }
```

**Fallback (no MCP):**

```bash
curl -s \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: update-slice-status-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slicedata/slices"
```

Either way, the response is `{ "slices": [{ "id": "<nodeId>", "title": "<title>", "status": "<status>" }] }`. The `id` here is the `SLICE_BORDER` node ID — use it directly in Step 3.

Find the slice whose `title` matches `sliceName` (case-insensitive). If no match is found, stop and list the available slice titles so the user can pick one.

Save the matched slice as:
- `SLICE_NODE_ID` — the node ID of the SLICE_BORDER
- `CURRENT_STATUS` — the current status value

---

## Step 3 — Update the slice status

Prefer the MCP tool — it does the same `node:changed`/`sliceStatus` update in one call, no event envelope to hand-assemble:

```
mcp__eventmodelers__update_slice_status { "boardId": "<BOARD_ID>", "sliceId": "<SLICE_NODE_ID>", "newStatus": "<newStatus>", "statusReason": "<one sentence: why>" }
```

The tool also resolves the slice itself — pass `sliceTitle` (or `columnId`) instead of `sliceId` and the listing step above can be skipped entirely; an ambiguous title comes back with its candidates instead of a guess:

```
mcp__eventmodelers__update_slice_status { "boardId": "<BOARD_ID>", "sliceTitle": "Place Order", "newStatus": "<newStatus>", "statusReason": "<one sentence: why>" }
```

A slice that is being *created* takes its status straight from `create_slice`/`create_slice_definition` (`status`) — don't create it and then call this.

**Fallback (no MCP)** — send a `node:changed` event to update the `sliceStatus` field in the SLICE_BORDER node's meta directly:

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: update-slice-status-skill" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:changed",
    "nodeId": "<SLICE_NODE_ID>",
    "changedAttributes": ["sliceStatus", "statusReason"],
    "meta": {
      "type": "SLICE_BORDER",
      "sliceStatus": "<newStatus>",
      "statusReason": "<one sentence: why>"
    }
  }]'
```

Response: `{ "hashes": { "<eventId>": "<hash>" } }`

### Claiming a slice to build it — use `claim_slice`, not this skill

Setting `InProgress` here is **not** a claim. The API treats a write of the status a slice already has as a silent no-op, so two agents that both read `Planned` and both write `InProgress` both "succeed" and both build the slice. To start work on a slice, claim it:

```
mcp__eventmodelers__claim_slice { "boardId": "<BOARD_ID>", "sliceId": "<SLICE_NODE_ID>" }          # fromStatus defaults to Planned
```

Fallback (no MCP): `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slices/<SLICE_NODE_ID>/claim` with body `{"fromStatus": "Planned"}` and the same headers as above.

If it fails with `409` / `SLICE_ALREADY_CLAIMED`, another agent got there first. This is **not** a broken call: report `ALREADY_IN_STATUS` (see Step 4), do not build the slice, do not retry, and move on to another slice.

---

## Step 4 — Report back

Tell the user:

- **Slice**: the title that was updated
- **Previous status**: `CURRENT_STATUS`
- **New status**: `newStatus`
- **Reason**: `statusReason` (if set)
- **Node ID**: `SLICE_NODE_ID`
- **Outcome**: `SUCCESS`, `ALREADY_IN_STATUS` (another agent got there first — see above), or `ERROR`
- **Any errors**: raw API message if something failed for a reason other than `ALREADY_IN_STATUS`

Example success output:
```
Updated: "Order Placed" slice
  Before: InProgress
  After:  Done
Node ID: a1b2c3d4-…
```