---
name: html-screen
description: Design and render a single real HTML/CSS screen (one or more pages) onto an HTML_SCREEN node — this is the default skill for any "design a screen" / "storyboard this" request; wireframe sketches (storyboard-screen) are used only when the user explicitly asks for one
---

# HTML Screen Designer

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

> **DEFAULT SCREEN SKILL**: Reach for this skill on any ordinary "design a screen" / "storyboard this" request — it is the default, rendering a real HTML/CSS mockup onto an HTML_SCREEN node. Use `storyboard-screen` (a low-fidelity wireframe sketch onto a plain SCREEN node) **only** when the user explicitly asks for a "sketch", a "wireframe", a "low-fidelity mockup", or names the SCREEN node type directly.

> **MANDATORY RENDER**: The render call in Step 4 is **not optional**. This skill exists solely to produce rendered pages. An HTML_SCREEN node with no non-empty page is an empty placeholder that adds no value to the model. If the render call is skipped or fails, the task is incomplete — retry or report the error.

Design one or more HTML/CSS pages and render them onto an HTML_SCREEN node — creating the node if it doesn't exist yet, or updating it in place if it does. Use this to build a realistic, styled mockup (forms, tables, real page layout) rather than a wireframe sketch. Each page is a separate, standalone piece of markup — e.g. a multi-step form is one page per step, not one blob with hidden sections.

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `description` | what the screen should contain, e.g. "checkout form with card number, expiry, CVC" | required |
| `boardId` | a board ID string | from `connect` skill (`BOARD_ID`) |
| `nodeId` | the HTML_SCREEN node UUID to update, if updating an existing screen | omit when creating a new one |
| `chapterId` | timeline UUID, required when creating a new node | **ask the user if missing and no `nodeId` was given** |
| `cellName` | spreadsheet-style cell, e.g. "B2", required when creating a new node | **ask the user if missing and no `nodeId` was given** |
| `baseUrl` | explicit URL override | from `connect` skill (`BASE_URL`) |

If neither `nodeId` nor (`chapterId` + `cellName`) can be resolved, ask the user before doing anything.

## Step 2 — If updating an existing screen, load its current pages first

If `nodeId` refers to a screen that already has pages (i.e. this is an adjustment/tweak, or "add a page" to an existing screen — not a brand-new screen), **do not design from scratch**. Load the node and inspect `meta.pages`.

**Prefer MCP:**

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<NODE_ID>" }
```

**Fallback (no MCP):**

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent"
```

- If `meta.pages` is a non-empty array, use it as the base. For an edit to an existing page, change only that entry and keep the rest of the array untouched. For "add a page", append a new entry to the end of the array — never merge new content into an existing page.
- If it's empty or the node doesn't exist yet, design from scratch in Step 3.

Skip this step entirely when creating a brand-new node (no `nodeId` given) — go straight to Step 3.

## Step 3 — Design the page(s)

Write normal, full-size HTML/CSS for each page — as if designing a real webpage, not a tiny thumbnail. The canvas node renders this at a real page width and visually scales it down to fit, so there is no need to shrink font sizes or padding to fit a small box; design at a realistic scale (e.g. 16px body text, generous padding) and let the node handle the shrink.

Guidelines:
- Each page is one complete, standalone HTML fragment — not a `data-step` div nested inside a shared blob. A multi-step flow (e.g. cart → payment → confirmation) is three separate pages in the array, each fully self-contained.
- Inline styles (`style="..."`) are the simplest way to keep each page self-contained.
- No `<script>` tags, no inline event handlers (`onclick`, `onload`, ...), no `javascript:` URIs — these are stripped server-side from every page before persisting regardless of what's sent. This is a static visual mockup, not an interactive prototype.
- A real page background (e.g. a light gray full-bleed background behind a centered white card) reads more realistically than a bare form floating on white.
- Don't add `<html>`/`<head>`/`<body>` tags to a page — every page is a body-only fragment. The canvas wraps each page in its own `<html><head>` (stylesheet + resize script) `<body>...</body></html>` at render time, so anything sent is placed inside that generated `<body>`.
- Bulma CSS (0.9.4) is loaded by default in that `<head>` — classes like `title`, `button`, `is-primary`, `field`/`control`/`input` etc. all work out of the box, no need to write custom CSS for standard form/layout components. Note headings need a size modifier too, e.g. `class="title is-1"` — a bare `title` class alone is always 2rem regardless of the tag (`h1` vs `h2` etc.).

### Marks — only when the user explicitly asks for one

The canvas has a native "Marks" feature (outline highlight, plus an optional "blur outside" or "white outside" spotlight) for calling out part of a screen — see `HtmlEditorModal.tsx`'s Highlight tool and `markBlur.ts`/`markStyles.ts` in the main app. **Do not add marks by default.** Only apply the effects below when the request explicitly asks to highlight/mark/call out/circle/spotlight, or blur/obscure/white-out part of the screen (e.g. "highlight the submit button", "blur everything except the email field", "white out everything but the header"). An ordinary "design a screen" request gets no marks.

This skill only has a `pages`/`backgroundColor` field to send (no separate marks API — the native feature persists marks as board metadata, not through this render call), so reproduce the same visual language directly as inline CSS on the target element(s), self-contained in the page HTML same as any other styling in Step 3. No `<script>`/`<style>` tags are needed (and `<script>` is stripped anyway) — inline `style="..."` reproduces the same CSS the native feature injects:

- **Mark / highlight an area** — add to the target element's `style`: `outline:4px solid <color> !important;outline-offset:1px;`. Default color `#e74c3c` (red) unless the user names one; other options mirror the app's mark picker (`ColorPicker.tsx`): `#1e293b` (dark slate), `#2ecc71` (green), `#3b82f6` (blue), `#f1c40f` (yellow), `#ffffff` (white).
- **Blur outside / spotlight an area** — add `style="filter:blur(6px) !important;"` to every other top-level sibling/section on the page so only the called-out element stays sharp.
- **White outside / spotlight an area** — same idea, but instead add `style="filter:brightness(0) invert(1) !important;"` to every other top-level sibling/section (collapses them to solid white — works uniformly across text, shapes, and images, unlike a plain background-color override). Use this only when the user says "white out" / "whiteout" rather than "blur" — the two are mutually exclusive per mark in the native tool, so never apply both blur and white filters to the same sibling.
- Combine the outline rule with either spotlight rule if the user asked to both mark *and* blur/white-out.

Apply these only to the specific element(s) the request describes — don't guess at additional areas to call out.

**Marked screens and field scoping**: when the same underlying screen is rendered multiple times as separate nodes — once per slice, each with a different mark/highlight calling out a different part of the UI — scope each node's `meta.fields` (Step 5 below) to only the data inside that node's highlighted area, not the full screen. Three slice-specific screen nodes sharing one visual base should end up with three different, narrower field lists, each matching what that node's mark calls out.

## Step 4 — Render the pages

**Updating an existing node** (`nodeId` was given) — always sends the **complete** pages array, not just the changed/new entry:

**Prefer MCP:**

```
mcp__eventmodelers__render_screen {
  "boardId": "<BOARD_ID>",
  "nodeId": "<NODE_ID>",
  "pages": ["<div>...</div>", "<div>...</div>"]
}
```

**Fallback (no MCP):**

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screens/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"pages": ["<div>...</div>", "<div>...</div>"]}'
```

**Creating a new node** (no `nodeId` — one is generated and placed into `chapterId`/`cellName`):

**Prefer MCP:**

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "html",
  "nodeId": "<generated-uuid>",
  "chapterId": "<CHAPTER_ID>",
  "cellName": "<CELL_NAME>",
  "pages": ["<div>...</div>"]
}
```

**Fallback (no MCP):**

```bash
NODE_ID=$(uuidgen)
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"chapterId": "'"$CHAPTER_ID"'", "cellName": "'"$CELL_NAME"'", "pages": ["<div>...</div>"]}'
```

Expect `204 No Content` on success from either curl call.

## Step 5 — Define field data lineage (mandatory)

Every screen — new or updated — needs `meta.fields`: one entry per piece of data the screen displays or captures, each with a `mapping` naming where that data comes from. A screen with only a title and no fields is an empty placeholder from a data-lineage standpoint, even if the mockup itself looks complete.

| Field type | `mapping` | Example |
|---|---|---|
| User types a value, sent as a command | `"<CommandTitle>.<fieldName>"` | `"ReserveBike.bikeId"` |
| Read from session | `"session:<fieldName>"` | `"session:customerId"` |
| Displayed data, sourced from a read model | `"<ReadModelTitle>.<fieldName>"` | `"ActiveReservationView.status"` |
| Calculated/formatted only for display | `"derived:<expression>"` | `"derived:formatDuration(durationMinutes)"` |

Name the read model even if it doesn't exist as a board node yet — this skill only renders the screen, it does not create READMODEL nodes or connections (that's `eventmodeling-identifying-outputs` or `place-element`, if the model is taken that far). But naming the source is **not optional**: a screen displaying data should almost never have a field with no mapping. If you can't say which read model a displayed field comes from, that's a sign the model is missing something — not a reason to skip the field.

If this node is one of several sharing the same visual base with different marks/highlights (see "Marked screens and field scoping" above), only list the fields that fall inside *this* node's highlighted area — not every field the shared screen shows.

Set `cardinality` too (`"Single"` unless the field is a repeated/list value), then push the fields onto the node:

**Prefer MCP:**
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "HTML_SCREEN", "fields": [
      {"name": "status", "type": "String", "example": "confirmed", "mapping": "ActiveReservationView.status", "cardinality": "Single"}
    ] }
  }]
}
```

**Fallback (no MCP):**
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "HTML_SCREEN", "fields": [
      {"name": "status", "type": "String", "example": "confirmed", "mapping": "ActiveReservationView.status", "cardinality": "Single"}
    ] }
  }]'
```

## Step 6 — Report back

Tell the user:
- The node ID that was created or updated
- How many pages the screen now has
- Whether the render succeeded (HTTP 204)
- Any errors