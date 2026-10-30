## 3. Nodes

**File**: `src/slices/change/api-nodes/routes.ts`

All node endpoints require header: `x-user-id`

Also send `x-agent-id` (`$EVENTMODELERS_AGENT_ID`) on every write — that is what attributes the change to this agent by name on the board — and, while working a prompt that came from a chat, `x-chat-session-id` (`CHAT_SESSION_ID`), which ties the change to that conversation. See **Authentication & Headers** above.

### POST `/api/org/:orgId/boards/:boardId/nodes/events`
Submit node change events.

Any `node:created` event carrying a `chapterId` plus `cellId`/`cellName` (i.e. placing a node on a timeline) also triggers a best-effort, fire-and-forget auto-connect to type-compatible neighbors — same rules as the auto-connect endpoint below. Failures there never fail this call.

A `node:deleted` event cascades: if the deleted node is a chapter (timeline), every node placed in one of its cells and any node parented to it (e.g. a SLICE_BORDER spanning one of its columns) is deleted too, along with all their edges.

**Request body**: `NodeChangeEvent[]`

Every event carries its own `id` — **required**, a fresh uuid per event and never the node id. An event without one is rejected (`400`, invalid event shape). It keys the response's `hashes` map, and it is what makes a resubmit safe: the board-event insert ignores a conflicting id, so the same batch sent twice writes one history row per event rather than two.

Don't send `boardId` or `timestamp` per event: the board is the path's (the one this request was authorized for) and the timestamp is the server's. Both are ignored if sent — older payloads that include them still work.

```typescript
interface NodeChangeEvent {
  id: string                    // required — fresh uuid per event, NOT the node id; keys the response's hashes map
  eventType: 'node:created' | 'node:changed' | 'node:deleted'
  nodeId: string
  // boardId / timestamp: don't send them — server-derived, ignored if present
  userId?: string
  hash?: string                 // content hash
  changedAttributes?: string[]  // dot-paths e.g. 'meta.title'
  node?: {
    id: string
    data: {
      backgroundColor?: string
      title?: string
      url?: string
      linkedTo?: string            // rendering mirror only — meta.linkedTo (below) is authoritative
      // ...other node data fields
      // Do NOT set a "type" here — the server derives the node's render type from
      // meta.type automatically. Setting one yourself risks it being read as the
      // render type itself and breaking rendering.
    }
  }
  meta?: {
    type: ElementType
    title?: string
    description?: string
    fields?: Record<string, unknown>
    linkedTo?: string            // origin node id — the authoritative linked-copy pointer
    // ...
  }
  edges?: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
  chapterId?: string   // for cell placement
  cellName?: string    // spreadsheet-style, always <letter(s)><number> e.g. "B2", "AA10" — pass through as-is, never decompose or interpret it
}
```

**Response**: `200` — `{ hashes: { [eventId: string]: string } }`

---

### GET `/api/org/:orgId/boards/:boardId/nodes`
List all nodes on a board.

**Query params** (each at most once — a repeated or nested param is `400 QUERY_PARAM_INVALID`):
- `type?: ElementType` — exact match.
- `name?: string` — partial, case-insensitive title match.
- `chapterId?: string` — only nodes placed in this chapter (timeline).
- `projection?: "line" | "fields"` — `line`: compact `{id, type, title, fields?}` per node (`fields` = attribute names only, absent on nodes without fields); `fields`: `{id, type, title, parentId, fields?}` with the full field definitions as stored, but no html, description, sketch or grid data. Either instead of the full record. Neither form carries `cellName` — address existing nodes by `id`. Any other value is `400 PROJECTION_INVALID`.
- `cellId?: string` — return only the node occupying this timeline cell (format `<rowId>-<colId>`). Requires `timelineId`. Empty array if the cell is unoccupied.
- `colId?: string` — return every node occupying this column, across *all* rows of the timeline (e.g. to check for an existing COMMAND/READMODEL/SCREEN/AUTOMATION before placing one, since the server caps those at one per column even across separate lane rows). Requires `timelineId`. Combine with `type` to narrow to one element type.
- `timelineId?: string` — the CHAPTER node `cellId`/`colId` are resolved against. Required together with either of those two; `400` if omitted.

Cell/column occupancy lives only in the CHAPTER node's `meta.timelineData.cells`, never on the node rows themselves — this endpoint resolves `cellId`/`colId` against that timeline internally so callers don't have to fetch and parse the whole chapter node just to check occupancy.

**Response**: `200` — node record array (or `line`/`fields` projections). `400` — `cellId`/`colId` given without `timelineId`, `PROJECTION_INVALID`, or `QUERY_PARAM_INVALID`. `404` — `timelineId` doesn't reference an existing CHAPTER node with grid data.

---

### POST `/api/org/:orgId/boards/:boardId/nodes/query`
Fetch a known set of nodes in one call.

**Body**: `{ "ids": string[], "projection"?: "line" | "fields" }` — `ids` non-empty. Missing ids are silently omitted. Without `projection`, full stored records; `line`/`fields` give the shapes above. Neither carries `cellName`.

**Response**: `200` — node array. `400` — `ids` empty/not an array, or `PROJECTION_INVALID`.

---

### GET `/api/org/:orgId/boards/:boardId/nodes/:nodeId`
Get a single node.

**Query params**:
- `projection?: "cells" | "edges"` — `cells` (CHAPTER nodes only) returns just `{rows, columns, cells}` — read `cells` directly, not `.meta.timelineData.cells`; `edges` (any node) returns `{nodeId, edges}`, its inbound/outbound connections, without the node's content. Omit for the full stored node (no `cellName`).

**Response**: `200` — node record or the requested projection. `400` — `PROJECTION_INVALID`, `PROJECTION_NODE_TYPE_MISMATCH` (`cells` on a non-CHAPTER node), or `TIMELINE_NO_GRID` (a CHAPTER without grid data). `404` — node not found: `{ error, code: "NODE_NOT_FOUND", context }`.

---

### POST `/api/org/:orgId/boards/:boardId/nodes/:nodeId/auto-connect`
Auto-connect a node to its timeline neighbors — mirrors the frontend's auto-connect-on-place behavior. Looks only at the node's own timeline column and the previous column (never ahead), and creates `edge:added` events to every type-compatible neighbor found there, using the same pairing rules as connections created via node events (COMMAND→EVENT, SCREEN→COMMAND, EVENT→READMODEL, READMODEL→SCREEN, READMODEL→AUTOMATION, AUTOMATION→COMMAND).

Incompatible or already-connected neighbors are reported in `skipped`, not an error. Returns an empty result for nodes not placed on any timeline, or not a connectable element type (e.g. SCENARIO/spec nodes are never auto-connected).

A COMMAND is driven by exactly one upstream trigger — one SCREEN or one AUTOMATION, never both. The previous column's SCREEN/AUTOMATION is skipped whenever the COMMAND already has an inbound trigger, whether that's a SCREEN or AUTOMATION sitting in its own column, or a pre-existing inbound edge already in the DB (e.g. from a prior auto-connect run or a manual connection).

**Connections (both auto-connect and `set_connection`) only ever pair nodes on the same timeline** — a node in Chapter A can never be wired directly to a node in Chapter B, even when the type pair is otherwise valid (e.g. EVENT→READMODEL). No direct cross-timeline connection is possible.

**The supported workaround is a linked copy**: place a plain EVENT node into its own swimlane on the *consuming* timeline, then call `link_element` (below) to link it to the origin node. Linking means first create, then link. `eventmodeling-checking-completeness` documents how to recognize a linked copy when reading the board — it's an intentional copy, never a duplicate to clean up.

**Response**:
- `200` — `{ connected: [{edgeId, source, target, created}], skipped: [{nodeId, reason}] }`
- `404` — node not found

---

### POST `/api/org/:orgId/boards/:boardId/connections`
Create a single type-checked directed edge between two existing nodes — the REST fallback for `set_connection`.

**Request body**: `{ source: string, target: string }` (node ids)

**Response**: `200`/`201` — `{ edgeId, source, target }` on success · `400` — the pair is not one of the allowed type combinations · `404` — a node id doesn't exist

**`EVENT → READMODEL` is conditionally exempt from column ordering** — an event in a later column can connect to a read model in an earlier column, but only when that read model already feeds an AUTOMATION (i.e. a `READMODEL → AUTOMATION` edge already exists). Such an accumulator read model is a continuously-listening projection, not a point-in-time action, so it can go on collecting events from anywhere later on its timeline (e.g. a running total feeding a downstream process). A plain display read model with no automation still rejects a backward connection — wire the `READMODEL → AUTOMATION` edge first if the backward connect is rejected and you expect this exemption to apply. This exemption is deliberate-only via this endpoint — auto-connect never infers a backward `EVENT → READMODEL` pairing. Every other pair (`SCREEN → COMMAND`, `COMMAND → EVENT`, `READMODEL → SCREEN`, `READMODEL → AUTOMATION`, `AUTOMATION → COMMAND`) is always forward-only, no exceptions. If a connection you expect to work gets rejected, retry once before concluding it's blocked — a transient rejection has been observed on an otherwise-valid pair.

---

### POST `/api/org/:orgId/boards/:boardId/nodes/:nodeId/link`
Turn a node into a linked copy of `:nodeId` — the REST fallback for `link_element`. The copy receives a full copy of `:nodeId`'s meta (a replacement, not a merge) plus `meta.linkedTo`. COMMAND/EVENT/READMODEL only; `:nodeId` must not itself already be a linked copy.

**Request body** — exactly one of the two:
```typescript
{
  targetNodeId: string  // existing same-type node to convert into a linked copy
}
// or: create the copy in this same request
{
  place: {
    timelineId: string     // chapter to place the copy on
    columnIndex?: number   // columns are added to reach it
    lane?: string          // row id or label, when the chapter has several lanes of that type
    autoConnect?: boolean  // default true
  }
}
```

With `place` the copy inherits the original's element type and title, so a translation or automation chain no longer needs a `node:created` call before this one.

**Response**: `200` — `{ nodeId, linkedTo, type }`, plus `placed: { nodeId, cellName, columnIndex }` when `place` was used · `400` — neither or both of `targetNodeId`/`place`, type mismatch, self-link, unsupported element type, or the original is itself a linked copy · `404` — the original or `targetNodeId` doesn't exist

---
