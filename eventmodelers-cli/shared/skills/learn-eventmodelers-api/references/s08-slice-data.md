## 8. Slice Data

**File**: `src/slices/slicedata/routes.ts`

### GET `/api/org/:orgId/boards/:boardId/slicedata`
Build structured slice data from board state.

**Query params**:
- `contextId` OR `contextName` (one required) — a MODEL_CONTEXT node, or a timeline name (a timeline with no assigned/connected context scopes to that timeline alone).
- `sliceId?` — one slice only.
- `sliceIds?` — comma-separated slice ids: just these slices, in ONE call (never one call per slice). Without `projection` each comes with its fields and its specs. An unknown id is `404 SLICE_NOT_FOUND`. Omit for every slice. (MCP `get_slice_data`: `sliceIds` is an array.)
- `projection?: "outline" | "fields" | "specs"` — `outline` = slice header + every element list as `{id, title, type}` (no fields, specs, comments); `fields` = header + elements with their fields and dependencies, plus actors and aggregates (no specs, storylines, comments, prompts, notes); `specs` = header + specifications and storylines, no elements. Omit for the full graph.
- `format?: "json" | "yaml" | "textual" | "toon" | "emlang" | "esdm"` (default `json`). `outline` and `specs` encode only as `json`, `yaml` or `toon`; `fields` works with every format.

**Response**: `200` — slice data matching event modeling schema, in the requested format. `400` — no context given, unsupported format, `PROJECTION_INVALID`, or `PROJECTION_FORMAT_UNSUPPORTED` (`outline`/`specs` with `textual`/`emlang`/`esdm`). `404` — no context or timeline matches, or `SLICE_NOT_FOUND` (unknown `sliceId`).

---

### Slice features (`features`)

A slice can belong to one or more **features** — free-text names such as `Seat reservation` that group slices across chapters (the people on the board see them in the Features list in the toolbar, where picking one fades every column that isn't part of it). They live on the slice's SLICE_BORDER as `meta.features`, an array of strings.

- **Read**: the slice data of a slice carries `features` (omitted when it has none), next to `ticketNumber` and `assignee`.
- **Use**: treat `features` as context — slices sharing a feature belong together, so when a build touches shared concepts, look at the sibling slices of the same feature before inventing a new name or shape. It never changes what a slice must do, and an empty list is normal.
- **Set** (only when the user asks you to group slices): a `node:changed` event on the SLICE_BORDER, same shape as the status update. Send the **whole** list — it replaces the old one — and reuse an existing feature's exact spelling instead of adding a near-duplicate (`Booking` vs `booking`; the board treats them as one, but keep them tidy):

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: <TOKEN>" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:changed",
    "nodeId": "<SLICE_NODE_ID>",
    "changedAttributes": ["features"],
    "meta": { "type": "SLICE_BORDER", "features": ["Seat reservation"] }
  }]'
```

---

### GET `/api/org/:orgId/boards/:boardId/slicedata/slices`
List all slices on a board.

**Query params**: `contextName?` — restrict to slices of this MODEL_CONTEXT (or timeline) name.

**Response**: `200` — `{ slices: Array<{ id: string, title: string, status: string }> }`. `404` — `CONTEXT_NOT_FOUND` (an unknown `contextName` is an error, not an empty list).

---

### GET `/api/org/:orgId/boards/:boardId/reporting/rework/contexts/:contextId`
**File**: `src/slices/change/reporting/rework/routes.ts`

How much each slice of one context has been reworked — read-only, derived from the board event log; nothing is stored
for it.

A slice's rework is read from its own SLICE_BORDER history. Going backwards means a step down the progress order
(Created → Ready → Planned → Assigned → InProgress → Waiting → Review → Done), or reaching `Blocked` from
`Waiting`/`Review`/`Done`;
`Informational` is never scored. `reopens` counts transitions leading away from `Done`, `changes` counts writes to the
slice itself. This says nothing about edits to the elements inside a slice.

`contextId` is a MODEL_CONTEXT node id, or a timeline id — a timeline resolves through the board's own effective
context (the same rule `slicedata` uses), so one that inherits a context is reported under that context and one with
none is its own. Any other node type is rejected. Always scoped to one context; there is no board-wide form.

**Response**: `200` — `{ contextId, contextName, metrics, slices[] }`, slices most reworked first.
`metrics.progress` is where the slices stand now: `done`, `inProgress` (Assigned/InProgress/Review), `handover`, `ready`, `blocked`, `planned` (Planned/Created) as counts plus a `…Rate` share each, over the non-Informational slices, summing to 1.
`slices[]` = `{ sliceId, title, status, changes, reopens, regressions, everReachedDone }`.
`metrics` = `{ slices, everReachedDone, reopenedAfterDone, firstTimeRightRate, currentlyReopened, avgReopensPerSlice,
avgChangesPerSlice }` — `firstTimeRightRate` is the share of the slices that reached Done and never came back, or
`null` when none got there yet.
`400` `CONTEXT_ID_REQUIRED` / `CONTEXT_NODE_INVALID` · `404` `CONTEXT_NOT_FOUND`

---

### POST `/api/org/:orgId/boards/:boardId/prototype/:contextId`
**File**: `src/slices/change/api-prototypes/routes.ts`

Store a context's generated prototype page (the `prototype` skill). REST only, no MCP tool — `prototype.mjs upload` calls it.

**Request**: the page as the raw body, `Content-Type: text/html`, at most 5 MB. `contextId` is a MODEL_CONTEXT node or a
timeline; a timeline resolves to its effective context (the rule `slicedata` uses), so every timeline of one context
stores to the same place.

The page is sanitized — inline scripts and the `text/plain` slice blocks stay byte for byte; removed are scripts and
stylesheets from anywhere but `/vendor/`, module scripts, frames, objects, `base`, `<meta http-equiv>`, `on*` attributes,
`javascript:` URLs and HTML comments — then gzipped and stored in the organization's bucket at
`<boardId>/<effective context id>.gz`, replacing the previous version.

**Response**: `201` — `{ contextId, contextName, path, bytes, gzippedBytes, removed: string[] }` (`removed`: what the
sanitizer took out, one line each). `400` `PROTOTYPE_HTML_REQUIRED` (empty body / not `text/html`) /
`PROTOTYPE_HTML_INVALID` (no `<body>`) · `404` `CONTEXT_NOT_FOUND` · `413` larger than 5 MB.

---
