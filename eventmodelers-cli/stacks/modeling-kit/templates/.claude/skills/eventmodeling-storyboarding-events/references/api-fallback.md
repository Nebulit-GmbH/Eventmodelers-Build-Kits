# Storyboarding Events — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Integration — Check existing screen nodes

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=HTML_SCREEN"
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=SCREEN"
```

## Resolve One Actor Lane Per Human Role — Step 1: Fetch the chapter's actor rows

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

## Resolve One Actor Lane Per Human Role — Step 3: Create a new actor lane

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/lanes" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: storyboarding-events" \
  -H "Content-Type: application/json" \
  -d '{"type": "actor", "label": "<Role Name>"}'
```

## Mandatory Screen Rendering — Step B: Create the HTML_SCREEN node

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/<node-uuid>" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: storyboarding-events" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorRowId>-<columnId>",
    "pages": ["<div>...</div>"]
  }'
```
Then, over REST only (no `fields` param on the HTML-screen endpoint), still set `meta.fields` via a separate `node:changed` call.

## Mandatory Screen Rendering — Step B (sketch path): Create the SCREEN node

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: storyboarding-events" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": 1234567890,
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorRowId>-<columnId>",
    "meta": {"type": "SCREEN", "title": "<Screen Title>", "fields": [...]}
  }]'
```

## Mandatory Screen Rendering — Step C (sketch path): Render the wireframe sketch

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$NODE_ID/sketch" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: storyboarding-events" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "<concise description of what this screen shows>",
    "elements": [
      {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"},
      {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":3,"fill":"violet"},
      {"type":"headline","gridX":2,"gridY":1,"text":"Screen Title","fontSize":16,"fill":"white","gridWidth":46},
      ...more elements...
    ]
  }'
```
