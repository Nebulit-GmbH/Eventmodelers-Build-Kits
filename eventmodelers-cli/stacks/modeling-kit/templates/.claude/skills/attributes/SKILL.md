---
name: attributes
description: Add a new attribute or rename an existing attribute across a chain of elements from a source cell to a target cell, following inbound dependencies
---

# Attributes

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

You are propagating an attribute change (add or rename) across a chain of elements on an eventmodelers board. You start at the target cell, apply the change, then walk backwards through inbound dependencies until you reach the source cell, applying the change to every element along the way.

---

## Step 1 — Gather inputs

Ask the user for all required information **in a single message** (do not ask one at a time):

1. **Target cell** — the end of the chain (e.g. `B2`)
2. **Source cell** — the start of the chain (e.g. `A2`)
3. **Operation** — `add` a new attribute, or `rename` an existing one
4. If **rename**: which attribute name to rename FROM, and what to rename it TO
5. If **add**: the name of the new attribute to add

If any of these were already provided in `$ARGUMENTS`, skip asking for them.

---

## Step 2 — Resolve the chain

**Prefer MCP:** `get_attribute_chain` resolves every node between the source and target cells (inclusive), ordered target→source, each with its full `fields[]` — this collapses the manual cell-resolution and inbound-edge walk below into one call. You still need `TIMELINE_ID` (the chapter to search): if multiple chapters exist on the board, resolve which one first (see 2a fallback below, or `mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "CHAPTER" }`) and ask the user if ambiguous.

```
mcp__eventmodelers__get_attribute_chain {
  "boardId": "$BOARD_ID",
  "timelineId": "$CHAPTER_ID",
  "targetCellName": "<target cell, e.g. B2>",
  "sourceCellName": "<source cell, e.g. A2>"
}
```

The result gives you the ordered chain directly — save it as the chain used in Step 4, and skip the manual walk in 2a–3c below. Continue with the fallback only if MCP isn't connected.

### Fallback (no MCP) — resolve both cells to nodes

For each cell (target and source), resolve it to a node using the exact same cell-resolution steps as the `examples` skill's "2c — Cell name" section (fetch chapters, fetch the chapter fresh to decode the grid, decode the cell name into a `CELL_ID`, then always fetch the cell live — `get_nodes` has no `cellId` filter) — see there for the full mechanics, substituting `x-user-id: attributes-skill`.

Take the first non-CHAPTER result as the node for each cell. Save as `TARGET_NODE` and `SOURCE_NODE`.

---

### Fallback (no MCP) — build the dependency chain

Walk backwards from `TARGET_NODE` to `SOURCE_NODE` by following inbound edges. Build an ordered list: `[TARGET_NODE, …intermediate nodes…, SOURCE_NODE]`.

### 3a — Use node edges
Each node may have an `edges` array:
```json
edges: [{ id, source, target, sourceHandle, targetHandle }]
```
An **inbound** edge is one where `edge.target === currentNode.id`. For each inbound edge, fetch the source node:

**Prefer MCP:**
```
mcp__eventmodelers__get_node { "boardId": "$BOARD_ID", "nodeId": "$EDGE_SOURCE_ID" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "3a — Use Node Edges".

### 3b — Column-based fallback (if no edges)
If a node has no edges, use the chapter cell layout (already in memory) to find plausible inbound neighbours:

In a standard event modeling layout:
- **READMODEL** in the interaction row → its inbound EVENT is in the swimlane row of the **same column**
- **EVENT** in the swimlane row → its inbound COMMAND is in the interaction row of the **same column**
- **COMMAND** in the interaction row → its inbound READMODEL is in the swimlane row of the **previous column**

Fetch candidate nodes by their cellId (live), skip any that don't exist or are already in the chain.

### 3c — Stop condition
Stop traversal when:
- You reach `SOURCE_NODE` (id match), OR
- There are no more inbound nodes to follow, OR
- You have visited 20 nodes (safety limit — warn the user if hit)

---

## Step 4 — Apply the change to each node in the chain

Process nodes in order: TARGET_NODE first, then backwards to SOURCE_NODE.

For each node:

### If operation is `add`:
- Check if a field with that name already exists in `meta.fields` — if so, skip this node (log it).
- Otherwise append a new field:
```json
{
  "name": "<attributeName>",
  "type": "String",
  "query": false,
  "edited": false,
  "optional": false,
  "generated": false,
  "subfields": [],
  "cardinality": "Single",
  "idAttribute": false,
  "showAttributes": false,
  "technicalAttribute": false
}
```

### If operation is `rename`:
- Find the field where `name === oldName` (case-insensitive). If not found in this node, skip it (log it).
- Update only the `name` property to `newName`. Leave all other field properties unchanged.

Build the updated `fields` array and send a `node:changed` event.

**Prefer MCP** — same event body, passed as a tool arg instead of `-d`:
```
mcp__eventmodelers__submit_node_events {
  "boardId": "$BOARD_ID",
  "events": [{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<NODE_ID>",
    "boardId": "$BOARD_ID",
    "timestamp": <epoch-ms>,
    "changedAttributes": ["meta.fields"],
    "meta": { "fields": "<updated_fields_array>" }
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 4 — Apply the Change to Each Node in the Chain".

Verify HTTP 200 before proceeding to the next node. If a node fails, report the error and stop.

---

## Step 5 — Report back

Tell the user:

- **Operation**: add `"<name>"` / rename `"<old>"` → `"<new>"`
- **Chain**: list each element in order (type + title + cell)
- **Updated**: which nodes were changed
- **Skipped**: which nodes were skipped and why (field already exists / field not found)

Example output:
```
Operation: rename "customerId" → "clientId"

Chain traversed (target → source):
  READMODEL "Customer Overview"   (B2) ✓ renamed
  EVENT     "Customer Registered" (A3) ✓ renamed
  COMMAND   "Register Customer"   (A2) — skipped (field not found)

Done.
```
