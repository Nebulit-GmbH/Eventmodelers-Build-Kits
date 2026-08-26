---
name: place-element
description: Place a COMMAND, READMODEL, EVENT, SCREEN, AUTOMATION, or SCENARIO spec node onto an existing eventmodelers board timeline at a specific position
---

# Place Element

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

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
| `cellName` | spreadsheet-style cell reference given directly in the prompt — always `<letter(s)><number>`, e.g. `"A2"`, `"AA10"` | none |
| `baseUrl` | explicit URL override | from `connect` skill (`BASE_URL`) |

Normalise `elementType` to uppercase: `event` → `EVENT`, `command` → `COMMAND`, `readmodel` → `READMODEL`, `screen` → `SCREEN`, `automation` → `AUTOMATION`.

Use `BOARD_ID` and `BASE_URL` from the `connect` skill. If a `boardId` argument is explicitly passed, it overrides `BOARD_ID`.

**Fast path — spreadsheet-style cell reference given directly (e.g. "place a COMMAND in A2"):** don't try to interpret what "A2" means yourself. The `node:created` event accepts a `cellName` field (see `learn-eventmodelers-api`) and the backend resolves it to the actual row/column — the same shortcut `html-screen` already uses. Skip Steps 3–6 entirely: resolve only `timelineId` (Step 2, needed for `chapterId`), then go straight to Step 7 and pass `cellName` instead of `cellId` on the `node:created` payload. Do not fetch columns, do not compute a row/column index, and do not construct `cellId` yourself for this case.

**This still applies when several cell references are given together for one slice** (e.g. "put the screen in C1, the command in C2, the event in C3"). Do not reason about the grid at all — not which column "C" is, not whether C1/C2/C3 land in the same column, not which row is which. That is exactly the interpretation this fast path exists to skip. Treat each cell reference as an opaque string tied to its own element: call Step 7 once per element, passing that element's `cellName` untouched. The backend resolves each independently; the placements only need to be internally consistent with each other insofar as the prompt already told you so — you never need to understand *why*.

---

## Prefer MCP — `place_element` (COMMAND / READMODEL / EVENT only)

**When `elementType` is `COMMAND`, `READMODEL`, or `EVENT` and `position` is either omitted or a plain numeric column index** (not `"after <title>"`, not an explicit `cellName`), skip Steps 2–7b entirely and make one call:

```
mcp__eventmodelers__place_element {
  "boardId": "<BOARD_ID>",
  "timelineId": "<TIMELINE_ID>",
  "elementType": "<COMMAND|READMODEL|EVENT>",
  "title": "<title>",
  "columnIndex": <position, if given>
}
```

This tool finds or creates an empty cell in the correct lane and places the node in one call — it collapses the "resolve timeline → fetch columns → determine lane → check occupancy → create node" sequence (Steps 2–3, 4, 6, 7b below) into a single round trip. If `timelineId` is unknown, resolve it first via Step 2's MCP call. Go straight to Step 8 once it returns.

**This does not cover**: `SCREEN`/`AUTOMATION`/`SCENARIO` (see their dedicated steps below), the `"after <title>"` position form, or an explicit `cellName` fast path (Step 1) — `place_element` has no way to express either. For those cases, or when MCP isn't connected, fall through to the manual steps below.

---

## Step 2 — Resolve the timeline

**Prefer MCP:**

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER" }
```

**Fallback (no MCP):**

If `timelineId` is not provided, discover chapters on the board:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

- **Exactly one chapter** → use it automatically, tell the user which one was selected.
- **Multiple chapters** → list them by name/ID and ask the user which to target.
- **No chapters** → stop and tell the user to create a chapter first (e.g. via the `/timeline` skill).

---

## Step 3 — Fetch existing columns and resolve position

Always fetch the chapter node first to get the current timeline state.

**Prefer MCP:**

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<TIMELINE_ID>" }
```

**Fallback (no MCP):**

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

**Prefer MCP:**

```
mcp__eventmodelers__add_scenario {
  "boardId": "<BOARD_ID>",
  "timelineId": "<TL>",
  "columnId": "<COL>",
  "scenarios": [ /* same scenario objects as the curl body below */ ]
}
```

Same rules apply (given=EVENTs only, when=at most one COMMAND or QUERY, then=EVENTs only or exactly one READMODEL, `expectError`+`errorDescription` for error cases). This auto-creates the spec node if the cell is empty, same as the curl endpoint.

**Fallback (no MCP):**

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

Only run this when position was omitted (append mode).

**Prefer MCP:**

```
mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<TIMELINE_ID>" }
```

**Fallback (no MCP):**

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

**Check if the cell is already occupied.**

**No direct MCP equivalent**: `get_nodes` only filters by `type`, not `cellId` — there is no MCP tool that filters nodes by cell. Instead, use the `meta.timelineData.cells` you already fetched in Step 3 via `get_node` on the chapter/timeline node: `cells` is a sparse array, so a `nodeId` absent from the entry for `CELL_ID` means the cell is empty. Only fall back to the curl call below if you haven't already loaded `timelineData` (e.g. MCP wasn't used in Step 3 either):

**Fallback (no MCP):**

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

**Prefer MCP:**

```
mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<TIMELINE_ID>", "index": <currentColumnIndex + 1> }
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TIMELINE_ID/columns" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"index": <currentColumnIndex + 1>}'
```

If no matching row is found, stop and report the error — the timeline may be missing the required lane type.

---

## Step 7 — Create the node

### Step 7a — SCREEN only: create and render in one atomic call

**Only applies when `elementType === "SCREEN"`.** Do not create the node via `/nodes/events` first and render its content onto it in a second call — that leaves a window where the node exists with no image (an empty "Board Image" placeholder if anything interrupts between the two calls). Send a single call that creates the node, places it, and renders it together.

**Default — HTML (`contentType: "html"`, HTML_SCREEN node):** design the page(s) as real HTML/CSS (see the `html-screen` skill's page-design guidance).

**Prefer MCP:**

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "html",
  "nodeId": "<node-uuid>",
  "chapterId": "<TIMELINE_ID>",
  "cellId": "<CELL_ID>",
  "pages": ["<div>...</div>"],
  "description": "<title — what this screen shows>"
}
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/<node-uuid>" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<TIMELINE_ID>",
    "cellId": "<CELL_ID>",
    "pages": ["<div>...</div>"]
  }'
```

**Sketch path (explicit request only) — `contentType: "sketch"`, plain SCREEN node:** only use this when the user explicitly asked for a "sketch"/"wireframe"/"low-fidelity mockup". Design the sketch elements first (same grid language as `storyboard-screen`):

**Prefer MCP:**

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "sketch",
  "nodeId": "<node-uuid>",
  "chapterId": "<TIMELINE_ID>",
  "cellId": "<CELL_ID>",
  "elements": [...],
  "description": "<title — what this screen shows>"
}
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/image-nodes/<node-uuid>/sketch" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<TIMELINE_ID>",
    "cellId": "<CELL_ID>",
    "description": {"elements": [...]},
    "semanticDescription": "<title — what this screen shows>"
  }'
```

Pass whichever cell reference you already resolved — `CELL_ID` from Step 6, or `CELL_NAME` from Step 1's fast path (either path accepts `cellId` or `cellName`). Expect success (MCP: `created: true`; curl: `204`). On failure, read the validation error, fix the payload, and retry once. Then skip the rest of Step 7 and go to Step 8.

### Step 7b — All other element types

Include `x-token`, `x-board-id`, and `x-user-id: agent` on every call to `/nodes/events`.

This step applies to `SCREEN` (view/output conflict case), `AUTOMATION`, `SCENARIO`-adjacent cleanup, and to `COMMAND`/`READMODEL`/`EVENT` whenever the "Prefer MCP — `place_element`" fast path above doesn't apply (explicit `cellName`, `"after <title>"` positioning, or conflict-insertion cases resolved manually in Step 6).

**Normal path** (position/lane resolved manually in Steps 3–6) — use `cellId`:

**Prefer MCP:**

```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "chapterId": "<TIMELINE_ID>",
    "cellId": "<CELL_ID>",
    "meta": { "type": "<ELEMENT_TYPE>", "title": "<title>" },
    "node": { "data": { "title": "<title>" } }
  }]
}
```

**Fallback (no MCP):**

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

**Fast path** (`cellName` given directly, e.g. `"A2"` — see the Step 1 shortcut) — pass `cellName` instead of `cellId` and let the backend resolve it; nothing else in the payload changes:

**Prefer MCP:**

```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "chapterId": "<TIMELINE_ID>",
    "cellName": "<CELL_NAME>",
    "meta": { "type": "<ELEMENT_TYPE>", "title": "<title>" },
    "node": { "data": { "title": "<title>" } }
  }]
}
```

**Fallback (no MCP):**

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
    "cellName": "<CELL_NAME>",
    "meta": {
      "type": "<ELEMENT_TYPE>",
      "title": "<title>"
    },
    "node": { "data": { "title": "<title>" } }
  }]'
```

Response: `{ "hashes": { "<event-uuid>": "<hash>" } }`

> **`node:created` with `cellId`/`cellName` IS the placement** — do NOT also call the `drop` endpoint afterwards. The `drop` endpoint adds a second cell reference without removing the first, causing the node to appear in two columns simultaneously. Use `node:created` with `cellId` or `cellName` for all initial placements.

---

## Step 7c — Verify the command has exactly one issuer

**A command is never issued by more than one thing.** The server's fire-and-forget auto-connect (`learn-eventmodelers-api` §3) already enforces this — it skips wiring the previous column's SCREEN/AUTOMATION into a COMMAND that already has an inbound trigger, whether that trigger came from the COMMAND's own column or from a pre-existing edge in the DB. Still, run this check whenever `elementType` is `SCREEN`, `AUTOMATION`, or `COMMAND` as a sanity check — e.g. a manual `set_connection` call, or an edge created before this guard existed, can still leave a COMMAND with two issuers.

After placing, resolve the relevant COMMAND node (the one just placed, or the one in the same/adjacent column as the SCREEN/AUTOMATION just placed) and inspect its edges:

**Prefer MCP:**
```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<COMMAND_NODE_ID>" }
```

Count inbound edges where `target === COMMAND_NODE_ID` and the source node is type `SCREEN` or `AUTOMATION`.

- **0 or 1 such edge** → fine, nothing to do.
- **2 or more** → keep the edge whose source sits in the COMMAND's own column (the deliberate, same-slice issuer) and remove every other one:

```
mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<extra-issuer-node-id>", "target": "<COMMAND_NODE_ID>", "action": "remove" }
```

If it's not clear which edge is the deliberate one (e.g. neither source sits in the COMMAND's own column), do not guess — leave both edges and post a `QUESTION` comment on the COMMAND node via `handle-comment` instead, describing the ambiguity.

**Fallback (no MCP)**: there is no documented single-purpose REST endpoint for edge removal outside `/nodes/events`. Connect MCP via the `connect` skill first; if that's genuinely not possible, skip the auto-fix and post a `QUESTION` comment on the COMMAND node flagging the double issuer for manual resolution instead of fabricating a payload.

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

**This whole example is the curl fallback.** With MCP connected, the same result is one call: `mcp__eventmodelers__place_element { "boardId": "<BOARD_ID>", "timelineId": "<TIMELINE_ID>", "elementType": "EVENT", "title": "Order Placed" }` (see "Prefer MCP" above).

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
