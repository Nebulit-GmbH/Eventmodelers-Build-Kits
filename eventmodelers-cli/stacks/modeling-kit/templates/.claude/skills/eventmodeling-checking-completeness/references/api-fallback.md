# Checking Completeness — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Board Context

```bash
# Timelines (ids/titles only) — drive the slice data by timeline: a timeline without a context is its own context
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line"

# Elements with fields + dependencies for a timeline's effective context (no specs/comments).
# Skip timelines already named in a previous response's slice `chapter` values.
curl -s -G -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata" \
  --data-urlencode "contextName=<TIMELINE_TITLE>" -d projection=fields -d format=toon

# Full records (incl. data.linkedTo) for just the duplicate candidates
curl -s -X POST -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/query" -d '{"ids": ["<id1>", "<id2>"]}'
```

## 4. Check Slice Coverage

There is no REST equivalent of `get_board_outline`, so this fallback keeps the full SLICE_BORDER rows — the cross-reference needs their `columnId`, which `projection=line` does not carry:

```bash
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=SLICE_BORDER"
```

Cross-reference each COMMAND/READMODEL node's column against the `columnId` of the SLICE_BORDER nodes; a column with no matching slice is a gap (linked copies exempt).
