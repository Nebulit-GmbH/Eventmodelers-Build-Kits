# Storyboard — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 3 — Create a chapter

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":0,"y":0}}'
```

Extract `id` from the response → `CHAPTER_ID`.

## Step 4 — Fetch the chapter's grid state

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

Read `meta.timelineData` for `{rows, columns, cells}`.

## Step 5a — Add a column

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Step 5b — Create the screen node and render it (HTML path)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/$SCREEN_NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorCellId>",
    "pages": ["<div>...</div>"]
  }'
```

## Step 5b — Create the screen node and render it (sketch path, explicit request only)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/image-nodes/$SCREEN_NODE_ID/sketch" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorCellId>",
    "description": {"elements": [...]},
    "semanticDescription": "<screenTitle — what this screen shows>"
  }'
```

## Step 5b(ii) — Set field data lineage

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<SCREEN_NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "HTML_SCREEN", "fields": [ /* planned fields */ ] }
  }]'
```
