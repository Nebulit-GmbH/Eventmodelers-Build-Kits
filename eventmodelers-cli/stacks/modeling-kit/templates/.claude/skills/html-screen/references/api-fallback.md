# HTML Screen Designer — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — Load existing pages

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent"
```

## Step 4 — Updating an existing node

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screens/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"pages": ["<div>...</div>", "<div>...</div>"]}'
```

## Step 4 — Creating a new node

```bash
NODE_ID=$(uuidgen)
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"chapterId": "'"$CHAPTER_ID"'", "cellName": "'"$CELL_NAME"'", "pages": ["<div>...</div>"]}'
```

## Step 5 — Define field data lineage

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "HTML_SCREEN", "fields": [
      {"name": "status", "type": "String", "example": "confirmed", "mapping": "ActiveReservationView.status", "cardinality": "Single"}
    ] }
  }]'
```
