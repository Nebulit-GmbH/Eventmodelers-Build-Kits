# Validating Event Models — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Context

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT"
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=COMMAND"
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=READMODEL"
```
