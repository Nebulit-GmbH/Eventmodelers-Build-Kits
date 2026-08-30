# Timeline — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Fetch all chapters (Steps 1a, 1b)

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

## Fetch the chapter's grid state (Steps 1b, 3c)

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

Read `meta.timelineData` for `{rows, columns, cells}`.

## Fetch all EVENT nodes (Step 1b)

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT"
```

## Create a new chapter (Step 1c)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":0,"y":0}}'
```

Extract `id` from the response → `CHAPTER_ID`.

## Delete a column (Steps 3c, 4c)

```bash
curl -s -X DELETE "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns/<columnId>"
```

## Create an EVENT node in a reused empty column (Step 4a)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-user-id: timeline-skill" \
  -d '[{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<CELL_ID>",
    "meta": { "type": "EVENT", "title": "<EventName>" },
    "node": { "id": "<node-uuid>", "data": { "title": "<EventName>" } }
  }]'
```

## Rename an event (Step 4b)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-user-id: timeline-skill" \
  -d '[{
    "id": "<new-uuid>",
    "eventType": "node:changed",
    "nodeId": "<eventNodeId>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>,
    "changedAttributes": ["meta.title"],
    "meta": { "type": "EVENT", "title": "<NewTitle>" },
    "node": { "id": "<eventNodeId>", "data": {} }
  }]'
```

## Delete an event node (Step 4c, part 1)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-user-id: timeline-skill" \
  -d '[{
    "id": "<new-uuid>",
    "eventType": "node:deleted",
    "nodeId": "<eventNodeId>",
    "boardId": "<BOARD_ID>",
    "timestamp": <Date.now()>
  }]'
```
