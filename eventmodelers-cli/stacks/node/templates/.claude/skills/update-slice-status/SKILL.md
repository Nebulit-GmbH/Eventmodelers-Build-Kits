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

Valid status values (case-sensitive):

| Value | Meaning |
|-------|---------|
| `Created` | Default — slice has been created but not started |
| `Planned` | Work is planned |
| `InProgress` | Work is actively in progress |
| `Review` | Ready for review |
| `Done` | Completed |
| `Blocked` | Blocked by something |
| `Assigned` | Assigned to someone |
| `Informational` | Informational / reference slice |

If `newStatus` is not one of these exact values, stop and tell the user the valid options.

---

## Step 2 — List all slices

Fetch all slices on the board:

```bash
curl -s \
  -H "x-token: <TOKEN>" \
  -H "x-board-id: <BOARD_ID>" \
  -H "x-user-id: update-slice-status-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slicedata/slices"
```

Response: `{ "slices": [{ "id": "<nodeId>", "title": "<title>", "status": "<status>" }] }`

The `id` here is the `SLICE_BORDER` node ID — use it directly in Step 3.

Find the slice whose `title` matches `sliceName` (case-insensitive). If no match is found, stop and list the available slice titles so the user can pick one.

Save the matched slice as:
- `SLICE_NODE_ID` — the node ID of the SLICE_BORDER
- `CURRENT_STATUS` — the current status value

---

## Step 3 — Update the slice status

Send a `node:changed` event to update the `sliceStatus` field in the SLICE_BORDER node's meta:

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: <TOKEN>" \
  -H "x-board-id: <BOARD_ID>" \
  -H "x-user-id: update-slice-status-skill" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:changed",
    "nodeId": "<SLICE_NODE_ID>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "changedAttributes": ["sliceStatus"],
    "meta": {
      "sliceStatus": "<newStatus>"
    }
  }]'
```

Response: `{ "hashes": { "<eventId>": "<hash>" } }`

### If the API rejects the update because the slice is already in `newStatus`

The API refuses to move a slice into a status it is already in — this is a deliberate concurrency guard so two agents racing to claim the same slice can't both succeed. If Step 3 fails with an error indicating the slice is already at `<newStatus>` (e.g. a `409`, or an error body mentioning "already"), this is **not a failure to surface as broken** — it means another agent already claimed or moved the slice first. Report this as a distinct `ALREADY_IN_STATUS` outcome (see Step 4) rather than a generic error, and do not retry the same update. Callers trying to claim a `Planned` slice for building should treat this as a signal to pick a different slice, not to stop.

---

## Step 4 — Report back

Tell the user:

- **Slice**: the title that was updated
- **Previous status**: `CURRENT_STATUS`
- **New status**: `newStatus`
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