# Examples — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — Resolve the element

Try the resolution strategies in order until one succeeds.

### 2a — UUID
If `target` looks like a UUID (pattern `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), fetch it directly:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$target" \
  -H "x-user-id: examples-skill"
```

### 2b — Name search
If `target` is not a UUID, search by title with the `name` filter (partial, case-insensitive) — `projection=line` returns just `{id, type, title, fields}` per match, enough to pick one:

```bash
curl -s -G "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes" \
  --data-urlencode "name=$target" --data-urlencode "projection=line" \
  -H "x-user-id: examples-skill"
```

Pick the best match (exact `title` match preferred; case-insensitive). If multiple matches exist, list them and ask the user to pick one. Then fetch the chosen node in full as in 2a — Step 4 needs its `meta.fields` with types and examples.

### 2c — Cell name (spreadsheet-style, e.g. "B3")
If `target` matches the pattern `[A-Z]+[0-9]+`:

1. Fetch all chapters on the board to find the relevant timeline:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line" \
  -H "x-user-id: examples-skill"
```

If multiple chapters exist, ask the user which one to use.

2. Fetch the chapter **fresh** to decode the grid — never use cached chapter data, as cells are updated frequently:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID?projection=cells" \
  -H "x-user-id: examples-skill"
```

From the returned `{rows, columns, cells}` (not wrapped in `meta.timelineData`), decode the cell name into a `cellId`:
- Column letter(s) → 0-based column index (A=0, B=1, … Z=25, AA=26, …)
- Row digit → 0-based row index (1→0, 2→1, …)
- Find the matching column in `columns` and the matching row in `rows`.
- Compute: **`CELL_ID = row.id + "-" + column.id`** (cell IDs are always `<rowId>-<columnId>`).

3. **Always fetch the cell live** to get the current node list — do not rely on the `nodeId` in the chapter's cell data, as it may be stale. No MCP equivalent: `get_nodes` filters by `type`, `name`, `chapterId` and `nodeIds`, but not `cellId`. The REST `cellId` filter requires `timelineId`:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=$CELL_ID&timelineId=$CHAPTER_ID" \
  -H "x-user-id: examples-skill"
```

Use the first non-CHAPTER result (filter out CHAPTER type).

If no element is found after all strategies, stop and tell the user what was tried.

Save the resolved node as `TARGET_NODE` (full JSON including `id` and `meta`).

## Step 3 — Load linked elements for context

Collect nearby elements to understand the domain context and generate consistent examples. **Never fetch all board nodes.** Only fetch specific nodes you already have IDs for.

### 3a — Nodes from edges
Read the target's connections only (`projection=edges` → `{nodeId, edges}`, no node content; the full node record carries no edges):

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$TARGET_ID?projection=edges" \
  -H "x-user-id: examples-skill"
```

If `edges` is non-empty, fetch every connected node (the `source`/`target` that isn't `TARGET_ID`) in full — Step 3c needs their field examples — in one call:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/query" \
  -H "Content-Type: application/json" -H "x-user-id: examples-skill" \
  -d '{"ids": ["<EDGE_NODE_ID>", "..."]}'
```

### 3b — Nodes from the same column (cell-based resolution only)
If you resolved `TARGET_NODE` via a cell name (Step 2c), you already have the full chapter `cells` array in memory. Use it — **no extra API call needed**:

- Find all cells that share the same `colId` as `TARGET_NODE`'s cell.
- Collect their `nodeId` values (skip the target itself and any cell without a `nodeId`).
- Fetch each of those nodes individually by ID (in parallel):

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/<NODE_ID>" \
  -H "x-user-id: examples-skill"
```

## Step 5 — Write the update

Build the payload with Python to avoid shell JSON-escaping issues, then POST it:

```bash
python3 - <<EOF > /tmp/examples_payload.json
import json, uuid
payload = [{
  "id": str(uuid.uuid4()),
  "eventType": "node:changed",
  "nodeId": "<TARGET_NODE.id>",
  "changedAttributes": ["meta.fields"],
  "meta": {
    "fields": <updated-fields-array as Python list>
  }
}]
print(json.dumps(payload))
EOF

curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: $TOKEN" \
  -H "x-user-id: examples-skill" \
  --data-binary @/tmp/examples_payload.json
```
