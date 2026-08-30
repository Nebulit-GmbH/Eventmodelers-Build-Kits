# Elaborating Scenarios — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Post Scenarios to Board — Step 1: Identify the Target Timeline and Column

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER" \
  -H "x-token: $TOKEN"
```

## Post Scenarios to Board — Step 2: Load Valid Step Elements

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/spec-info" \
  -H "x-token: $TOKEN"
# → { timelineId, elements: [{ id, title, type }] }
```

## Post Scenarios to Board — Step 4: Post All Scenarios for a Column in One Call

```bash
curl -s -X POST \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns/$COL/scenarios" \
  -H "x-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[...scenario objects...]'
# → 201 { specNodeId, scenarios (all), added (count), isNewNode }
```

On `409` (duplicate title) or `400` (validation error), log the error and retry without the offending scenario. On `404`, check that the timeline and column IDs are correct.
