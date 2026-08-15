---
name: learn-eventmodelers-api
description: Teaches an agent everything about the eventmodelers platform API — all endpoints, their purpose, request payloads, response shapes, authentication, and element types.
---

# Eventmodelers Platform API Reference

You now have complete knowledge of the eventmodelers platform API. This is a reference for *how a skill talks to the platform once you're already executing one* — it is not a license to call the API directly instead of invoking the skill that matches the user's intent (see the Skill Selection table in `CLAUDE.md`). If a prompt matches a row in that table, invoke that skill first and let it decide which endpoint/tool to call; only reach for this reference directly when no skill matches the intent at all, or when you're implementing/debugging a skill itself.

**Load this once per session, on demand — not as a mandatory preamble.** Every other skill already documents the exact API calls it needs inline; none of them require this full reference to be loaded before they can run. Reach for this skill only when you hit a specific endpoint, field, or element type that a skill's own instructions don't cover, and don't reload it again later in the same session once you have.

**Two transports exist for board operations: MCP tools (preferred) and raw REST/curl (fallback).** The `connect` skill registers the MCP server in `.mcp.json`. Once `mcp__eventmodelers__*` tools are visible in your tool list, use them — they need no `x-token`/`x-board-id`/`x-user-id` headers (auth and org resolution happen server-side from the registered token) and return the same data as the REST endpoints below. Fall back to the numbered REST sections only when MCP tools aren't connected yet, or for the handful of endpoints (prompts lifecycle, snapshots, user management, board/extension CRUD) the MCP server intentionally doesn't expose — it only covers board-content operations (nodes, timelines, slices, comments, screens). This preference is about *which transport a skill's own instructions should use*, never about whether to invoke the skill in the first place.

---

## MCP Tool Catalog (Preferred)

Server name: `eventmodelers`. Every tool takes `boardId` explicitly; none need `orgId` (resolved from the token) or `x-user-id` (the server attributes writes to the authenticated principal). REST section numbers below give the underlying implementation for tools that wrap a single endpoint 1:1.

| Tool | Args | Purpose | REST equivalent |
|---|---|---|---|
| `list_boards` | — | List boards for the org | §1 `GET /api/boards` (org-scoped) |
| `get_nodes` | `boardId`, `type?`, `name?` | List nodes, optionally by type and/or a partial case-insensitive title match | §3 `GET .../nodes` |
| `get_node` | `boardId`, `nodeId` | Get one node | §3 `GET .../nodes/:nodeId` |
| `get_node_comments` | `boardId`, `nodeId` | List comments on a node | §1 `GET .../nodes/:nodeId/comments` |
| `get_board_events` | `boardId` | All board events, in sequence | §1 `GET .../events` |
| `search_board_events` | `boardId`, `name` | Search events by node name | §1 `GET .../events/search` |
| `submit_node_events` | `boardId`, `events[]` | Create/update nodes (raw `NodeChangeEvent`/edge events) | §3 `POST .../nodes/events` |
| `delete_node` | `boardId`, `nodeId` | Delete a node. Deleting a chapter (timeline) cascades — every node placed in one of its cells, plus any node parented to it (e.g. SLICE_BORDER), is deleted too, along with all their edges | (via `node:deleted` event, §3) |
| `create_drawing` | `boardId`, `kind`, `x`, `y`, `width`, `height`, ... | Freehand canvas annotation (path/rect/text) — never placed in a cell | — (no REST equivalent; MCP-only) |
| `find_nodes_in_drawing` | `boardId`, `drawingId` | Nodes fully contained inside a drawing's bounding box | — (no REST equivalent; MCP-only) |
| `create_chapter` | `boardId`, `x?`, `y?` | Create a timeline. Omitting `x`/`y` auto-stacks it below the lowest existing chapter (by its *actual current* row-height total, not the height it was created with — safe even after `add_lane` growth), plus a fixed margin | §2 `POST .../chapters` |
| `get_chapter_bounds` | `boardId` | Absolute canvas bounding box `{id, title, x, y, width, height}` of every chapter on the board — width/height derived from each chapter's current row/column layout, not a guessed default. Use before picking explicit `x`/`y` for `create_chapter` (e.g. placing below the chapter with the largest `y + height`) to avoid overlapping one that grew since it was created | §2 `GET .../chapters/bounds` |
| `add_column` | `boardId`, `timelineId`, `index?` | Add a column | §2 `POST .../timelines/:id/columns` |
| `delete_column` | `boardId`, `timelineId`, `columnId` | Delete a column | §2 `DELETE .../columns/:columnId` |
| `add_lane` | `boardId`, `timelineId`, `type`, `label?`, `index?` | Add a lane/row | §2 `POST .../timelines/:id/lanes` |
| `remove_lane` | `boardId`, `timelineId`, `rowId` | Remove a lane | — (extends §2; no direct REST route) |
| `move_node_in_timeline` | `boardId`, `timelineId`, `movedNodeId`, `toCellId` | Move a placed node to another cell — its previous cell is automatically cleared | — (MCP-only convenience) |
| `move_timeline_structure` | `boardId`, `timelineId`, `kind` (`'column'\|'lane'`), `id`, `toIndex` | Reorder a column or lane (row) — `kind` picks which `id` refers to | — (MCP-only convenience) |
| `move_timeline_position` | `boardId`, `timelineId`, `x`, `y` | Move a chapter node on canvas | — (MCP-only convenience) |
| `drop_node_to_cell` | `boardId`, `timelineId`, `cellId`, `nodeId`, `nodeType` | Place an existing node into a cell — if it was already placed elsewhere on this timeline, that cell is automatically cleared | §2 `POST .../cells/:cellId/drop` |
| `clear_cell` | `boardId`, `timelineId`, `cellId` | Unassign the node from a cell without deleting it — the cell becomes empty and the node survives (unplaced); no-op if already empty. Use `delete_node` to remove the node entirely | — (MCP-only convenience) |
| `create_slice` | `boardId`, `timelineId`, `type`, `index?`, `nodes?: {actor?, interaction?, swimlane?}` (each `{rowId?, title?}`) | Create a full slice (column + nodes + SLICE_BORDER). `rowId` targets a specific lane when the chapter has more than one lane of that type (e.g. several actor lanes); omit to use the first matching lane | §5 `POST .../slices` |
| `create_slice_definition` | `boardId`, `timelineId`, `columnId`, `title`, `data?`, `meta?` | Create a SLICE_BORDER over an existing column | §5 `POST .../slice-definitions` |
| `place_element` | `boardId`, `timelineId`, `elementType`, `title`, `columnIndex?` | Find/create an empty cell in the right lane and place a COMMAND/READMODEL/EVENT | — (MCP-only convenience; composes §2+§3) |
| `list_slices` | `boardId` | List slices (id, title, status) | §8 `GET .../slicedata/slices` |
| `update_slice_status` | `boardId`, `sliceId`, `newStatus` | Change a SLICE_BORDER's `sliceStatus` | — (via `node:changed` event, §3) |
| `get_slice_data` | `boardId`, `contextName?`, `contextId?`, `sliceId?` | Full element graph for slices in a context | §8 `GET /slicedata` |
| `get_spec_info` | `boardId`, `timelineId` | EVENT/COMMAND/READMODEL nodes valid in GWT steps | §6 `GET .../spec-info` |
| `add_scenario` | `boardId`, `timelineId`, `columnId`, `scenarios[]` | Append GWT scenario(s) to a column's spec node | §6 `POST .../scenarios` |
| `add_storyline` | `boardId`, `timelineId`, `columnId`, `storylines[]` | **Experimental — only use when explicitly asked for a storyline/walkthrough.** Append storyline(s) (ordered, branchable beats over existing elements) to a column's spec node | §6 `POST .../storylines` |
| `set_connection` | `boardId`, `source`, `target`, `action` (`'connect'\|'remove'`) | Add or remove a type-checked directed edge | — (via `edges` on §3 events) |
| `auto_connect_node` | `boardId`, `nodeId` | Re-run auto-connect for a node | §3 `POST .../nodes/:nodeId/auto-connect` |
| `add_comment` | `boardId`, `nodeId`, `text`, `type?` (`'COMMENT'\|'TASK'\|'QUESTION'`), `author?` | Add a comment — `QUESTION` flags gaps/edge cases during review | — (via comment events) |
| `update_comment` | `boardId`, `nodeId`, `commentId`, `action` (`'resolve'\|'delete'`) | Resolve or delete a comment | — (via comment events) |
| `create_screen` | `boardId`, `contentType` (`'image'\|'sketch'\|'html'`), `nodeId?`, `chapterId`, `cellId?`/`cellName?`, plus content fields (`imageBase64`/`mimeType`, `elements[]`, or `pages[]`/`backgroundColor`), `description?` | Create + place a new screen node (SCREEN or HTML_SCREEN) atomically, in one call | §4 `POST .../images/:id/sketch` + `image-nodes` |
| `render_screen` | `boardId`, `nodeId`, `elements[]?` (SCREEN) or `pages[]?`+`backgroundColor?` (HTML_SCREEN), `description?` | Update an existing screen's content — exactly one of `elements`/`pages` | §4 `POST .../images/:id/sketch` + `image-nodes` |
| `add_field_examples` | `boardId`, `nodeId?`, `name?`, `cellName?`, `timelineId?` | Fill empty field examples using linked-node context | — (MCP-only convenience) |
| `get_attribute_chain` | `boardId`, `timelineId`, `targetCellName`, `sourceCellName` | Resolve every node between two cells, ordered target→source | — (MCP-only convenience) |
| `verify_screen` | `boardId`, `nodeId` | Check a screen node exists and has rendered content — works for both SCREEN and HTML_SCREEN, dispatching on the node's actual type | — (MCP-only convenience) |
| `get_image_snapshot_description` | `boardId`, `nodeId` | Load the `{elements:[...]}` sketch description from storage | — (reads what §4 sketch endpoints write) |
| `validate_slice_data` | `sliceData` | Offline validation of a `SliceDataOutput` payload — no board access | — (MCP-only, pure function) |
| `commit_board_to_git` | `boardId` | Force a git-extension commit/push, bypassing the autoCommit gate | — (MCP-only; git extension) |
| `update_prompt_status` | `promptId`, `newStatus`, `comment?` | Update a prompt's lifecycle status (`ADDED`/`CLAIMED`/`IN_PROGRESS`/`DONE`), optionally with a progress comment. Not board-scoped — no `boardId` arg; the prompt's board is resolved server-side. | §14 `POST .../prompts/:id/status` |

**Not exposed via MCP at all** — always use REST/curl for these: §7 Config Import, §10 Snapshots, §11–12 User Management, §13 Utility (`/api/user`, swagger), and the rest of §14 Prompts (submission, claiming, deletion, realtime-token) — only the status-update endpoint has an MCP tool (`update_prompt_status`, used by the `update-prompt-status` skill); everything else in Prompts is an intentionally separate lifecycle the board-content MCP server doesn't otherwise own.

**Capabilities with no direct MCP filter** — e.g. REST's `GET .../nodes?cellId=<id>` (§3) has no `cellId` param on `get_nodes`. Get the same answer by calling `get_node` on the CHAPTER and reading `meta.timelineData.cells` (sparse array; a cell absent from it is empty) instead of asking the server to filter by cell.

---

## Architecture Overview

- **Framework**: Express.js + `@event-driven-io/emmett` (event sourcing)
- **Adapter**: `@event-driven-io/emmett-expressjs`
- **Database**: PostgreSQL via Knex
- **Storage / Auth**: Supabase
- **Route discovery**: Dynamic glob (`**/routes{,-*}.js`) loaded from `dist/src/slices`
- **Base URL** (local): `http://localhost:3000`

---

## Authentication & Headers

| Header | Required | Purpose |
|---|---|---|
| `Authorization` | Some routes | Supabase JWT bearer token |
| `x-user-id` | Node operations | User identifier |
| `x-causation-id` | Optional | Event causation tracing |
| `x-correlation-id` | Optional | Correlation tracing |

- CORS allowed origins: `localhost:3000`, `localhost:3001`, `https://app.eventmodelers.ai`

---

## Element Types

```typescript
MODEL_CONTEXT  // Context/domain modeling container
CHAPTER        // Timeline/sequence container — a "chapter" IS a timeline (chapterId === timelineId); the terms are used interchangeably across the API
ACTOR          // System participant (swimlane label)
AUTOMATION     // Automated action
API            // External service
SCREEN         // UI screen
COMMAND        // State-changing operation
EVENT          // Domain event
SPEC_ERROR     // Error scenario
TABLE          // Data table
READMODEL      // Query result / materialized view
SCENARIO       // GWT scenario
LANE           // Timeline row
SLICE_BORDER   // Slice boundary marker
```

---

## Field Types

Every field on a `COMMAND`, `EVENT`, `READMODEL`, `SCREEN`, or `TABLE` element (`meta.fields[]`) has a `type` from this exact set — the canonical source is the [event-modeling-spec schema](https://github.com/dilgerma/event-modeling-spec/blob/main/eventmodeling.schema.json) (`$defs.Field.properties.type`):

```typescript
String     // text
Boolean    // true / false
Int        // 32-bit integer
Long       // 64-bit integer
Double     // floating-point number
Decimal    // precise fixed-point number — prefer this over Double for money/currency
Date       // calendar date only, no time component (e.g. "2026-06-01")
DateTime   // date + time, ISO 8601 (e.g. "2026-06-01T09:00:00Z")
UUID       // universally unique identifier
Custom     // structured/nested value — use with `subfields` or `schema`
```

Other `Field` properties: `name`, `example`, `subfields[]` (nested `Field`s), `mapping`, `optional`, `technicalAttribute`, `generated`, `idAttribute`, `pii`, `schema`, `cardinality` (`"List"` | `"Single"`).

Use exactly these type names (case-sensitive) — not lowercase (`string`), synonyms (`Number`, `Text`, `Integer`), or types outside this set.

---

## Standard HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | OK with data |
| 201 | Created |
| 204 | No content |
| 400 | Validation error / bad input |
| 401 | Authentication required |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate) |
| 500 | Server error |

---

## 1. Boards

**File**: `src/slices/change/api-boards/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/events`
Persist board/timeline row events as an array of mixed event types.

**Request body**: Array of node, comment, edge, or board events  
**Response**: `200` — processed results array

---

### GET `/api/boards`
List all boards.

**Response**: `200` — `Board[]`

---

### DELETE `/api/org/:orgId/boards/:boardId`
Delete a board.

**Response**: `204`

---

### GET `/api/org/:orgId/boards/:boardId/events/search`
Search events by node name.

**Query params**: `name` (string)  
**Response**: `200` — matching event array

---

### GET `/api/org/:orgId/boards/:boardId/events`
Get all board events in sequence.

**Response**: `200` — event array

---

### GET `/api/org/:orgId/boards/:boardId/nodes/:nodeId/comments`
Get all comments for a node.

**Response**: `200` — comment array

---

### POST `/api/org/:orgId/boards/:boardId/bucket`
Create a Supabase storage bucket for the board.

**Response**: `200` — `{ ok: boolean, bucket: string, alreadyExisted: boolean }`

---

## 2. Chapters & Timelines

**File**: `src/slices/change/api-chapters/routes.ts`

A "chapter" is a timeline — the same entity, referenced as `chapterId` in node/placement payloads and as `:timelineId` in the column/lane/cell routes below.

### POST `/api/org/:orgId/boards/:boardId/chapters`
Create a chapter node.

**Request body**: `{ position?: { x: number, y: number } }`  
**Response**: `200` — chapter data

Omitting `position` auto-stacks the new chapter below the lowest existing chapter on the board, using each existing chapter's *actual current* row-height total (not the height it was created with) plus a fixed margin — so a chapter that grew via `add_lane`/`add_column` after another was stacked below it won't get overlapped by yet another auto-stacked chapter.

---

### GET `/api/org/:orgId/boards/:boardId/chapters/bounds`
Get the absolute canvas bounding box of every chapter on the board — the same real-current-size derivation `create_chapter`'s auto-stacking uses internally, exposed for callers who want to compute a placement themselves (e.g. an explicit `x`/`y`, or a position relative to a specific chapter rather than "below everything").

**Response**: `200` — `{ chapters: Array<{ id: string, title?: string, x: number, y: number, width: number, height: number }> }`

---

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/columns`
Add a column to a timeline.

**Request body**: `{ index?: number }` (integer index, optional)  
**Response**: `200` — `{ columnId: string, index: number, totalColumns: number }`

---

### DELETE `/api/org/:orgId/boards/:boardId/timelines/:timelineId/columns/:columnId`
Delete a column from a timeline. Removes the column and all its cells. Cannot delete the last column.

**Response**:
- `200` — `{ columnId: string, totalColumns: number }`
- `400` — validation error (e.g. last column)
- `404` — timeline or column not found

---

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/lanes`
Add a lane (row) to a timeline.

**Request body**:
```typescript
{
  type: 'actor' | 'interaction' | 'swimlane' | 'spec' | 'feedback'
  label?: string
  index?: number
  height?: number
}
```
**Response**: `200` — lane data

---

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/cells/:cellId/drop`
Drop a node into a timeline cell. Validates placement rules. If the node was already placed in another cell on this timeline, that cell is automatically cleared as part of the same operation — a node can only ever occupy one cell.

**Request body**: `{ nodeId: string, nodeType: ElementType }`

**Placement rules**:
- `swimlane` lane → accepts `EVENT`
- `interaction` lane → accepts `COMMAND`, `READMODEL`
- `actor` lane → accepts `SCREEN`, `AUTOMATION`
- `feedback` lane → accepts markdown
- `spec` lane → accepts `SPEC_NODE`

**Response**:
- `200` — drop result
- `400` — placement violation
- `404` — cell or node not found

---

## 3. Nodes

**File**: `src/slices/change/api-nodes/routes.ts`

All node endpoints require header: `x-user-id`

### POST `/api/org/:orgId/boards/:boardId/nodes/events`
Submit node change events.

Any `node:created` event carrying a `chapterId` plus `cellId`/`cellName` (i.e. placing a node on a timeline) also triggers a best-effort, fire-and-forget auto-connect to type-compatible neighbors — same rules as the auto-connect endpoint below. Failures there never fail this call.

A `node:deleted` event cascades: if the deleted node is a chapter (timeline), every node placed in one of its cells and any node parented to it (e.g. a SLICE_BORDER spanning one of its columns) is deleted too, along with all their edges.

**Request body**: `NodeChangeEvent[]`

```typescript
interface NodeChangeEvent {
  id: string                    // uuid
  eventType: 'node:created' | 'node:changed' | 'node:deleted'
  nodeId: string
  boardId: string
  timestamp: number             // unix ms
  userId?: string
  hash?: string                 // content hash
  changedAttributes?: string[]  // dot-paths e.g. 'meta.title'
  node?: {
    id: string
    data: {
      backgroundColor?: string
      title?: string
      url?: string
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

**Query params**: `type?: ElementType`  
**Response**: `200` — node record array

---

### GET `/api/org/:orgId/boards/:boardId/nodes/:nodeId`
Get a single node.

**Response**: `200` — node record OR `404`

---

### POST `/api/org/:orgId/boards/:boardId/nodes/:nodeId/auto-connect`
Auto-connect a node to its timeline neighbors — mirrors the frontend's auto-connect-on-place behavior. Looks only at the node's own timeline column and the previous column (never ahead), and creates `edge:added` events to every type-compatible neighbor found there, using the same pairing rules as connections created via node events (COMMAND→EVENT, SCREEN→COMMAND, EVENT→READMODEL, READMODEL→SCREEN, READMODEL→AUTOMATION, AUTOMATION→COMMAND). A COMMAND is not wired to the previous column's SCREEN if its own column already has one.

Incompatible or already-connected neighbors are reported in `skipped`, not an error. Returns an empty result for nodes not placed on any timeline, or not a connectable element type (e.g. SCENARIO/spec nodes are never auto-connected).

**Response**:
- `200` — `{ connected: [{edgeId, source, target, created}], skipped: [{nodeId, reason}] }`
- `404` — node not found

---

## 4. Images

**File**: `src/slices/change/api-images/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/images/:imageId`
Update a board image.

**Request**: `multipart/form-data` — field `file` (binary)  
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/imagesnapshots/:imageId`
Update an image snapshot.

**Request**: `multipart/form-data` — field `file` (binary)  
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/image-nodes/:nodeId`
Create an image node.

**Request**: `multipart/form-data` — fields: `file`, `chapterId`, `cellName`  
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/images/:imageId/sketch`
Render a sketch description to WebP and upload.

**Request body**:
```typescript
{
  elements: object[]           // sketch element descriptors
  semanticDescription?: string // human-readable description stored in metadata
}
```
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/image-nodes/:nodeId/sketch`
Create a SCREEN node from a sketch description.

**Request body**:
```typescript
{
  chapterId: string
  cellName: string
  description: { elements: object[] }
  semanticDescription?: string
}
```
**Response**: `204` OR `400` (validation error)

---

## 5. Slices

**File**: `src/slices/change/api-.slices/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/slices`
Create a complete slice (1 column + 3 nodes automatically placed).

**Request body**:
```typescript
{
  type: 'state-change' | 'state-view' | 'automation'
  index?: number
  nodes?: {
    actor?: Partial<NodeData> & { rowId?: string }
    interaction?: Partial<NodeData> & { rowId?: string }
    swimlane?: Partial<NodeData> & { rowId?: string }
  }
}
```

**Slice node mapping**:
- `state-change` → HTML_SCREEN (actor) + COMMAND (interaction) + EVENT (swimlane)
- `state-view` → HTML_SCREEN (actor) + READMODEL (interaction) + EVENT (swimlane)
- `automation` → AUTOMATION (actor) + COMMAND (interaction) + EVENT (swimlane)

Each chapter has exactly one actor/interaction/swimlane lane by default, but a chapter can have several lanes of the same type (e.g. multiple actor lanes). Without a `rowId`, the node is always placed in the **first** lane of the matching type — pass `nodes.<actor|interaction|swimlane>.rowId` (a row id from the chapter's `timelineData.rows`) to target a specific lane instead. An invalid `rowId` (not found, or found but the wrong lane type) is a `400 ROW_NOT_FOUND`/`ROW_TYPE_MISMATCH` error.

The actor HTML_SCREEN is created as a **stub** — a single visibly-placeholder page ("Untitled screen — design pending") unless `nodes.actor.pages` is passed explicitly. Whoever calls this (the `add-next-slice` skill — the one that creates a brand-new slice from scratch, as opposed to `eventmodeling-slicing-event-models`, which only makes existing elements explicit) is responsible for immediately replacing that stub via the `html-screen` skill — including gathering the board's existing screens first so the new one matches their established style, since `html-screen` itself has no visibility into other screens.

**Response**: `200` — slice data

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/slice-definitions`
Create a standalone SLICE_BORDER node spanning an **existing** column. Unlike the endpoint above, this does not add a column or any actor/interaction/swimlane content nodes — the column must already exist (e.g. created via `POST .../slices` or the column API) and is referenced by `columnId`.

**Request body**:
```typescript
{
  columnId: string   // id of an existing column on this timeline
  title: string      // slice title — always taken from this field, never derived
  data?: Record<string, unknown>   // optional node.data payload
  meta?: Record<string, unknown>   // optional extra meta fields (type, colId, title are always set explicitly and cannot be overridden here)
}
```

**Response**: `200` — `{ nodeId, timelineId, columnId, title }`
**Errors**: `400` missing `columnId`/`title` or column not found · `404` timeline not found

---

## 6. Specifications (GWT Scenarios)

**File**: `src/slices/change/api-specs/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/contexts/:contextName/slices/:sliceName/scenarios`
Append a Given-When-Then scenario to a spec node.

**Request body**:
```typescript
{
  id: string
  title: string
  vertical?: boolean
  examples?: unknown[]
  given: string[]   // nodeIds — must be EVENTs from same timeline
  when: string[]    // nodeIds — at most one COMMAND; empty if then has READMODEL
  then: string[]    // nodeIds — EVENTs only OR exactly one READMODEL (not mixed)
}
```

**Validation rules**:
- `given`: only EVENTs from same timeline
- `when`: max one COMMAND; must be empty when `then` contains a READMODEL
- `then`: all EVENTs OR exactly one READMODEL — never mixed
- All referenced nodes must belong to the same chapter/timeline

**Response**:
- `201` — `{ scenario, scenarios, specNodeId, isNewNode: boolean }`
- `400` — validation error
- `404` — context or slice not found
- `409` — duplicate scenario title

---

### GET `/api/org/:orgId/boards/:boardId/contexts/:contextName/spec-info`
Get valid elements for a context (by name lookup).

**Response**: `200` — `{ chapterId: string, elements: ElementRecord[] }`

---

### GET `/api/org/:orgId/boards/:boardId/contexts/:contextName/slices/:sliceName/spec-info`
Get valid elements for a specific slice.

**Response**: `200` — `{ chapterId: string, elements: ElementRecord[] }`

---

### Storylines (experimental)

> **Only create a storyline when the user's request explicitly asks for one** — the word
> "storyline", "walkthrough", or "narrative" (or equivalent) must appear in what they asked for.
> Otherwise keep creating normal GWT scenarios via `add_scenario`/`POST .../scenarios` as before.

An ordered, branchable walkthrough of existing board elements ("beats"), stored alongside GWT
scenarios on the same SCENARIO spec node, in a sibling `meta.storylines` collection.

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/columns/:columnId/storylines`
Append one or more storylines to a column's spec node. The spec node is auto-created if missing
(shared with scenarios).

**Request body**: a single storyline object or an array:
```typescript
{
  id: string
  title: string          // must be unique within the spec node
  description?: string
  layout?: 'horizontal' | 'vertical'
  beats: Array<{
    instanceId: string   // unique per beat, even when refId repeats
    refId: string        // board node id — must belong to the same timeline
    type?: string
    title?: string
    isError?: boolean    // marks an alternate/error branch off the previous beat
    fields?: unknown[]
    expectEmptyList?: boolean
    exampleMode?: string
    examples?: unknown[]
  }>
}
```

**Response**:
- `201` — `{ specNodeId, storylines, added, isNewNode }`
- `400` — validation error
- `404` — timeline, column, or referenced node not found
- `409` — duplicate storyline title

---

## 7. Config Import

**File**: `src/slices/change/config-import/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/import-config`
Import an EventModelingJson config to populate a board.

**Request**: `multipart/form-data` with field `file` OR `application/json` body:
```typescript
{ slices: SliceDefinition[] }
```

**Response**: `200` — transformed canvas with nodes and edges

---

## 8. Slice Data

**File**: `src/slices/slicedata/routes.ts`

### GET ` `
Build structured slice data from board state.

**Query params** (one required): `contextId` OR `contextName`; optional: `sliceId`  
**Response**: `200` — slice data matching event modeling schema

---

### GET `/api/org/:orgId/boards/:boardId/slicedata/slices`
List all slices on a board.

**Response**: `200` — `{ slices: Array<{ id: string, title: string, status: string }> }`

---

## 9. Extensions

**File**: `src/slices/extensions/routes.ts`

### GET `/api/org/:orgId/boards/:boardId/extensions`
List extension configs for a board.

**Response**: `200` — extension record array

---

### PUT `/api/org/:orgId/boards/:boardId/extensions/:type`
Enable or disable an extension.

**Request body**: `{ enabled: boolean, config?: object }`  
**Response**: `200` — updated extension config

---

## 10. Snapshots

**File**: `src/slices/Snapshots/routes.ts`

All snapshot endpoints require Supabase JWT authentication.

**Constraints**: max 3 snapshots per user, max 30-day retention, max 50 MB file size.

### GET `/api/snapshots`
List current user's snapshots.

**Response**: `200` — `Array<{ id, name, payload_id, expiry, shared }>`

---

### POST `/api/snapshots`
Create a snapshot.

**Request**: `multipart/form-data` — fields: `payloadFile` (binary), `name` (string), `retention?` (days, max 30)  
**Response**: `201` — `{ ok: true, id: string }`

---

### GET `/api/snapshots/:id`
Load a snapshot's payload.

**Response**: `200` — snapshot payload JSON

---

### PATCH `/api/snapshots/:id/share`
Share a snapshot (makes it publicly accessible).

**Response**: `200` — `{ ok: true }`

---

### DELETE `/api/snapshots/:id`
Delete a snapshot.

**Response**: `200` — `{ ok: true }`

---

## 11. User Management — Commands (Event Sourced)

All commands respond with:
```typescript
{
  ok: true
  next_expected_stream_version: number
  last_event_global_position: number
}
```

Optional headers on all: `correlation_id`, `causation_id`

### POST `/api/creategroup`
**Body**: `{ groupId: string, name: string }`  
**Event emitted**: `GroupCreated`

---

### POST `/api/inviteuser`
**Body**: `{ groupId: string, email: string, invitationId: string }`  
**Event emitted**: `UserInvited`

---

### POST `/api/acceptinvite`
**Body**: `{ userId: string, groupId: string, invitationId: string }`  
**Event emitted**: `InvitationAccepted`

---

### POST `/api/assignrole`
**Body**: `{ userId: string, groupId: string, role: string }`  
**Event emitted**: `RoleAssigned`

---

## 12. User Management — Read Models (Projections)

All require authentication. Optional query param `_id` to filter by ID.

### GET `/api/query/group-details-lookup`
Group details. Filter: `?_id=groupId`

### GET `/api/query/open-invites`
Pending invitations. Filter: `?_id=invitationId`

### GET `/api/query/user-group-assignments`
User-to-group mappings. Filter: `?_id=groupId`

### GET `/api/query/users-to-assign-to-groups`
Users available for group assignment. Filter: `?_id=userId`

---

## 13. Utility

### GET `/api/user`
Get current authenticated user info.

**Response**: `{ user_id: string, email: string, metadata: object }`

### GET `/api-docs`
Swagger UI (interactive API explorer)

### GET `/swagger.json`
OpenAPI specification (JSON)

---

## 14. Prompts

**File**: `src/slices/change/api-prompts/routes.ts`

Prompts are how a human submits work to a modeling agent from the board UI, and how that agent reports its lifecycle back onto the board. Every prompt row has a `status`: `ADDED` (submitted, default) → `CLAIMED` (an agent has picked it up) → `IN_PROGRESS` (an agent is actively working it) → `DONE` (finished). See the `update-prompt-status` skill for the agent-side half of this lifecycle.

### POST `/api/org/:orgId/prompts`
Submit a prompt for a board timeline. Auth: Supabase JWT (`Authorization: Bearer`).

**Request body**:
```typescript
{
  prompt: string
  board_id: string
  timeline_id: string
  node_id?: string
  comment_id?: string
  priority?: boolean          // default false
  context?: {                 // optional canvas-selection context for the agent to use
    selectedCell?: object | null
    selectedNodes?: string[]
  }
}
```

**Response**: `201` — the created row, `status: "ADDED"`.
**Errors**: `400` missing required fields or malformed `context` · `403` no access to board · `404` board/timeline not found or no API token configured for the org

---

### GET `/api/org/:orgId/prompts/next`
Claim the next pending (`ADDED`) prompt for a board — atomically flips it to `CLAIMED` and returns it. This is what a running modeling agent's warm loop polls. Auth: `x-token` **and** a Supabase JWT (`Authorization: Bearer`) together.

**Query params**: `board_id` (required)
**Response**: `200` — the claimed row (now `status: "CLAIMED"`) · `404` — no `ADDED` prompts available

---

### POST `/api/org/:orgId/prompts/:id/status`
Set a prompt's status, optionally attaching a progress comment. Auth: `x-token` only (bot token — no user JWT needed, this is meant to be called directly by the agent working the prompt).

**Prefer MCP**: `mcp__eventmodelers__update_prompt_status { "promptId": "<id>", "newStatus": "IN_PROGRESS", "comment": "..." }` — no `orgId`/`x-token` needed, same validation and response shape. Fall back to the curl below only when MCP tools aren't connected.

**Request body**:
```typescript
{
  status: 'ADDED' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE'
  comment?: string   // shown alongside the prompt in the board UI
}
```

**Response**: `200` — the updated row
**Errors**: `400` invalid/missing `status` · `403` token not for this prompt's org · `404` prompt not found

---

### DELETE `/api/org/:orgId/prompts/:id`
Delete a prompt outright. Auth: `x-token` only. Manual/admin cleanup — not part of the normal agent lifecycle (use the status endpoint above instead).

**Response**: `204` · `404` prompt not found

---

### DELETE `/api/org/:orgId/prompts/:id/user`
Delete a prompt you submitted yourself. Auth: Supabase JWT — only deletes rows owned by the calling user.

**Response**: `204` · `404` prompt not found or not yours

---

### GET `/api/org/:orgId/prompts/realtime-token`
Exchange an `x-token` for a short-lived Supabase-compatible JWT, used to subscribe to the org's realtime channel for live prompt notifications. Auth: `x-token` only.

**Response**: `200` — `{ token: string }`

---

## Domain Events

### Snapshot Events (`src/events/SnapshotsEvents.ts`)

```typescript
SnapshotStored          // { name, id, payloadId, expiry }
SnapshotDeleted         // { id }
SnapshotCleanedUp       // { id }
PublishedSnapshotDeleted // { id }
SnapshotShared          // { id }
SnapshotPublished       // { id, payloadId, bucket, path }
```

### User Management Events (`src/events/UserManagementEvents.ts`)

```typescript
GroupCreated          // { groupId, owner, name }
UserAssignedToGroup   // { groupId, userId }
UserInvited           // { groupId, invitationId, email }
InvitationAccepted    // { invitationId, groupId, userId }
RoleAssigned          // { groupId, userId, role }
```

All events support optional metadata: `user_id`, `correlation_id`, `causation_id`

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/slices/change/types.ts` | `ElementType`, `NodeChangeEvent`, `EdgeEvent` |
| `src/slices/change/api-boards/routes.ts` | Board CRUD + event persistence |
| `src/slices/change/api-chapters/routes.ts` | Chapters, columns, lanes, cell drops |
| `src/slices/change/api-nodes/routes.ts` | Node event sourcing |
| `src/slices/extensions/supabase/nodes/AutoConnectNode.ts` | Auto-connect logic (timeline neighbor wiring) |
| `src/slices/change/api-images/routes.ts` | Image upload + sketch rendering |
| `src/slices/change/api-prompts/routes.ts` | Prompt submission, claiming, and status lifecycle |
| `src/slices/change/api-.slices/routes.ts` | Slice creation + slice definitions (SLICE_BORDER) |
| `src/slices/extensions/supabase/slices/CreateSliceDefinition.ts` | Slice definition (SLICE_BORDER) creation logic |
| `src/slices/change/api-specs/routes.ts` | GWT scenario management |
| `src/slices/change/config-import/routes.ts` | Config import |
| `src/slices/slicedata/routes.ts` | Slice data read models |
| `src/slices/extensions/routes.ts` | Extension management |
| `src/slices/Snapshots/routes.ts` | Snapshot CRUD |
| `src/slices/usermanagement/*/routes*.ts` | User management commands + projections |
| `src/events/SnapshotsEvents.ts` | Snapshot domain events |
| `src/events/UserManagementEvents.ts` | User management domain events |
| `backend/src/server.ts` | Route wiring, CORS, `/api/user` |
