# Validating Event Models — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Context

Reads by element type are bound to a chapter: list the chapters first (`nodes?type=CHAPTER&projection=line`), pick `CHAPTER_ID`, and repeat per chapter for a whole-board check.

```bash
# Naming / duplicates / attribute names — compact per-type lists
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT&chapterId=$CHAPTER_ID&projection=line"
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=COMMAND&chapterId=$CHAPTER_ID&projection=line"
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=READMODEL&chapterId=$CHAPTER_ID&projection=line"

# Field-source traceability — fields + dependencies per slice
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=fields&format=toon"

# Scenario coverage — specifications per slice (format must be json|yaml|toon)
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=specs&format=toon"
```
