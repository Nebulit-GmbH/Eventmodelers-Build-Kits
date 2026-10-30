## 2. Chapters & Timelines

**File**: `src/slices/change/api-chapters/routes.ts`

A "chapter" is a timeline — the same entity, referenced as `chapterId` in node/placement payloads and as `:timelineId` in the column/lane/cell routes below.

### POST `/api/org/:orgId/boards/:boardId/chapters`
Create a chapter node.

**Request body**:
```typescript
{
  position?: { x: number, y: number }
  title?: string      // names the chapter on creation — no follow-up rename
  columns?: number    // initial column count, default 3
  lanes?: Array<{ type: 'actor'|'interaction'|'swimlane'|'spec'|'feedback'|'table', label?: string, height?: number }>
}
```

**Response**: `200` — `{ id, eventId, columnIds: string[], lanes: Array<{id, type, label}> }`

`lanes` replaces the default Actor/Interaction/Swimlane/Spec set — this is how a chapter gets lanes named after what they hold, or several lanes of one type (one swimlane per context), without an `add_lane` call per lane. They are sorted into the required order (actor → interaction → swimlane → spec → feedback/table) automatically, keeping the given order within a type, so no ordering error is possible. Every column id and lane id comes back in the response — don't re-read the chapter just to place something into it.

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
Add one or more lanes (rows) to a timeline.

**Request body**:
```typescript
{
  type: 'actor' | 'interaction' | 'swimlane' | 'spec' | 'feedback' | 'table'
  label?: string
  index?: number
  height?: number
}
// or, batch form — every lane added in one request, applied in order:
[ { type: 'interaction', label: 'Interaction' }, { type: 'swimlane', label: 'Ordering' } ]
```
**Response**: `200` — lane data, or `{ lanes: [...] }` for the batch form

For a chapter that doesn't exist yet, pass `lanes` to `POST .../chapters` instead — that needs no lane call at all.

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

### Feedback lanes and MARKDOWN nodes (free-text notes)

A chapter has no `feedback` lane by default — add one first via the lanes endpoint above (`{"type": "feedback", "label": "Notes"}`), which returns a `laneId`. This is a normal row in `meta.timelineData.rows` (`type: "feedback"`) alongside `actor`/`interaction`/`swimlane`/`spec`.

Place a free-text markdown note in that lane the same way any other node is placed — a plain `node:created` event through `POST .../nodes/events` (§3), **not** the cell-drop endpoint above. `cellId` is `"<feedbackRowId>-<columnId>"`, same convention as every other lane:

```json
{
  "id": "<event-uuid>",
  "eventType": "node:created",
  "nodeId": "<node-uuid>",
  "chapterId": "<chapterId>",
  "cellId": "<feedbackRowId>-<columnId>",
  "meta": {
    "type": "MARKDOWN",
    "title": "Modeling Reasoning — <Chapter Name>",
    "description": "# Heading\n\nFull markdown body here — headings, lists, bold, etc. all render."
  }
}
```

The node's content lives in `meta.description` (a plain string of markdown source) — **not** `meta.content`; that field is silently accepted and stored but never rendered, producing a visibly empty note. There is no `fields[]` array on this element type, and no separate render/sketch call is needed (unlike SCREEN/HTML_SCREEN). `node.type` comes back as `"markdown"` (lowercase) on read.

### Linking to elements in markdown: `ref:<nodeId>`

Any markdown the app renders can point at an element on the board. Clicking the link zooms the canvas to that element. This works in MARKDOWN notes, element `meta.description`s (doc view and slice view) and timeline info notes.

| Write | Renders as |
|-------|------------|
| `ref:<nodeId>` | the element's **current** title, so it stays right after a rename. Use this one by default. |
| `[Visit Booked](ref:<nodeId>)` | your own label, for a different wording or a phrase in a sentence |

```markdown
| # | Decision | Element(s) |
|---|----------|------------|
| 1 | Insert into `visits` → event | ref:3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab |
```

- `<nodeId>` is the full node uuid, taken from a read or from your own `node:created`. Never make one up: an id that isn't on the open board renders as a greyed-out `ref:3f2b8c1e…` link.
- A slice can be linked through its slice border's node id.
- Write it as a separate word (`see ref:<id>`, not `xref:<id>`). Inside backticks or code blocks it stays plain text.
- Use it only where the app renders markdown. Chat message `text` is plain text, so use a snippet's `nodeId` there (`link`, `tasks`, `changes`). Comments are plain text too.

---
