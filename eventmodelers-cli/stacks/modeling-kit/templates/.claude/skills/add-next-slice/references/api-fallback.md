# Add Next Slice — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2: Create the Slice

```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slices \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"state-change","nodes":{"interaction":{"title":"CancelReservation"}}}'
```
