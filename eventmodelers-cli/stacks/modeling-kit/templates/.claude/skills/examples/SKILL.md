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

## Step 1b — Many targets at once

`target` is singular, but the common real request is "fill in the examples across this chapter". When you have more than one target, **do not run this skill once per element and do not fetch context a node at a time.**

1. Read the chapter **once**: `mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "chapterId": "$CHAPTER_ID" }`. That single response carries every element's `meta.fields` *including the `example` values already filled in* — which is exactly the canonical-value pool Step 3c asks for, for the whole chapter, in one call.
2. Pick the canonical value per field name from that pool (e.g. `customerId: "cust-123"`, `email: "jane@example.com"`) before writing anything, so every element ends up consistent.
3. Then generate every target's values and write them all in a single `submit_node_events { events: [...] }` call — one `node:changed` event per element, never one call per element.

A run that opens each element with its own `get_node` to "read existing examples first" is doing step 1 N times over.

---

## Step 2 — Resolve the element (prefer MCP)

Resolve `target` to a node, with whichever identifier it is:

- `target` is a UUID → `mcp__eventmodelers__get_node { "boardId": "$BOARD_ID", "nodeId": "<target>" }`
- `target` is a name → `mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "name": "<target>", "projection": "line" }` — a partial, case-insensitive title match; `line` is enough to pick (ids/titles/types only); prefer an exact title, and if several elements still match, list them and ask the user to pick one. Then read the chosen node in full with `get_node` (Step 4 needs its fields' types and examples).
- `target` is a cell name (e.g. `B3`) → `mcp__eventmodelers__get_board_outline { "boardId": "$BOARD_ID", "chapterId": "$CHAPTER_ID" }` (the only read that reports `cellName`) and take the node whose `cellName` is `target`, then read it in full by its id with `get_node` (if multiple chapters exist, find the chapter first with `get_nodes { "type": "CHAPTER", "projection": "line" }` and ask the user if ambiguous). If you already did the full chapter read from Step 1b, take the node by that id from there instead of `get_node`. Never construct a cell address yourself — only use one you were given or read back from `get_board_outline`; from then on address the element by its node id.

Then continue with Step 3 (linked elements) — `mcp__eventmodelers__get_connected_nodes { "boardId": "$BOARD_ID", "nodeId": "<resolved id>", "includeFields": true }` returns the neighbours and their fields in one call.

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

Build the updated `fields` array: same structure as the original, only the `example` property changed where needed.

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