# Handle Comment — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Action: place

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  -H "Content-Type: application/json" \
  -d '{"text":"<text>","type":"<type>","author":"<author>"}'
```

Response: `201 {"id":"<commentId>"}`

## Action: resolve — Step A (resolve comment ID)

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
```

## Action: resolve — Step B (resolve)

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments/$COMMENT_ID/resolve" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
```

## Action: delete — Step C (delete)

```bash
curl -s -X DELETE "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID/comments/$COMMENT_ID" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
```
