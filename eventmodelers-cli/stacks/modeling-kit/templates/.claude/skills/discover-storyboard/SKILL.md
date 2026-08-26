---
name: discover-storyboard
description: Navigate an existing web app using browser automation MCP (Puppeteer/Playwright/Chrome DevTools), capture each step, and build one or more storyboard timelines on the board as HTML_SCREEN nodes reconstructed from the real page markup — ready for event modeling
---

# Discover Storyboard

> **FIRST — before invoking `connect` or anything else**: check for a browser automation MCP (Step 0). If none is found, stop immediately.

You are discovering the UI flows of an existing system by navigating it with a browser, capturing each screen, and uploading it to the eventmodelers board as a SCREEN node — one per column, arranged chronologically in timelines so the team can build an event model from the real application.

**Default rendering mode is HTML, not raw screenshots.** Every SCREEN node this skill places is by default an `HTML_SCREEN` — a real, editable HTML/CSS reconstruction of the captured page (built from `CONTENT_TOOL`'s markup, cleaned up with Bulma classes per the `html-screen` skill's conventions), not a flat image. Raw screenshot images (`contentType: "image"`) are used **only** when the user explicitly asks for screenshots/images during Step 2 — never as the default, and never as a fallback chosen for convenience. An HTML reconstruction is editable, themeable, and consistent with every other screen produced elsewhere in this toolkit; a screenshot is an inert picture. See Step 7b for the two paths.

---

## Step 0 — Check for browser automation MCP

Use `ToolSearch` to look for browser automation tools. Run these searches in order until you find a match:

| Search query | What to look for in results |
|---|---|
| `puppeteer navigate` | `puppeteer_navigate`, `puppeteer_screenshot`, `puppeteer_click` |
| `playwright browser` | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_take_screenshot` |
| `chrome devtools screenshot` | any navigate + screenshot + click tool set |

From the results, identify and save:

| Variable | What to assign |
|---|---|
| `NAVIGATE_TOOL` | the tool that navigates to a URL (e.g. `puppeteer_navigate`) |
| `SCREENSHOT_TOOL` | the tool that captures a screenshot (e.g. `puppeteer_screenshot`) |
| `CLICK_TOOL` | the tool that clicks an element (e.g. `puppeteer_click`) |
| `CONTENT_TOOL` | the tool that returns page HTML or text (e.g. `puppeteer_get_content`, `browser_snapshot`) |
| `FILL_TOOL` | the tool that fills an input field (e.g. `puppeteer_fill`, `browser_type`) — optional |

**If no navigate + screenshot tools are found in any search**, print this message and stop completely:

```
Chrome DevTools / browser automation MCP is not configured.

Install a browser automation MCP and restart Claude Code. Options:
  • Puppeteer MCP:  @modelcontextprotocol/server-puppeteer
  • Playwright MCP: @playwright/mcp

Once installed, run /discover-storyboard again.
```

Do NOT invoke `connect`. Do NOT proceed to Step 1.

---

## Step 1 — Connect

Invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until all four are available.

> Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below (Steps 5–7, the eventmodelers board-API calls) are the fallback for sessions without MCP connected. This is unrelated to the browser automation MCP checked in Step 0, which stays as-is.

---

## Step 2 — Gather discovery parameters (interactive)

Always ask these two questions before proceeding — even if arguments were passed inline.

### Question 1 — URL

Ask the user:
> "What URL should I open to start the discovery? (e.g. `http://localhost:3000`)"

Wait for the answer. Save as `startUrl`. Do not proceed until a URL is provided.

### Question 2 — Discovery focus

Ask the user:
> "Any guidance for the discovery? For example:
> - Focus on a specific flow (e.g. 'only the checkout flow')
> - Ignore certain sections (e.g. 'skip the admin panel', 'ignore login pages')
> - A particular user journey to follow (e.g. 'register a new account then book a room')
> - Leave blank to discover all visible flows automatically."

Wait for the answer (or a blank/skip). Save as `discoveryGuidance`. If blank, set to `"explore all visible flows"`.

### Rendering mode

Default `renderMode` to `"html"` — screens are placed as `HTML_SCREEN` reconstructions, never raw images, unless the user's answer to Question 2 (or `$ARGUMENTS`) explicitly asks for screenshots/images (e.g. "use screenshots", "capture images", "I want the actual pixels"). Only in that case set `renderMode = "image"`. Do not ask a separate question for this — infer it from the guidance already given, defaulting to `"html"` when nothing image-related was said.

### Additional parameters (from `$ARGUMENTS` only — do not ask)

| Field | How to find it | Default |
|---|---|---|
| `maxScreenshots` | any number mentioned, e.g. "up to 20 screens" | 15 |
| `chapterId` | an existing chapter UUID to add screens to | omit = create new chapter per flow |
| `boardId` | explicit board override | from `connect` skill |

---

## Step 3 — Prepare screenshot storage

Create a local temp directory to store screenshots during this session:

```bash
mkdir -p /tmp/discover-storyboard
```

Screenshots will be saved as `/tmp/discover-storyboard/screen-001.png`, `screen-002.png`, etc.

---

## Step 4 — Navigate and capture screens

Use the browser tools identified in Step 0. Process screens **one at a time** — navigate, screenshot, understand, decide next action.

### 4a — Start at the entry URL

1. Navigate to `startUrl` using `NAVIGATE_TOOL`
2. Wait briefly for the page to settle
3. If `renderMode == "image"`: take a screenshot using `SCREENSHOT_TOOL` — save to `/tmp/discover-storyboard/screen-001.png`. If `renderMode == "html"` (default): skip the screenshot — `CONTENT_TOOL`'s markup (next step) is what gets placed.
4. Use `CONTENT_TOOL` to read the page structure. When `renderMode == "html"`, also capture the markup needed to reconstruct this screen (Step 7b) — the visible content, layout structure, form fields/labels, buttons, and any status/data values shown, enough to rebuild a faithful HTML mockup, not just a text summary. Compose a `description` for this screen covering three things:
   - **What it shows**: the main content and purpose of this screen
   - **How the user got here**: `"Initial load"` for the entry screen
   - **What actions are possible**: list the primary user actions available (buttons, forms, links that lead somewhere meaningful) — expressed as intent, not UI labels (e.g. "user can submit a new order", "user can filter products by category")

Record this screen:
```
screens = [
  {
    index: 1,
    title: "<page title or heading>",
    url: "<current url>",
    filepath: "/tmp/discover-storyboard/screen-001.png",   // only populated when renderMode == "image"
    capturedMarkup: "<captured content/structure used to rebuild the HTML mockup>",  // only populated when renderMode == "html"
    flowHint: "<which flow this belongs to, e.g. 'Navigation / Home'>",
    description: "Shows <what>. Arrived via: initial load. Actions: <user can do X>, <user can do Y>, <user can do Z>."
  }
]
```

### 4b — Explore the flows

For each subsequent screen (up to `maxScreenshots`):

**Decide what to do next — always guided by `discoveryGuidance`:**
- If guidance names a specific flow or journey → follow only that path closely
- If guidance says to ignore certain sections → skip those links entirely
- If guidance describes a user journey (e.g. "register then book") → follow those steps in sequence, filling forms as needed
- If guidance is "explore all visible flows" → cover the primary navigation paths, one main section at a time

**Priority order for next interactions:**
1. Primary navigation items (top nav, sidebar) — explore each main section
2. Main call-to-action buttons on the current page (e.g. "Add to cart", "Sign up", "Submit")
3. Form submissions (fill required fields with plausible example values, then submit)
4. State transitions (e.g. after "Order Placed" → go to order confirmation page)

**Skip:**
- External links (different domain)
- Already-visited URLs
- Logout / destructive actions (unless explicitly in `flowDescription`)
- Settings / admin-only sections (unless explicitly requested)
- Repeated UI patterns with identical structure

After each interaction:
1. If `renderMode == "image"`: take a screenshot → save to `/tmp/discover-storyboard/screen-NNN.png` (increment counter). If `renderMode == "html"` (default): skip the screenshot.
2. Use `CONTENT_TOOL` to read the page and, when `renderMode == "html"`, capture the markup needed to rebuild this screen (same bar as Step 4a — enough to reconstruct a faithful mockup, not just a summary). Compose a `description` covering:
   - **What it shows**: the main content and purpose of this screen
   - **How the user got here**: the action taken to reach this screen (e.g. "clicked 'Add to cart'", "submitted login form")
   - **What actions are possible**: primary user actions expressed as intent (e.g. "user can confirm the order", "user can apply a discount code")
3. Append to `screens` array with:
   - `title` — the page/modal title
   - `url` — current URL
   - `filepath` — local file path (only when `renderMode == "image"`)
   - `capturedMarkup` — captured content/structure (only when `renderMode == "html"`)
   - `flowHint` — which logical flow this screen belongs to
   - `description` — "Shows <what>. Arrived via: <interaction>. Actions: <user can do X>, <user can do Y>."

Continue until `maxScreenshots` is reached or no new screens are discoverable.

### 4c — Group screens into flows

After all screenshots are collected, group `screens` by `flowHint` into flows:

```
flows = [
  {
    name: "Login & Authentication",
    screens: [screen-001, screen-002, screen-003]
  },
  {
    name: "Product Browsing",
    screens: [screen-004, screen-005, screen-006]
  },
  ...
]
```

**Rules:**
- If all screens clearly belong to one linear journey → one flow, one timeline
- If screens span distinct sections → one flow per section
- If `chapterId` was provided in Step 2 → put ALL screens in that single chapter (ignore flow grouping)
- Aim for 3–12 screens per flow; split or merge to stay in that range

Tell the user:
```
Discovered N screens across M flows:
  Flow 1: "Login & Authentication" — 3 screens
  Flow 2: "Product Browsing" — 5 screens
  ...
```

---

## Step 5 — Create chapters for each flow

**If `chapterId` was provided** — use it as the single `CHAPTER_ID` for all screens. Skip this step.

**Otherwise** — for each flow, create one chapter.

**Prefer MCP:**
```
mcp__eventmodelers__create_chapter { "boardId": "<BOARD_ID>", "x": 0, "y": 0 }
```

**Fallback (no MCP):**
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "x-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":0,"y":0}}'
```

Extract `id` → `CHAPTER_ID` for this flow.

Update the chapter title to the flow name using `node:changed`.

**Prefer MCP:**
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<CHAPTER_ID>",
    "boardId": "<BOARD_ID>",
    "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.title"],
    "meta": { "type": "CHAPTER", "title": "<flow name>" },
    "node": { "id": "<CHAPTER_ID>", "data": {} }
  }]
}
```

**Fallback (no MCP):**
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: discover-storyboard" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<CHAPTER_ID>",
    "boardId": "<BOARD_ID>",
    "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.title"],
    "meta": { "type": "CHAPTER", "title": "<flow name>" },
    "node": { "id": "<CHAPTER_ID>", "data": {} }
  }]'
```

Save `CHAPTER_ID` against each flow.

---

## Step 6 — Fetch chapter grid and build column queue

For each chapter, fetch its current grid state.

**Prefer MCP:**
```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>" }
```

**Fallback (no MCP):**
```bash
curl -s -H "x-token: $TOKEN" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

From `meta.timelineData`:
- `rows` — find the row with `type === "actor"` → save its `id` as `actorRowId` and its 0-based position in `rows` as `actorRowIndex`
- `columns` — ordered list; build an empty-column queue, remembering each entry's 0-based position in `columns` as its `columnIndex`

**Cell ID convention**: `<rowId>-<columnId>` — always computed directly, never looked up. **Cell name convention** (spreadsheet-style, needed for the MCP tool in Step 7b): `<columnLetter><rowNumber>`, where `columnLetter` is `columnIndex` converted to spreadsheet letters (0→A, 1→B, …25→Z, 26→AA, …) and `rowNumber` is `actorRowIndex + 1`.

---

## Step 7 — Place SCREEN nodes and upload screenshots

Process each flow's screens **one at a time in order**.

For each screen:

### 7a — Acquire a column slot

**If the empty-column queue is non-empty** — pop the first entry → `columnId` and its remembered `columnIndex`. Compute `CELL_ID = actorRowId + "-" + columnId` and `CELL_NAME` per the convention above.

**If the empty-column queue is empty** — create a new column.

**Prefer MCP:**
```
mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<CHAPTER_ID>" }
```
The result's `index` field is the new column's `columnIndex` (use it directly for `CELL_NAME` — no need to recompute from the full column list).

**Fallback (no MCP):**
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: discover-storyboard" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Response includes `{ columnId, index, totalColumns }` — `index` is the new `columnIndex`.

Extract `columnId`. Compute `CELL_ID = actorRowId + "-" + columnId` and `CELL_NAME` per the convention above.

### 7b — Create the SCREEN node, atomically

Generate a UUID for `SCREEN_NODE_ID`:

```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

This step must create the node and attach its content (HTML pages, or the screenshot) in a single call — never split into "upload content" then "create node" (or vice versa), which leaves a window where the node exists with no content.

**Default path — `renderMode == "html"` (use unless the user explicitly asked for screenshots/images in Step 2):**

Reconstruct the captured screen as a real HTML/CSS fragment from `screen.capturedMarkup`, following the `html-screen` skill's conventions: full-size markup (16px body text, generous padding), one self-contained fragment per page (no `<html>`/`<head>`/`<body>` wrapper), no `<script>`/inline handlers, Bulma CSS classes (`title`, `button`, `is-primary`, `field`/`control`/`input`, tables, tags for status badges, etc.). Reproduce the real layout, labels, form fields, buttons, and any live data/status values seen on the actual page — this is a faithful reconstruction of the discovered screen, not a generic mockup.

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "html",
  "nodeId": "<SCREEN_NODE_ID>",
  "chapterId": "<CHAPTER_ID>",
  "cellId": "<CELL_ID>",
  "pages": ["<reconstructed HTML fragment for this screen>"],
  "description": "<screen.description — 'Shows X. Arrived via: Y. Actions: user can do A, user can do B.'>"
}
```

**Never pass an empty `pages` array** — an empty array produces a blank placeholder, same as in `html-screen`/`eventmodeling-storyboarding-events`.

**Image path — `renderMode == "image"` only, when the user explicitly asked for screenshots:**

```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "image",
  "nodeId": "<SCREEN_NODE_ID>",
  "chapterId": "<CHAPTER_ID>",
  "cellName": "<CELL_NAME>",
  "imageBase64": "<base64-encoded contents of screen.filepath, no data: URI prefix>",
  "mimeType": "image/png",
  "description": "<screen.description — 'Shows X. Arrived via: Y. Actions: user can do A, user can do B.'>"
}
```

**Fallback (no MCP)** — the same atomic operation via the `image-nodes` endpoint (not the plain `images/:id` endpoint, which only updates an existing node's image and does not place it) — image path only:
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/image-nodes/$SCREEN_NODE_ID" \
  -H "x-token: $TOKEN" \
  -F "file=@<screen.filepath>" \
  -F "chapterId=$CHAPTER_ID" \
  -F "cellName=$CELL_NAME"
```
For the HTML path with no MCP, use the `html-screen-nodes` endpoint per the `html-screen` skill's fallback mechanics instead.

Response: `204`/success on success. Log failures in the final report but continue to the next screen — do not stop the entire run.

### 7d — Report per-screen progress

After each screen: print one line, e.g.:
```
✓ Screen 3/8 — "Checkout Confirmation" placed in flow "Checkout"
```

---

## Step 8 — Final report

After all flows and screens are processed:

```
Discover Storyboard complete.

Flows created (N total):
  • "Login & Authentication" — chapter <id> — 3 screens
  • "Product Browsing" — chapter <id> — 5 screens
Screens uploaded: N of M (list any failures)

Next steps:
  - Open the board to review the storyboard timelines
  - Run /timeline to add domain events to each timeline
  - Run /eventmodeling-identifying-inputs to map UI actions to commands
```

---

## Navigation guidelines

**Be systematic, not exhaustive.** The goal is to capture the key user journeys — not every possible page combination.

- Visit each major section of the app at least once
- Follow the primary happy path for any form or flow (fill forms with plausible test data)
- Capture before-and-after states (e.g. "empty cart" and "cart with items")
- Do NOT follow pagination to every page — one example page is enough
- Do NOT take screenshots of loading spinners or empty states unless they represent a meaningful step
- If you encounter a login wall, fill in any visible credentials from the URL (e.g. `admin`/`password`) or ask the user for credentials before proceeding

**Recognizing meaningful screen transitions:**
- URL change → new screen
- Major content change (modal opens, form submitted, page reloaded) → new screen
- Only cosmetic changes (tooltip shown, menu expanded) → NOT a new screen
