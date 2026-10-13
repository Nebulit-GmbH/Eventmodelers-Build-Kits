# Prototype — curl Fallback Calls

Only needed when MCP is not connected. `prototype.mjs status` (Step 2) already uses the REST API directly and needs no MCP.

## Step 1 — Contexts and timelines

```bash
curl -s -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT&projection=line"
curl -s -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line"
```

## Step 3 — One flagged slice

```bash
# Elements with fields + dependencies
curl -s -G -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata" \
  --data-urlencode "contextName=<CONTEXT>" -d sliceId=<SLICE_ID> -d projection=fields -d format=json

# Scenarios and storylines
curl -s -G -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata" \
  --data-urlencode "contextName=<CONTEXT>" -d sliceId=<SLICE_ID> -d projection=specs -d format=json

# Full screen records (meta.pages, meta.marks, meta.fields)
curl -s -X POST -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/query" -d '{"ids": ["<id1>", "<id2>"]}'

# A sketch SCREEN's elements — 404 when the screen is an uploaded image
curl -s -H "x-token: $TOKEN" -H "x-user-id: agent" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/<NODE_ID>/description"
```
