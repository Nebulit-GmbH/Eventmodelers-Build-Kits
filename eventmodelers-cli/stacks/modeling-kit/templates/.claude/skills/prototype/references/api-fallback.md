# Prototype — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 1 — Contexts and timelines

```bash
curl -s -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT&projection=line"
curl -s -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line"
```

## Step 2 — The context's slices (effective context)

```bash
# Elements with fields + dependencies, every timeline of the effective context
curl -s -G -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata" \
  --data-urlencode "contextName=<CONTEXT>" -d projection=fields -d format=json

# Scenarios and storylines
curl -s -G -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata" \
  --data-urlencode "contextName=<CONTEXT>" -d projection=specs -d format=json
```

There is no REST equivalent of `get_board_outline`; without MCP, order screens by the order slices appear in the `slicedata` response.

## Step 2 — Screens

```bash
# Full records (meta.pages, meta.marks, cssFrameworks, meta.fields) for the screen ids
curl -s -X POST -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/query" -d '{"ids": ["<id1>", "<id2>"]}'

# A sketch SCREEN's element description — 404 when the screen is an uploaded image
curl -s -H "x-token: $TOKEN" -H "x-user-id: agent" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/<NODE_ID>/description"
```
