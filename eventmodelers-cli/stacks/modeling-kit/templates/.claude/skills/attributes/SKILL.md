---
name: attributes
description: Add a new attribute or rename an existing attribute across a chain of elements from a source element to a target element, following inbound dependencies
---

# Attributes

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

You are propagating an attribute change (add or rename) across a chain of elements on an eventmodelers board. You start at the target element, apply the change, then walk backwards through inbound dependencies until you reach the source element, applying the change to every element along the way.

---

## Step 1 — Gather inputs

Ask the user for all required information **in a single message** (do not ask one at a time):

1. **Target element** — the end of the chain: a node id, a title, or a cell name (e.g. `B2`)
2. **Source element** — the start of the chain: a node id, a title, or a cell name (e.g. `A2`)
3. **Operation** — `add` a new attribute, or `rename` an existing one
4. If **rename**: which attribute name to rename FROM, and what to rename it TO
5. If **add**: the name of the new attribute to add

If any of these were already provided in `$ARGUMENTS`, skip asking for them.

---

## Step 2 — Resolve the chain

**Prefer MCP:** `get_attribute_chain` resolves every node in the columns between the source and target nodes (inclusive), ordered target→source (top-to-bottom within a column), each as `{id, type, title, cellName, fields}` — this collapses the manual inbound-edge walk below into one call. You still need `TIMELINE_ID` (the chapter to search): if multiple chapters exist on the board, resolve which one first (see 2a fallback below, or `mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "CHAPTER", "projection": "line" }` — ids/titles are enough to pick one) and ask the user if ambiguous.

First resolve target and source to node ids (`TARGET_NODE_ID`, `SOURCE_NODE_ID`):
- **Node id** (incl. a node the task or a comment points at) — use it as-is.
- **Title** — `mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "chapterId": "$CHAPTER_ID", "name": "<title>", "projection": "line" }`; ask the user if several match.
- **Cell name** (e.g. `B2`) — `mcp__eventmodelers__get_board_outline { "boardId": "$BOARD_ID", "chapterId": "$CHAPTER_ID" }` and take the node whose `cellName` equals it. `get_board_outline` is the only read that reports `cellName`; never compute a node from a cell address yourself.

```
mcp__eventmodelers__get_attribute_chain {
  "boardId": "$BOARD_ID",
  "timelineId": "$CHAPTER_ID",
  "targetNodeId": "<TARGET_NODE_ID>",
  "sourceNodeId": "<SOURCE_NODE_ID>"
}
```

The result gives you the ordered chain directly — save it as the chain used in Step 4, and skip the manual walk in 2a–3c below. A `NODE_NOT_IN_TIMELINE` error means one of the two nodes isn't placed in `$CHAPTER_ID` — pick the right chapter (or tell the user) rather than retrying. Continue with the fallback only if MCP isn't connected.

### Fallback (no MCP) — resolve target and source to nodes

A node id needs no resolving (`GET .../nodes/:nodeId`); a title resolves via `GET .../nodes?chapterId=&name=`. For a cell name, resolve it to a node using the exact same cell-resolution steps as the `examples` skill's "2c — Cell name" section (fetch chapters, fetch the chapter fresh to decode the grid, decode the cell name into a `CELL_ID`, then always fetch the cell live via REST `?cellId=&timelineId=` — MCP `get_nodes` has no `cellId` filter) — see there for the full mechanics, substituting `x-user-id: attributes-skill`.

Take the first non-CHAPTER result as the node for each cell. Save as `TARGET_NODE` and `SOURCE_NODE`.

---

### Fallback (no MCP) — build the dependency chain

Walk backwards from `TARGET_NODE` to `SOURCE_NODE` by following inbound edges. Build an ordered list: `[TARGET_NODE, …intermediate nodes…, SOURCE_NODE]`.

### 3a — Use node edges
Each node may have an `edges` array:
```json
edges: [{ id, source, target, sourceHandle, targetHandle }]
```
An **inbound** edge is one where `edge.target === currentNode.id`.

**Prefer `get_connected_nodes`** — it does this entire walk server-side, in one call, from the target alone:
```
mcp__eventmodelers__get_connected_nodes {
  "boardId": "$BOARD_ID",
  "nodeId": "<TARGET_NODE.id>",
  "direction": "inbound",
  "depth": 10,
  "includeFields": true
}
```
The result is already ordered by `hops` (nearest first) and carries each node's `cellName` and `fields[]`, which is everything Step 4 needs — so this replaces both the edge walk and the per-node field fetch. Stop at the node matching `SOURCE_NODE`; anything beyond it is outside the requested chain.

Each neighbour reports `via`. `"edge"` means a real connection. `"layout"` means that node had no edge in that direction and the neighbour was inferred from the grid — correct, but worth a line in your Step 5 report so the user knows the chain was read off the layout rather than off wiring. A `chapterHasEdges: false` in the summary means the whole chapter is unwired.

Reach for a single-node fetch only for a node genuinely outside the anchor's chapter:
```
mcp__eventmodelers__get_node { "boardId": "$BOARD_ID", "nodeId": "$EDGE_SOURCE_ID", "projection": "edges" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "3a — Use Node Edges". Resolve the walk from **one** chapter-scoped read rather than a `get_node` per hop: `GET .../nodes?chapterId=` returns every node with full `meta`, `node.position` and `node.parentId` in a single response — index it and walk it locally.

### 3b — Column-based fallback (if no edges)
Only needed without MCP; `get_connected_nodes` already applies this rule itself and labels the result `via: "layout"`.

Hand-built or imported chapters frequently have **no edges at all** — every node comes back with `edges: []` and `get_board_outline`'s edge list is empty. That is not an error and not a reason to stop: in that case grid geometry *is* the chain. Use the chapter cell layout (already in memory from 3a) to find inbound neighbours:

In a standard event modeling layout (rows per `eventmodeling-core-rules` — `actor`: SCREEN/AUTOMATION, `interaction`: COMMAND/READMODEL, `swimlane`: EVENT):

- **READMODEL** in the interaction row → its inbound EVENT is in the swimlane row of the **same column**
- **EVENT** in the swimlane row → its inbound COMMAND is in the interaction row of the **same column**
- **COMMAND** in the interaction row → its issuer is the SCREEN/AUTOMATION in the actor row of the **same column**; the READMODEL supplying that issuer is in the interaction row of the **previous column** — never this column, whose interaction row is already occupied by this COMMAND. A column's interaction row holds exactly one node, a COMMAND *or* a READMODEL, never both, so "same column" is not an option when walking back from a COMMAND
- **SCREEN** in the actor row → its inbound READMODEL is in the interaction row of the **same column**, or of the **previous column** when this screen's own interaction row is taken by the COMMAND it issues
- **AUTOMATION** in the actor row → its inbound READMODEL is in the interaction row of the **previous column** — never the same column, which already holds the COMMAND it issues

Walking **forward** (does this node have a consumer?), a READMODEL's SCREEN/AUTOMATION is in the actor row of its **own column or the very next one** — both are correct. Never conclude a read model is unconsumed from its own column alone; check the next column before reporting a gap.

Two mistakes this list exists to prevent: a COMMAND's inbound READMODEL is in the **interaction** row (the same row type the COMMAND itself sits in, one column earlier), *not* the swimlane row, which holds EVENTs only. And a READMODEL feeding a consumer one column to its right is the normal shape, not a backward arrow (`eventmodeling-core-rules` — "Connections Read Forward").

Resolve candidates from the chapter read you already have — do **not** issue a `?cellId=` lookup per candidate. If the chapter's `meta.timelineData.cells` is sparse or absent, derive each node's (column, row) from `node.position.x/y` bucketed against `meta.timelineData.columns[].width` and `rows[].height`; that mapping is enough to apply the rules above. Skip candidates that don't exist or are already in the chain.

### 3c — Stop condition
Stop traversal when:
- You reach `SOURCE_NODE` (id match), OR
- There are no more inbound nodes to follow, OR
- You have visited 20 nodes (safety limit — warn the user if hit)

---

## Step 4 — Apply the change to the whole chain in one write

Compute the updated `fields` array for **every** node in the chain first, in order (TARGET_NODE first, then backwards to SOURCE_NODE), then submit them all in a **single** `submit_node_events` call. Do not write one node, check it, and move to the next — the chain is one logical edit and `events[]` takes the whole batch.

For each node, compute (don't write yet):

### If operation is `add`:
- Check if a field with that name already exists in `meta.fields` — if so, skip this node (log it).
- Otherwise append a new field:
```json
{
  "name": "<attributeName>",
  "type": "String",
  "query": false,
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

Collect one `node:changed` event per affected node, then send them together.

**Prefer MCP** — one call for the entire chain, one event per node in `events[]`:
```
mcp__eventmodelers__submit_node_events {
  "boardId": "$BOARD_ID",
  "compact": true,
  "events": [
    {
      "id": "<uuid>",
      "eventType": "node:changed",
      "nodeId": "<NODE_ID_1>",
      "changedAttributes": ["meta.fields"],
      "meta": { "fields": "<updated_fields_array_1>" }
    },
    { "…one more event per remaining node in the chain…" }
  ]
}
```

Nodes that are skipped (field already exists / field not found) simply contribute no event — don't send a no-op change for them.

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 4 — Apply the Change to Each Node in the Chain". The REST endpoint takes the same `NodeChangeEvent[]` body, so it batches identically — one POST, not one per node.

Verify the response is HTTP 200. If the batch fails, report the error and stop; nothing was partially applied from your side, so re-run after fixing the cause rather than retrying node by node.

If you also need to verify the result, re-read the whole chain in one call — `get_nodes { "boardId": "$BOARD_ID", "nodeIds": [<every node id you just wrote>], "projection": "line" }` when you only check that the attribute name is present/renamed (`line` lists each node's field names), or without `projection` when you must also check the field's type/example — never one `get_node` per node.

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
