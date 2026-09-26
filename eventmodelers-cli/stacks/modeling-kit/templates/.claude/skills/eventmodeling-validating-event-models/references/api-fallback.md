# Validating Event Models — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Context

```bash
# Naming / duplicates / attribute names — compact per-type lists
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT&projection=line"
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=COMMAND&projection=line"
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=READMODEL&projection=line"

# Field-source traceability — fields + dependencies per slice
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=fields&format=toon"

# Scenario coverage — specifications per slice (format must be json|yaml|toon)
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=specs&format=toon"
```
