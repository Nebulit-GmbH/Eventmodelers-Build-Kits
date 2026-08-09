---
name: examples
description: Find an element on an eventmodelers board by ID, name, or cell name and add or improve example data on its fields, using linked elements for context and consistency
---

# Examples

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

You are adding or improving example data on an eventmodelers element. You find the element, read all linked elements for context, then generate realistic and consistent example values for every field that is missing one or has a weak example.

---

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `target` | node UUID, element name (e.g. "Order Placed"), or cell name (e.g. "B3") | **required** |
| `boardId` | a board UUID | from `connect` skill (`BOARD_ID`) |
| `baseUrl` | explicit URL override | from `connect` skill (`BASE_URL`) |

---

## Step 2 — Resolve and generate examples (prefer MCP)

`add_field_examples` is a whole-algorithm convenience tool: it resolves the node, loads linked neighbours for cross-element consistency, fills any empty field examples, and writes the result back — collapsing the entire "find node → find linked nodes → build examples → submit_node_events" flow (Steps 2–5 below) into one call. Call it with whichever identifier matches `target`:

- `target` is a UUID → pass `nodeId`
- `target` is a name → pass `name`
- `target` is a cell name (e.g. `B3`) → pass `cellName` + `timelineId` (the chapter id — if multiple chapters exist on the board, resolve which one first using 2c-fallback's chapter lookup, or `mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "CHAPTER" }`, and ask the user if ambiguous)

```
mcp__eventmodelers__add_field_examples { "boardId": "$BOARD_ID", "nodeId": "<target, if a UUID>" }
```
```
mcp__eventmodelers__add_field_examples { "boardId": "$BOARD_ID", "name": "<target, if a name>" }
```
```
mcp__eventmodelers__add_field_examples { "boardId": "$BOARD_ID", "cellName": "<target, if a cell name>", "timelineId": "$CHAPTER_ID" }
```

If this succeeds, skip straight to Step 6 (report back), describing the fields the tool reports as changed. Use the manual fallback flow below (Steps 2–5) only if MCP isn't connected.

### Fallback (no MCP) — Step 2: Resolve the element

Try the resolution strategies in order until one succeeds.

### 2a — UUID
If `target` looks like a UUID (pattern `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), fetch it directly:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$target" \
  -H "x-user-id: examples-skill"
```

### 2b — Name search
If `target` is not a UUID, search by name:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/events/search?name=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$target")" \
  -H "x-user-id: examples-skill"
```

Pick the best match (exact title match preferred; case-insensitive). If multiple matches exist, list them and ask the user to pick one.

### 2c — Cell name (spreadsheet-style, e.g. "B3")
If `target` matches the pattern `[A-Z]+[0-9]+`:

1. Fetch all chapters on the board to find the relevant timeline:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER" \
  -H "x-user-id: examples-skill"
```

If multiple chapters exist, ask the user which one to use.

2. Fetch the chapter **fresh** to decode the grid — never use cached chapter data, as cells are updated frequently:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID" \
  -H "x-user-id: examples-skill"
```

From `meta.timelineData`, decode the cell name into a `cellId`:
- Column letter(s) → 0-based column index (A=0, B=1, … Z=25, AA=26, …)
- Row digit → 0-based row index (1→0, 2→1, …)
- Find the matching column in `columns` and the matching row in `rows`.
- Compute: **`CELL_ID = row.id + "-" + column.id`** (cell IDs are always `<rowId>-<columnId>`).

3. **Always fetch the cell live** to get the current node list — do not rely on the `nodeId` in the chapter's cell data, as it may be stale. No MCP equivalent: `get_nodes` only filters by `type`, not `cellId`:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=$CELL_ID" \
  -H "x-user-id: examples-skill"
```

Use the first non-CHAPTER result (filter out CHAPTER type).

If no element is found after all strategies, stop and tell the user what was tried.

Save the resolved node as `TARGET_NODE` (full JSON including `id`, `meta`, `edges`).

---

### Fallback (no MCP) — Step 3: Load linked elements for context

Collect nearby elements to understand the domain context and generate consistent examples. **Never fetch all board nodes.** Only fetch specific nodes you already have IDs for.

### 3a — Nodes from edges
If `TARGET_NODE.edges` is non-empty, fetch each connected node individually by its ID:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/<EDGE_NODE_ID>" \
  -H "x-user-id: examples-skill"
```

Fetch all edge-connected nodes in parallel (one request per node ID).

### 3b — Nodes from the same column (cell-based resolution only)
If you resolved `TARGET_NODE` via a cell name (Step 2c), you already have the full chapter `cells` array in memory. Use it — **no extra API call needed**:

- Find all cells that share the same `colId` as `TARGET_NODE`'s cell.
- Collect their `nodeId` values (skip the target itself and any cell without a `nodeId`).
- Fetch each of those nodes individually by ID (in parallel):

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/<NODE_ID>" \
  -H "x-user-id: examples-skill"
```

### 3c — Read neighbour fields
For each neighbour element collected above (COMMAND, EVENT, READMODEL), extract its `meta.fields` and their existing `example` values. This gives you a pool of consistent values to reuse — e.g. if a COMMAND already has `email: "jane@example.com"`, use the same email in the linked EVENT.

---

### Fallback (no MCP) — Step 4: Generate improved examples

For each field in `TARGET_NODE.meta.fields`:

1. **Skip** if `example` has any non-empty value — never overwrite existing examples, regardless of quality.
2. **Fill** only if `example` is absent, null, or whitespace-only.

Rules for generating examples:
- **Reuse values from linked elements** when the field name matches — keep examples consistent across the slice.
- **Infer type from the field name and `type`** property:
  - `email` → realistic email like `"jane.smith@example.com"`
  - `name`, `firstName`, `lastName` → real-sounding name
  - `id`, `*Id` → realistic UUID or short ID like `"ORD-2024-0042"`
  - `amount`, `price`, `total` → realistic decimal like `"149.99"`
  - `date`, `*At`, `*Date` → ISO 8601 string like `"2024-03-15T10:30:00Z"`
  - `status` → a plausible status value derived from the element title
  - `boolean`, `*Enabled`, `*Active` → `"true"` or `"false"`
  - `count`, `quantity` → small realistic integer like `"3"`
  - Arrays / `cardinality: "List"` → JSON array with 1–2 representative items
  - Unknown string fields → a short, realistic sentence or value matching the field name
- Make examples **domain-specific**: if the element is called "Order Placed", use order-domain values; if it's "User Registered", use registration-domain values.
- Keep examples **short** — one value per field, no paragraphs.

Build the updated `fields` array: same structure as the original, only the `example` property changed where needed. Set `edited: true` on any field you modify.

---

### Fallback (no MCP) — Step 5: Write the update

**Prefer MCP** (only reachable if you did the resolve/generate steps manually but still have MCP available): same event body, passed as a tool arg instead of `-d`:
```
mcp__eventmodelers__submit_node_events {
  "boardId": "$BOARD_ID",
  "events": [{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<TARGET_NODE.id>",
    "boardId": "$BOARD_ID",
    "timestamp": <epoch-ms>,
    "changedAttributes": ["meta.fields"],
    "meta": { "fields": "<updated-fields-array>" }
  }]
}
```

**Fallback (no MCP at all)** — build the payload with Python to avoid shell JSON-escaping issues, then POST it:

```bash
python3 - <<EOF > /tmp/examples_payload.json
import json, time, uuid
payload = [{
  "id": str(uuid.uuid4()),
  "eventType": "node:changed",
  "nodeId": "<TARGET_NODE.id>",
  "boardId": "<BOARD_ID>",
  "timestamp": int(time.time() * 1000),
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
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: examples-skill" \
  --data-binary @/tmp/examples_payload.json
```

Verify the response is HTTP 200. If it fails, report the error and stop.

---

## Step 6 — Report back

Tell the user:

- **Element updated**: title and type
- **Fields improved**: list each field name and the example value that was set (skip unchanged fields)
- **Fields skipped**: briefly note any fields that already had good examples
- **Consistency notes**: if you reused values from linked elements, mention which ones

Example output:
```
Updated: EVENT "Order Placed"

Examples set:
  orderId   → "ORD-2024-0042"
  customerId → "CUST-8819"  (reused from linked COMMAND "Place Order")
  amount    → "149.99"
  placedAt  → "2024-03-15T10:30:00Z"

Skipped (already good):
  email → "jane@example.com"
```