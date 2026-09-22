# Orchestrating Event Modeling — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## No unplaced elements (0,0 nodes) — Scan for unplaced nodes

```bash
for TYPE in EVENT COMMAND READMODEL SCREEN AUTOMATION; do
  curl -s -H "x-token: $TOKEN" \
    "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=$TYPE"
done
```

## No unplaced elements (0,0 nodes) — Place a found unplaced node

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-user-id: orchestrator" \
  -H "Content-Type: application/json" \
  -d '[{"id":"<event-uuid>","eventType":"node:changed","nodeId":"<nodeId>",
        "chapterId":"<chapterId>","cellId":"<rowId>-<colId>",
        "meta":{"type":"<TYPE>","title":"<title>"}}]'
```

## No unplaced elements (0,0 nodes) — Delete an orphaned node

```bash
curl -s -X DELETE "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/<nodeId>" \
  -H "x-token: $TOKEN"
```

## Step 11 — Document Reasoning — Add a feedback lane

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/lanes" \
  -H "x-token: $TOKEN" -H "x-user-id: orchestrator" \
  -H "Content-Type: application/json" \
  -d '{"type":"feedback","label":"Notes"}'
# → { laneId, type, label, index, totalLanes }
```

## Step 11 — Document Reasoning — Create the MARKDOWN node

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-user-id: orchestrator" \
  -H "Content-Type: application/json" \
  -d '[{"id":"<event-uuid>","eventType":"node:created","nodeId":"<node-uuid>",
        "chapterId":"<CHAPTER_ID>","cellId":"<feedbackLaneId>-<firstColumnId>",
        "meta":{"type":"MARKDOWN","title":"Modeling Reasoning — <Chapter Name>","description":"<full markdown body>"}}]'
```
