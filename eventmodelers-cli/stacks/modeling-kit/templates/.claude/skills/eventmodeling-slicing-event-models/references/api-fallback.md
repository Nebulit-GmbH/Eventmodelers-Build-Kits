# Slicing Event Models — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 1: Resolve the Timeline

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line" -H "x-token: $TOKEN"
# → [{ id, type, title }] — enough to pick a chapter
```

## Step 2: Enumerate Commands, Read Models, and Automations — spec-info

```bash
curl "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/spec-info" -H "x-token: $TOKEN"
# → { timelineId, elements: [{ id, title, type }] } — filter client-side to type in COMMAND, READMODEL (no elementTypes param over REST)
```

AUTOMATION nodes in the timeline:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=AUTOMATION&chapterId=$TL&projection=line" -H "x-token: $TOKEN"
# → [{ id, type, title, fields? }]
```

## Step 2: Enumerate Commands, Read Models, and Automations — Chapter Node

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$TL?projection=cells" -H "x-token: $TOKEN"
# → columns: [{ id, index }]
# → cells:   [{ id: "<rowId>-<columnId>", nodeId }]
```

## Step 2: Enumerate Commands, Read Models, and Automations — Check Existing Slices

```bash
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices -H "x-token: $TOKEN"
# → { slices: [{ id, title, status }] }
```

## Step 3: Define Slices

```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slice-definitions \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"columnId":"<colId>","title":"PlaceOrder"}'
# → 200 { nodeId, timelineId, columnId, title }
```
(one call per column — the REST fallback has no batch form)
