---
name: storyboard
description: Build a complete visual storyboard with AI-generated screens from a natural language description — creates a chapter, N columns, and N custom HTML screens (wireframe sketches only if explicitly requested)
---

# Storyboard Builder

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

> **HTML is the default content type**: every screen this skill creates is a real HTML/CSS mockup (`contentType: "html"`, HTML_SCREEN node) unless the user's request explicitly asks for a "sketch", "wireframe", or "low-fidelity mockup" — only then does a screen use the sketch path (`contentType: "sketch"`, plain SCREEN node) described under "Sketch path (explicit request only)" below. Decide this once per storyboard, before Step 2 — do not mix content types across screens in the same storyboard unless the user asked for that mix.

You are building a complete visual storyboard by calling the board API. You generate the screen designs yourself — HTML pages by default (see "HTML page design" below), or grid elements only when the sketch path applies — then create the storyboard structure via `mcp__eventmodelers__*` tools (or `curl` as a fallback — see each step below). Only SCREEN/HTML_SCREEN nodes are created — no COMMAND or EVENT nodes.

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `description` | the flow name, e.g. "login flow", "checkout", "user onboarding" | required |
| `screenCount` | any number mentioned, e.g. "6 screens", "with 4 steps" | 3 |
| `boardId` | a board ID string, e.g. "board-abc" | from `connect` skill (`BOARD_ID`) |
| `chapterId` | an existing chapter ID to reuse, e.g. "chapter-xyz" | empty — create a new chapter |
| `baseUrl` | explicit URL override | from `connect` skill (`BASE_URL`) |

`BOARD_ID` and `BASE_URL` come from the `connect` skill. Only ask the user for `boardId` if explicitly overriding.
If `chapterId` is provided, skip chapter creation and go straight to Step 4.

## Step 2 — Plan all screens and create tasks

Before making any API calls, plan all N screens. For each screen, decide:

- `screenTitle` — human-readable name (e.g. "Enter Credentials")
- `pages` (default) — one or more complete HTML/CSS fragments for this screen (see "HTML page design" below), or `elements` — a minimal list of grid elements (see "Sketch path" below, aim for 5–8 elements) **only** when the sketch path applies for this storyboard
- `visualDescription` — a prose description of the screen's visual layout and content (2–4 sentences) that lets someone who cannot see the image understand what is shown: what UI sections appear, what text/labels are visible, where buttons and inputs are placed, and the overall purpose of the screen
- `fields` — one entry per piece of data this screen displays or captures, each with a `mapping` naming its source (see "Field data lineage" in Step 5b below). Plan this alongside the visuals, not as an afterthought — every displayed value needs a named source.

If several screens in this storyboard share the same visual base but each highlights a different part of it (e.g. one shared mockup, marked up differently per slice), scope each screen's `fields` to only the data inside *that* screen's highlighted area — not the full shared mockup. Different highlight, different (narrower) field list.

Then **create one task per screen** using TaskCreate, naming each task after the screen title. This gives you a visible queue of work. Create the screens directly after each task has been planned.

## HTML page design (default)

Write normal, full-size HTML/CSS for each screen — as if designing a real webpage, not a tiny thumbnail. The canvas node renders this at a real page width and visually scales it down to fit, so there is no need to shrink font sizes or padding.

- **Keep it simple — this is a view-only mockup, not a working app.** No JavaScript, no interactivity beyond what a static page can show. Keep the CSS compact: inline styles or a handful of Bulma classes are enough — don't write a large embedded `<style>` block.
- Each page is one complete, standalone HTML fragment — not a `data-step` div nested inside a shared blob. A multi-step flow is multiple pages, each fully self-contained.
- Inline styles (`style="..."`) are the simplest way to keep each page self-contained.
- No `<script>` tags, no inline event handlers (`onclick`, `onload`, ...), no `javascript:` URIs — these are stripped server-side before persisting. This is a static visual mockup, not an interactive prototype.
- A real page background (e.g. a light gray full-bleed background behind a centered white card) reads more realistically than a bare form floating on white.
- Don't add `<html>`/`<head>`/`<body>` tags — every page is a body-only fragment; the canvas wraps it at render time.
- Bulma CSS (0.9.4) is loaded by default — classes like `title`, `button`, `is-primary`, `field`/`control`/`input` etc. all work out of the box. Headings need a size modifier too, e.g. `class="title is-1"`.

## Sketch path (explicit request only)

Only use this path when the user's request explicitly asked for a "sketch", "wireframe", or "low-fidelity mockup" for this storyboard. Otherwise skip straight to the HTML page design above.

### Grid description language

Canvas: **50 × 40 grid units** (1000 × 800 px, 1 unit = 20 px).

**Keep screens simple.** 5–8 elements is ideal. Speed matters more than detail — use rectangles as section placeholders, skip decorative elements. Skip circles.

Every screen's `elements` array **must start** with a full white background:
```json
{"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"}
```

### Element types

| type | required fields | optional fields |
|------|----------------|-----------------|
| `rectangle` | gridX, gridY, gridWidth, gridHeight | fill, stroke |
| `text` | gridX, gridY, text | fontSize (default 12), fill, gridWidth |
| `headline` | gridX, gridY, text | fontSize (default 20), fill, gridWidth |
| `button` | gridX, gridY, gridWidth, gridHeight, text | fill, stroke |
| `input` | gridX, gridY, gridWidth, gridHeight, text (placeholder) | fill, stroke |
| `image` | gridX, gridY, gridWidth, gridHeight | fill (placeholder color) |
| `line` | gridX, gridY, gridX2, gridY2 | stroke |
| `circle` | gridX, gridY, gridRadius | fill, stroke |

### Colors
Limited to: `black` `grey` `light-violet` `violet` `blue` `light-blue` `yellow` `orange` `green` `light-green` `light-red` `red` `white`. No hex codes.

Keep all coordinates within bounds: gridX 0–50, gridY 0–40.

### Example — a simple screen (8 elements)
```json
{
  "elements": [
    {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"},
    {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":3,"fill":"light-violet"},
    {"type":"headline","gridX":2,"gridY":1,"text":"Sign In","fontSize":18,"fill":"white"},
    {"type":"input","gridX":15,"gridY":12,"gridWidth":20,"gridHeight":2,"text":"Email","fill":"white","stroke":"grey"},
    {"type":"input","gridX":15,"gridY":16,"gridWidth":20,"gridHeight":2,"text":"Password","fill":"white","stroke":"grey"},
    {"type":"button","gridX":15,"gridY":21,"gridWidth":20,"gridHeight":3,"text":"Sign In","fill":"blue"},
    {"type":"text","gridX":18,"gridY":26,"text":"Forgot password?","fontSize":12,"fill":"blue"}
  ]
}
```

---

## ONE-TIME SETUP — run Steps 3 and 4 exactly once before the screen loop

### Step 3 — Resolve or create the chapter

**If `chapterId` was provided in Step 1** — set `CHAPTER_ID = chapterId` and skip to Step 4. Do not make any API call here.

**If `chapterId` was NOT provided** — create a new chapter (exactly once).

**Prefer MCP:**

```
mcp__eventmodelers__create_chapter { "boardId": "<BOARD_ID>", "x": 0, "y": 0 }
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":0,"y":0}}'
```

Extract `id` from the response → `CHAPTER_ID`.

**You now have exactly one `CHAPTER_ID`. Do not create another chapter.**

### Step 4 — Fetch chapter state and build empty-column queue

**Prefer MCP** — `projection: "cells"` returns just `{rows, columns, cells}`, not the whole chapter node:

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
```

**Fallback (no MCP):**

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

Parse the result (`{rows, columns, cells}` directly via MCP, or `meta.timelineData` via the REST fallback):
- `rows` — list of row objects, each with `id` and `type`
- `columns` — list of column objects, each with `id`
- `cells` — list of cell objects, each with `rowId`, `colId`, and optionally `nodeId` (used only to check occupancy)

Find the row IDs for the `actor`, `interaction`, and `swimlane` row types. Save as `actorRowId`, `interactionRowId`, `swimlaneRowId`.

> **Cell ID convention**: Cell IDs are always `<rowId>-<columnId>`. Compute them directly — never search the `cells` array for an ID.

Build an **empty-column queue**: for each column (in order), compute `actorCellId = actorRowId + "-" + col.id`, `interactionCellId = interactionRowId + "-" + col.id`, `swimlaneCellId = swimlaneRowId + "-" + col.id`. Check these IDs in the `cells` array for a `nodeId` (absent or null). If ALL three have no `nodeId`, push `{actorCellId, interactionCellId, swimlaneCellId}` onto the queue.

---

## SCREEN LOOP — repeat Steps 5a–5c once per screen (N iterations total)

Process screens **one at a time**. Do not start the next screen until the current one is fully complete (node created + sketch rendered).

**Before starting the loop**, if the empty-column queue (Step 4) has fewer entries than N screens, create the shortfall in one call — `mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<CHAPTER_ID>", "count": <N - queue.length> }` returns `columnIds: [...]` — and push each new column onto the queue, rather than calling `add_column` once per screen inside Step 5a whenever the queue runs dry.

**You have ONE chapter (`CHAPTER_ID`). All screens go into this same chapter. Do NOT call the chapter creation endpoint again inside this loop.**

Only SCREEN nodes are created. COMMAND and EVENT nodes are not created.

### Step 5a — Acquire a column slot for this screen

**If the empty-column queue is non-empty** — pop the first entry. Use its `actorCellId` directly, proceed to Step 5b.

**If the empty-column queue is empty** — add a new column (this does NOT create a new chapter).

**Prefer MCP:**

```
mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<CHAPTER_ID>" }
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Extract `columnId` from the response. Compute the actor cell ID directly:

**`actorCellId = actorRowId + "-" + columnId`**

(Cell IDs are always `<rowId>-<columnId>` — no re-fetch or cell array search needed.)

**In both cases**, generate a node UUID: `SCREEN_NODE_ID`.

### Step 5b — Create the node and render it in one atomic call

Build the payload, then send a single call that creates the screen node, places it into the actor cell, and renders its content — all in one request. There is no intermediate state where the node exists without content or without a cell.

**Default — HTML (`contentType: "html"`, HTML_SCREEN node):**

**Prefer MCP:**

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "html",
  "nodeId": "<SCREEN_NODE_ID>",
  "chapterId": "<CHAPTER_ID>",
  "cellId": "<actorCellId>",
  "pages": ["<div>...</div>"],
  "description": "<screenTitle — what this screen shows>"
}
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/$SCREEN_NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorCellId>",
    "pages": ["<div>...</div>"]
  }'
```

**Sketch path (explicit request only) — `contentType: "sketch"`, plain SCREEN node:**

**Prefer MCP:**

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "sketch",
  "nodeId": "<SCREEN_NODE_ID>",
  "chapterId": "<CHAPTER_ID>",
  "cellId": "<actorCellId>",
  "elements": [...],
  "description": "<screenTitle — what this screen shows>"
}
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/image-nodes/$SCREEN_NODE_ID/sketch" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorCellId>",
    "description": {"elements": [...]},
    "semanticDescription": "<screenTitle — what this screen shows>"
  }'
```

Pass the already-computed `actorCellId` directly as `cellId` in either path. Expect success (MCP: `created: true`; curl: `204`). On failure, read the validation error, fix the payload, and retry once before reporting failure.

### Step 5b(ii) — Set field data lineage (mandatory)

Push the `fields` planned in Step 2 onto the node with a `node:changed` call. Every field needs a `mapping`:

| Field type | `mapping` | Example |
|---|---|---|
| User types a value, sent as a command | `"<CommandTitle>.<fieldName>"` | `"ReserveBike.bikeId"` |
| Displayed data, sourced from a read model | `"<ReadModelTitle>.<fieldName>"` | `"ActiveReservationView.status"` |
| Calculated/formatted only for display | `"derived:<expression>"` | `"derived:formatDuration(durationMinutes)"` |

Name the read model even if it doesn't exist as a board node yet — this skill only creates SCREEN/HTML_SCREEN nodes, never READMODEL nodes or connections. But naming the source is **not optional**: a screen displaying data should almost never have a field with no mapping. Set `cardinality` too (`"Single"` unless it's a repeated/list value).

**Prefer MCP:**
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<SCREEN_NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "HTML_SCREEN", "fields": [ /* planned fields */ ] }
  }]
}
```

**Fallback (no MCP):**
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<SCREEN_NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "HTML_SCREEN", "fields": [ /* planned fields */ ] }
  }]'
```

### Step 5c — Mark the task complete

After the node and sketch succeed, mark the task for this screen as completed using TaskUpdate.

---

## Step 6 — Report back

After all screens are done, summarise:
- Chapter ID
- Numbered list: screen title
- Any errors (with status codes)
