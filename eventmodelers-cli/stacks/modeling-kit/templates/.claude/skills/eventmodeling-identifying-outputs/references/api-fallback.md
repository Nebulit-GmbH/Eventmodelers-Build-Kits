# Identifying Outputs — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 5f — Placing a READMODEL node (full manual sequence)

1. Find the column where the consumer SCREEN or AUTOMATION lives. For an AUTOMATION, the read model's target column is always the one immediately **before** it (skip straight to inserting that column — its interaction row is guaranteed occupied by the automation's own COMMAND). For a SCREEN, target the screen's own column. Fetch the timeline to get the interaction row ID:
   ```bash
   curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
     "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
   # → timelineData.rows — find the row where type === "interaction"
   ```
2. Check if the target interaction cell is already occupied (existing COMMAND):
   ```bash
   curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<interactionRowId>-<columnId>" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
   ```
   If a COMMAND occupies that cell, insert a new column immediately **before** it (`{"index": currentIndex}` — this shifts the consumer's column, and everything after it, one to the right) and use that new column's ID instead. The read model must end up upstream of (to the left of) its consumer, never downstream of it.
3. `cellId = interactionRow.id + "-" + columnId`
4. Create the READMODEL:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '[{
       "id": "<event-uuid>",
       "eventType": "node:created",
       "nodeId": "<node-uuid>",
       "boardId": "<BOARD_ID>",
       "timestamp": 1234567890,
       "chapterId": "<CHAPTER_ID>",
       "cellId": "<interactionRowId>-<columnId>",
       "meta": {"type": "READMODEL", "title": "ActiveReservationView", "fields": [...]}
     }]'
   ```

## Step 5h.1 — Wire EVENT → READMODEL

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<swimlaneRowId>-<columnId>" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs"
```
Connect it:
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
  -H "Content-Type: application/json" \
  -d '{"source":"<eventNodeId>","target":"<readmodelNodeId>"}'
```

## Step 5h.2 — Wire READMODEL → SCREEN

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
  -H "Content-Type: application/json" \
  -d '{"source":"<readmodelNodeId>","target":"<screenNodeId>"}'
```

## Step 5h.3 — Wire READMODEL → AUTOMATION

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
  -H "Content-Type: application/json" \
  -d '{"source":"<readmodelNodeId>","target":"<automationNodeId>"}'
```
