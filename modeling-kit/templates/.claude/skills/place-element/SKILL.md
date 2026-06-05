---
name: place-element
description: Place a COMMAND, READMODEL, EVENT, SCREEN, AUTOMATION, or SCENARIO spec node onto an existing eventmodelers board timeline at a specific position
---

# Place Element

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

Place a single element — COMMAND, READMODEL, EVENT, SCREEN, AUTOMATION, or SCENARIO spec node — onto an existing timeline on an eventmodelers board. Uses an existing column when a position is given; only creates a new column when appending.
---

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `elementType` | `event`, `command`, `readmodel`, `screen`, or `automation` (case-insensitive) | **required** |
| `title` | the element name, e.g. "Order Placed" | **required** |
| `boardId` | a board UUID | from `connect` skill (`BOARD_ID`) |
| `timelineId` | the chapter/timeline UUID | auto-detect (see Step 2) |
| `position` | column index (0-based number), `"after <title>"`, or omitted | append at end |
| `baseUrl` | explicit URL override | from `connect` skill (`BASE_URL`) |

Normalise `elementType` to uppercase: `event` → `EVENT`, `command` → `COMMAND`, `readmodel` → `READMODEL`, `screen` → `SCREEN`, `automation` → `AUTOMATION`.

Use `BOARD_ID` and `BASE_URL` from the `connect` skill. If a `boardId` argument is explicitly passed, it overrides `BOARD_ID`.

---

## Step 2 — Resolve the timeline

If `timelineId` is not provided, discover chapters on the board:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

- **Exactly one chapter** → use it automatically, tell the user which one was selected.
- **Multiple chapters** → list them by name/ID and ask the user which to target.
- **No chapters** → stop and tell the user to create a chapter first (e.g. via the `/timeline` skill).

---

## Step 3 — Fetch existing columns and resolve position

Always fetch the chapter node first to get the current timeline state:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$TIMELINE_ID"
```

From `meta.timelineData`, read `columns` (ordered array of column objects with `id` and `index`) and `cells`.

Then resolve `position`:

| Input | Behaviour |
|-------|-----------|
| A number (e.g. `2`) | Find the existing column whose `index === 2`. Save its `id` as `columnId`. **Do NOT create a new column.** |
| `"after <title>"` | Cross-reference node titles to find the named column, then target the column at position + 1. If that next column already exists use it; if not, create one at that index. |
| Omitted | No existing column is targeted → create a new column at the end (Step 5). |

If `position` is a number and no column exists at that index, stop and tell the user: "No column at index `<n>` — did you mean to append instead?"

---

## Step 4 — Determine the target lane

| `elementType` | Target lane `type` |
|---------------|--------------------|
| `EVENT`       | `swimlane`         |
| `COMMAND`     | `interaction`      |
| `READMODEL`   | `interaction`      |
| `SCREEN`      | `actor`            |
| `AUTOMATION`  | `actor`            |
| `SCENARIO`    | `spec`             |

---

## Step 4a — SCENARIO only: append scenarios via the spec endpoint

**Only applies when `elementType === "SCENARIO"`.**

The `/scenarios` endpoint creates the SCENARIO spec node automatically if the spec cell is empty, then appends all provided scenarios in one call. Do **not** use `/nodes/events` to create the spec node or write scenarios manually.

After resolving `columnId` (from step 3, or from step 5 if a new column was just created), call:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns/$COL/scenarios" \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '[
    {
      "id": "<scenario-uuid>",
      "title": "Happy path",
      "given": [{"id":"<eventNodeId>","title":"OrderPlaced","type":"EVENT"}],
      "when":  [{"id":"<commandNodeId>","title":"PlaceOrder","type":"COMMAND"}],
      "then":  [{"id":"<eventNodeId2>","title":"OrderConfirmed","type":"EVENT"}]
    },
    {
      "id": "<scenario-uuid>",
      "title": "Insufficient stock",
      "given": [{"id":"<eventNodeId>","title":"OrderPlaced","type":"EVENT"}],
      "when":  [{"id":"<commandNodeId>","title":"PlaceOrder","type":"COMMAND"}],
      "then":  [],
      "expectError": true,
      "errorDescription": "Stock below requested quantity"
    }
  ]'
# → 201 { specNodeId, scenarios (all), added (count), isNewNode }
```

**Scenario object shapes:**

| Scenario type | Shape |
|---|---|
| Happy path | `{ id, title, given[], when[], then[] }` |
| Error case | `{ id, title, given[], when[], then: [], expectError: true, errorDescription: "..." }` |

**Step item format** — each item in `given`, `when`, `then`:
```json
{ "id": "<board-node-uuid>", "title": "OrderPlaced", "type": "EVENT", "fields": [], "specRow": 0 }
```
`id` is required (board node UUID). `title` and `type` are informational.

| Step | Allowed types |
|------|--------------|
| `given` | `EVENT` only |
| `when`  | at most one `COMMAND`; empty when `then` has a READMODEL |
| `then` (happy path) | `EVENT` or `READMODEL` — not mixed |
| `then` (error case) | leave empty, use `expectError: true` |

**Mapping config IDs to board node IDs** — if working from a slice config file, build a lookup first:
```
config_command_id → board COMMAND node ID  (from chapter cells for that column)
config_event_id   → board EVENT node ID    (from chapter cells for that column)
config_rm_id      → board READMODEL node ID
```

Once `/scenarios` returns `201`, proceed directly to **Step 8** — report back to the user.

---

## Step 5 — Create a column only when appending

**Skip this step entirely** when `columnId` was already resolved in Step 3 (i.e. the user targeted an existing column).

Only run this when position was omitted (append mode):

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TIMELINE_ID/columns" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response: `{ "columnId": "<uuid>", "index": <n>, "totalColumns": <n> }`

Save `columnId` from the response.

---

## Step 6 — Compute the target cell ID and check availability

Using the `timelineData` already fetched in Step 3 (re-fetch if a column was just created):

- Find the row in `rows` whose `type` matches the target lane (`swimlane`, `interaction`, or `actor`).
- Compute the cell ID directly: **`CELL_ID = targetRow.id + "-" + columnId`**

Cell IDs are always `<rowId>-<columnId>` — no cell array search needed.

**Check if the cell is already occupied**: query nodes in that cell:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=$CELL_ID"
```

**If the cell is occupied**, the behaviour depends on the element type being placed:

| Element type | Occupant type in same cell | Action |
|---|---|---|
| `READMODEL` | `COMMAND` (state-change slice already owns this column) | Insert a **new column immediately after** the current column (not at the end) and use that new column as the target. |
| `SCREEN` (view/output screen) | any | Same as READMODEL — insert immediately after. |
| Any | Same element type | Stop and tell the user — true conflict, no safe default. |
| Any | Different type but not a known pairing | Stop and tell the user. |

**Insert immediately after** means: create the new column with `index = currentColumnIndex + 1`, not by appending to the end. This keeps the read model visually adjacent to the event that drives it.

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TIMELINE_ID/columns" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"index": <currentColumnIndex + 1>}'
```

If no matching row is found, stop and report the error — the timeline may be missing the required lane type.

---

## Step 7 — Create the node

> **SCREEN nodes always require a sketch.** The server auto-generates a title-only placeholder when a SCREEN is created without one, but it will look empty. Always follow up a SCREEN node creation with a call to `POST /images/:nodeId/sketch` (or use `POST /image-nodes/:nodeId/sketch` to create and render in one call — see `learn-eventmodelers-api` for the sketch format).

Include `x-token`, `x-board-id`, and `x-user-id: agent` on every call to `/nodes/events`:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[{
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "chapterId": "<TIMELINE_ID>",
    "cellId": "<CELL_ID>",
    "meta": {
      "type": "<ELEMENT_TYPE>",
      "title": "<title>"
    },
    "node": { "data": { "title": "<title>" } }
  }]'
```

Response: `{ "hashes": { "<event-uuid>": "<hash>" } }`

> **`node:created` with `cellId` IS the placement** — do NOT also call the `drop` endpoint afterwards. The `drop` endpoint adds a second cell reference without removing the first, causing the node to appear in two columns simultaneously. Use `node:created + cellId` for all initial placements.

---

## Step 8 — Report back

Tell the user:

- **What was placed**: element type and title
- **Where**: column index on the timeline
- **Node ID**: the UUID of the placed element
- **Cell ID**: the cell it was placed into
- **Any errors**: raw API message if something failed

Example success output:
```
Placed: EVENT "Order Placed" at column 3
Node ID: a1b2c3d4-…
Cell ID: e5f6g7h8-…
Timeline: <timelineId>
```

---

## Example — place an EVENT via curl

Full working example placing an EVENT called "Order Placed" at the end of a timeline:

```bash
# 1. Add a column (append at end)
curl -s -X POST "http://localhost:3000/api/org/<ORG_ID>/boards/<BOARD_ID>/timelines/<TIMELINE_ID>/columns" \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Fetch chapter to find the target lane cell for the new column
curl -s -H "x-user-id: place-element-skill" \
  "http://localhost:3000/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<TIMELINE_ID>"

# 3. Create the EVENT node

Do not skip the User-ID. 


curl -s -X POST "http://localhost:3000/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-user-id: place-element-skill" \
  -d '[{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": 1714900000000,
    "chapterId": "<TIMELINE_ID>",
    "cellId": "<CELL_ID>",
    "meta": { "type": "EVENT", "title": "Order Placed" },
    "node": { "id": "<node-uuid>", "data": { "title": "Order Placed" } }
  }]'
```

Replace `<TIMELINE_ID>`, `<BOARD_ID>`, `<CELL_ID>`, `<event-uuid>`, and `<node-uuid>` with real UUIDs. Use `Date.now()` or a current unix-ms timestamp for `timestamp`.
