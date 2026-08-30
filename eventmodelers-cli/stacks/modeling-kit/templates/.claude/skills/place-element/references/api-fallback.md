# Place Element — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — Discover chapters

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

## Step 3 — Fetch the chapter node (columns + cells)

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$TIMELINE_ID"
```

## Step 4a — SCENARIO: append scenarios via the spec endpoint

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

## Step 5 — Create a column when appending

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TIMELINE_ID/columns" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response: `{ "columnId": "<uuid>", "index": <n>, "totalColumns": <n> }`

## Step 6 — Check cell occupancy

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=$CELL_ID"
```

## Step 6 — Insert a column at a specific index (conflict resolution)

No relative-insertion equivalent over REST (unlike MCP's `afterNodeId`) — compute the index by hand:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TIMELINE_ID/columns" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"index": <currentColumnIndex + 1>}'
```

## Step 6a — Link a node to an origin on a different timeline

`POST .../nodes/:nodeId/link` with `{ "targetNodeId": "<newly-placed-node-id>" }` — see `learn-eventmodelers-api` §3.

## Step 7a — SCREEN: create and render (HTML path)

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

## Step 7a — SCREEN: create and render (sketch path, explicit request only)

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

## Step 7b — Create any other node type (normal path, `cellId`)

Include `x-token`, `x-board-id`, and `x-user-id: agent` on every call to `/nodes/events`.

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

## Step 7b — Create any other node type (fast path, `cellName`)

Same as above, but `cellName` replaces `cellId` — nothing else in the payload changes:

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

## Full worked example — place an EVENT via curl, start to finish

With MCP connected, the same result is one call: `mcp__eventmodelers__place_element { "boardId": "<BOARD_ID>", "timelineId": "<TIMELINE_ID>", "elementType": "EVENT", "title": "Order Placed" }`.

Placing an EVENT called "Order Placed" at the end of a timeline, over curl:

```bash
# 1. Add a column (append at end)
curl -s -X POST "http://localhost:3000/api/org/<ORG_ID>/boards/<BOARD_ID>/timelines/<TIMELINE_ID>/columns" \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Fetch chapter to find the target lane cell for the new column
curl -s -H "x-user-id: place-element-skill" \
  "http://localhost:3000/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<TIMELINE_ID>"

# 3. Create the EVENT node — do not skip the x-user-id header
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
