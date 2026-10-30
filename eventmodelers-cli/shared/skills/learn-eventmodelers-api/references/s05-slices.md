## 5. Slices

**File**: `src/slices/change/api-.slices/routes.ts`

**One slice border per column.** Every node write (`/nodes/events`, MCP tools, the web UI) rejects a `SLICE_BORDER` whose `colId` — read from `meta.colId` or `node.data.colId` — already belongs to another `SLICE_BORDER` on the board, with `SLICE_BORDER_EXISTS` (`context.existingSliceBorderId` names the border to update or delete instead). Re-sending the same border, or creating a new one after the old one was deleted, is fine. Slice reads (`slicedata`) only ever return one slice per column, so a second border would otherwise exist on the board yet read back as an empty slice.

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/slices`
Create a complete slice (1 column + its nodes automatically placed).

**Request body**:
```typescript
{
  type: 'state-change' | 'state-view' | 'automation'
  index?: number
  nodes?: {
    actor?: Partial<NodeData> & { rowId?: string, fields?: FieldDef[] }
    interaction?: Partial<NodeData> & { rowId?: string, fields?: FieldDef[] }
    swimlane?: Partial<NodeData> & { rowId?: string, fields?: FieldDef[] }
  }
  status?: 'Created' | 'Ready' | 'Planned' | 'InProgress' | 'Waiting' | 'Review' | 'Done' | 'Blocked' | 'Assigned' | 'Informational'
}
```

`fields` writes that node's attributes in the same call, and `status` gives the SLICE_BORDER its `sliceStatus` on creation — neither needs a follow-up write.

**Slice node mapping**:
- `state-change` → HTML_SCREEN (actor) + COMMAND (interaction) + EVENT (swimlane)
- `state-view` → HTML_SCREEN (actor) + READMODEL (interaction) + EVENT (swimlane, **only when `nodes.swimlane` is passed**)
- `automation` → AUTOMATION (actor) + COMMAND (interaction) + EVENT (swimlane)

A `state-view`'s read model is normally fed by an event that already exists in an earlier column, so its event is opt-in: pass `nodes.swimlane` (an empty object is enough) to have one created, omit it to mean "an existing event feeds this". When omitted, the response has no `nodes.swimlane` and auto-connect wires the read model to the type-compatible event in the previous column — previously an untitled EVENT was placed in the slice's swimlane slot, which then had to be removed with `delete_node`. A `state-change`/`automation` event is the slice's own output and is always placed. The endpoint never creates a lane: a chapter with no swimlane lane yields a slice without an event rather than an error.

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
  status?: 'Created' | 'Ready' | 'Planned' | 'InProgress' | 'Waiting' | 'Review' | 'Done' | 'Blocked' | 'Assigned' | 'Informational'
  data?: Record<string, unknown>   // optional node.data payload
  meta?: Record<string, unknown>   // optional extra meta fields (type, colId, title are always set explicitly and cannot be overridden here)
}
```

**Response**: `200` — `{ nodeId, timelineId, columnId, title, status? }` — `status` sets `sliceStatus` straight away, instead of a follow-up `update_slice_status`
**Errors**: `400` missing `columnId`/`title` or column not found · `404` timeline not found

---
