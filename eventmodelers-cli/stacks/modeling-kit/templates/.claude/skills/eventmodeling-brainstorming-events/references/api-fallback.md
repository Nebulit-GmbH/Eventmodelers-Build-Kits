# Brainstorming Events — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Context — Check existing EVENT nodes

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT"
```

## Board Context — Check existing CHAPTER nodes

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

## Timeline Discovery — Step 2: Create one chapter per group — create the chapter

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  -H "Content-Type: application/json" -d '{}'
# → { timelineId: "<chapterId>", ... }
```

## Timeline Discovery — Step 2: Create one chapter per group — set its title

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: brainstorming-events" -H "Content-Type: application/json" \
  -d '[{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<chapterId>",
    "boardId": "<boardId>",
    "timestamp": 1234567890,
    "meta": {"type": "CHAPTER", "title": "Reservation & Lending"}
  }]'
```

## Timeline Discovery — Step 2: Reposition an existing chapter

```bash
curl -s -X PUT "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/position" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  -H "Content-Type: application/json" \
  -d '{"x": 0, "y": 1200}'   # first chapter: y=0, second: y=1200, third: y=2400, …
```

## Mode A — Step A: Ensure enough columns exist

No batch form exists over REST; one call per event:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: brainstorming-events" \
  -H "Content-Type: application/json" -d '{}'
# → { "columnId": "<colUuid>", "index": <n>, "totalColumns": <n> }
```

## Mode A — Step B: Fetch the chapter to find the swimlane row ID

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
# → node.meta.timelineData.rows — find the row where type === "swimlane"
```

## Mode A — Step D: Create the event with cellId

Same body via `POST .../nodes/events`:

```json
[{
  "id": "<event-uuid>",
  "eventType": "node:created",
  "nodeId": "<node-uuid>",
  "boardId": "<boardId>",
  "timestamp": 1234567890,
  "chapterId": "<chapterId>",
  "cellId": "<swimlaneRowId>-<columnId>",
  "meta": {
    "type": "EVENT",
    "title": "BookReserved",
    "fields": [
      {"name": "reservationId", "type": "String",   "example": "res-789"},
      {"name": "copyId",        "type": "String",   "example": "copy-42"},
      {"name": "memberId",      "type": "String",   "example": "mbr-101"},
      {"name": "expiresAt",     "type": "DateTime", "example": "2026-06-01T00:00:00Z"},
      {"name": "reservedAt",    "type": "DateTime", "example": "2026-05-29T10:00:00Z"}
    ]
  }
}]
```
