# Discover Storyboard — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 5 — Create chapter

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "x-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":0,"y":0}}'
```

## Step 5 — Update chapter title

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: discover-storyboard" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<CHAPTER_ID>",
    "boardId": "<BOARD_ID>",
    "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.title"],
    "meta": { "type": "CHAPTER", "title": "<flow name>" },
    "node": { "id": "<CHAPTER_ID>", "data": {} }
  }]'
```

## Step 6 — Fetch chapter grid

```bash
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

## Step 7a — Create column

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: discover-storyboard" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Response includes `{ columnId, index, totalColumns }` — `index` is the new `columnIndex`.

## Step 7b — Upload image (fallback)

The same atomic operation via the `image-nodes` endpoint (not the plain `images/:id` endpoint, which only updates an existing node's image and does not place it) — image path only:
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/image-nodes/$SCREEN_NODE_ID" \
  -H "x-token: $TOKEN" \
  -F "file=@<screen.filepath>" \
  -F "chapterId=$CHAPTER_ID" \
  -F "cellName=$CELL_NAME"
```
For the HTML path with no MCP, use the `html-screen-nodes` endpoint per the `html-screen` skill's fallback mechanics instead.
