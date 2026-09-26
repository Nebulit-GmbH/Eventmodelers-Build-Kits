# Analyze Existing Model — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — List all slices

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices"
```

Response: `{ "slices": [{ "id": "<uuid>", "title": "<name>", "status": "<status>" }] }`

## Step 3 — Discover contexts

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT&projection=line"

# Timelines too — one without a context is its own context, named after the timeline
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line"
```

Returns `{id, type, title}` per node — all this step needs.

## Step 4 — Fetch slice data per context

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=fields&format=toon"

curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>&projection=specs&format=toon"
```

- `projection=fields` — slice header (id, title, status, sliceType, chapter, context) + elements (commands, events, readmodels, screens, processors, tables) with their fields and dependencies. No specs/comments.
- `projection=specs` — slice header + specifications (given/when/then) and storylines. No elements.
- `projection=outline` — slice header + elements as `{id, title, type}` only; use it instead of `fields` when no gap/shape check is needed.
- `outline` and `specs` require `format=json|yaml|toon` (others → 400 `PROJECTION_FORMAT_UNSUPPORTED`).

## Example — full board analysis

```bash
# 1. List slices
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices"

# 2. Fetch MODEL_CONTEXT nodes and timelines (a timeline without a context is its own context)
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT&projection=line"
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line"

# 3. Fetch fields + specs projections for a context
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=Ordering&projection=fields&format=toon"
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=Ordering&projection=specs&format=toon"
```

Replace `$TOKEN`, `$ORG_ID`, `$BOARD_ID`, and the context name with real values resolved from the `connect` skill.
