# Analyze Existing Model — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — List all slices

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices"
```

Response: `{ "slices": [{ "id": "<uuid>", "title": "<name>", "status": "<status>" }] }`

## Step 3 — Discover contexts

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT"
```

## Step 4 — Fetch slice data per context

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>"
```

Each response contains a `slices` array. Each slice entry includes:
- `id`, `title`, `status`
- `elements`: array of `{ type, id, title, fields[] }`  — element types: `EVENT`, `COMMAND`, `READMODEL`, `SCREEN`, `AUTOMATION`
- `specs`: array of GWT scenarios (may be empty)
- `edges`: relationships between elements

## Example — full board analysis

```bash
# 1. List slices
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices"

# 2. Fetch MODEL_CONTEXT nodes
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT"

# 3. Fetch full slice data for a context
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=Ordering"
```

Replace `$TOKEN`, `$ORG_ID`, `$BOARD_ID`, and the context name with real values resolved from the `connect` skill.
