---
name: examples
description: Find an element on an eventmodelers board by ID, name, or cell name and add or improve example data on its fields, using linked elements for context and consistency
---

# Examples

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

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

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 2 — Resolve the element".

---

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 3 — Load linked elements for context".

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

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 5 — Write the update".

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