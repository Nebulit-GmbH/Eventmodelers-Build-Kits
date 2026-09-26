# Event Model Validation Checklist Skill — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Context

```bash
# Name/type checks — compact per-type lists
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT&projection=line"
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=COMMAND&projection=line"
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=READMODEL&projection=line"

# Field-level checks — fields + dependencies per slice
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=fields&format=toon"

# Business rules / scenarios (format must be json|yaml|toon)
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=specs&format=toon"
```
