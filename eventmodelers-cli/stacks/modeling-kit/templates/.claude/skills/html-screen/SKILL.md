---
name: html-screen
description: Design and render a single real HTML/CSS screen (one or more pages) onto an HTML_SCREEN node — use only when the user explicitly asks for an HTML screen; sketches (storyboard-screen) remain the default for ordinary screen requests
---

# HTML Screen Designer

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

> **EXPLICIT USE ONLY**: Do not reach for this skill on an ordinary "design a screen" / "storyboard this" request — that default remains `storyboard-screen`, which renders a wireframe sketch onto a SCREEN node. Use this skill **only** when the user explicitly asks for an "HTML screen", a "real webpage", a "coded/HTML mockup", or names the HTML_SCREEN node type directly.

> **MANDATORY RENDER + VERIFY**: The render call in Step 4 and the verification in Step 5 are **not optional**. This skill exists solely to produce rendered pages. An HTML_SCREEN node with no non-empty page is an empty placeholder that adds no value to the model. If the render call is skipped or fails, or verification reports `valid: false`, the task is incomplete — retry or report the error.

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

If `nodeId` refers to a screen that already has pages (i.e. this is an adjustment/tweak, or "add a page" to an existing screen — not a brand-new screen), **do not design from scratch**. Load the node and inspect `meta.pages`:

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

## Step 4 — Render the pages

**Updating an existing node** (`nodeId` was given) — always sends the **complete** pages array, not just the changed/new entry:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screens/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"pages": ["<div>...</div>", "<div>...</div>"]}'
```

**Creating a new node** (no `nodeId` — one is generated and placed into `chapterId`/`cellName`):

```bash
NODE_ID=$(uuidgen)
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/$NODE_ID" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"chapterId": "'"$CHAPTER_ID"'", "cellName": "'"$CELL_NAME"'", "pages": ["<div>...</div>"]}'
```

Expect `204 No Content` on success from either call.

## Step 5 — Verify the screen

Confirm the node exists, is type HTML_SCREEN, and has at least one non-empty page:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screens/$NODE_ID/verify" \
  -H "x-token: $TOKEN"
```

If `valid` is `false`, read the `error` field and retry the failing step once before reporting failure.

## Step 6 — Report back

Tell the user:
- The node ID that was created or updated
- How many pages the screen now has
- Whether the render succeeded (HTTP 204) and verification passed (`valid: true`)
- Any errors