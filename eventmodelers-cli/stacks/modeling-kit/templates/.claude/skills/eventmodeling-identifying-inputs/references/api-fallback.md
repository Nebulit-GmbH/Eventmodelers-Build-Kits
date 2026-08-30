# Identifying Inputs — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Creating a COMMAND node — full manual sequence (Steps A–D)

**Step A — Find the event's column ID.** Query the event node to read its current cell:
```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$EVENT_NODE_ID"
# → node.meta.cellId is "<someRowId>-<columnId>" — extract the columnId part
```

**Step B — Fetch the chapter to find the interaction row ID:**
```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
# → timelineData.rows — find the row where type === "interaction"
```
Save `interactionRow.id`.

**Step C — Compute the cell ID:**
```
cellId = interactionRow.id + "-" + columnId
```

**Step D — Create the command with `cellId`:**

```bash
curl -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: identifying-inputs" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<boardId>",
    "timestamp": 1234567890,
    "chapterId": "<chapterId>",
    "cellId": "<interactionRowId>-<columnId>",
    "meta": {
      "type": "COMMAND",
      "title": "ReserveBike",
      "fields": [
        {"name": "customerId", "type": "String",   "example": "cust-42",             "mapping": "session:customerId"},
        {"name": "bikeId",     "type": "String",   "example": "bike-17",             "mapping": "user-input"},
        {"name": "startTime",  "type": "DateTime", "example": "2026-06-01T09:00:00Z","mapping": "user-input"}
      ]
    }
  }]'
```

## Wire connections — Step 1: SCREEN → COMMAND

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<actorRowId>-<columnId>" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs"
```
If a SCREEN node exists, connect it:
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs" \
  -H "Content-Type: application/json" \
  -d '{"source":"<screenNodeId>","target":"<commandNodeId>"}'
```

## Wire connections — Step 2: COMMAND → EVENT

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<swimlaneRowId>-<columnId>" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs"
```
Connect command to its resulting event:
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs" \
  -H "Content-Type: application/json" \
  -d '{"source":"<commandNodeId>","target":"<eventNodeId>"}'
```
