---
name: storyboard
description: Build a complete visual storyboard with AI-generated screens from a natural language description — creates a chapter, N columns, and N custom sketch screens
---

# Storyboard Builder

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

You are building a complete visual storyboard by calling the board HTTP API. You generate the screen designs yourself using the grid description language below, then create the storyboard structure via `curl`. Only SCREEN nodes are created — no COMMAND or EVENT nodes.

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
- `elements` — a minimal list of grid elements (see language below, aim for 5–8 elements)
- `visualDescription` — a prose description of the screen's visual layout and content (2–4 sentences) that lets someone who cannot see the image understand what is shown: what UI sections appear, what text/labels are visible, where buttons and inputs are placed, and the overall purpose of the screen

Then **create one task per screen** using TaskCreate, naming each task after the screen title. This gives you a visible queue of work. Create the screens directly after each task has been planned.

## Grid description language

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
Named: `black` `grey` `light-violet` `violet` `blue` `light-blue` `yellow` `orange` `green` `light-green` `light-red` `red` `white` `transparent`
Or any hex code like `#3b82f6`.

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

**If `chapterId` was NOT provided** — create a new chapter (exactly once):

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters" \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":0,"y":0}}'
```

Extract `id` from the response → `CHAPTER_ID`.

**You now have exactly one `CHAPTER_ID`. Do not create another chapter.**

### Step 4 — Fetch chapter state and build empty-column queue

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
```

Parse `meta.timelineData` from the response:
- `rows` — list of row objects, each with `id` and `type`
- `columns` — list of column objects, each with `id`
- `cells` — list of cell objects, each with `rowId`, `colId`, and optionally `nodeId` (used only to check occupancy)

Find the row IDs for the `actor`, `interaction`, and `swimlane` row types. Save as `actorRowId`, `interactionRowId`, `swimlaneRowId`.

> **Cell ID convention**: Cell IDs are always `<rowId>-<columnId>`. Compute them directly — never search the `cells` array for an ID.

Build an **empty-column queue**: for each column (in order), compute `actorCellId = actorRowId + "-" + col.id`, `interactionCellId = interactionRowId + "-" + col.id`, `swimlaneCellId = swimlaneRowId + "-" + col.id`. Check these IDs in the `cells` array for a `nodeId` (absent or null). If ALL three have no `nodeId`, push `{actorCellId, interactionCellId, swimlaneCellId}` onto the queue.

---

## SCREEN LOOP — repeat Steps 5a–5d once per screen (N iterations total)

Process screens **one at a time**. Do not start the next screen until the current one is fully complete (node created + sketch rendered + verified).

**You have ONE chapter (`CHAPTER_ID`). All screens go into this same chapter. Do NOT call the chapter creation endpoint again inside this loop.**

Only SCREEN nodes are created. COMMAND and EVENT nodes are not created.

### Step 5a — Acquire a column slot for this screen

**If the empty-column queue is non-empty** — pop the first entry. Use its `actorCellId` directly, proceed to Step 5b.

**If the empty-column queue is empty** — add a new column (this does NOT create a new chapter):

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/columns" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Extract `columnId` from the response. Compute the actor cell ID directly:

**`actorCellId = actorRowId + "-" + columnId`**

(Cell IDs are always `<rowId>-<columnId>` — no re-fetch or cell array search needed.)

**In both cases**, generate a node UUID: `SCREEN_NODE_ID`. Generate an event UUID: `ACTOR_EVT_ID`.

Place the SCREEN node into the actor cell using the `/nodes/events` endpoint (agent-compatible — requires `x-user-id: agent`):

> **Do NOT use** `/boards/$BOARD_ID/events` — that endpoint requires a user JWT and will fail for agent (x-token) auth with "Authenticated user id is required".

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id":        "<ACTOR_EVT_ID>",
      "eventType": "node:created",
      "nodeId":    "<SCREEN_NODE_ID>",
      "boardId":   "<BOARD_ID>",
      "timestamp": <NOW_MS>,
      "chapterId": "<CHAPTER_ID>",
      "cellId":    "<actorCellId>",
      "meta":      {"type": "SCREEN", "title": "<screenTitle>", "description": "<visualDescription>"},
      "node":      {"id": "<SCREEN_NODE_ID>", "data": {}}
    }
  ]'
```

Verify the response contains `"hashes"`. If it fails, stop and report the error — do not proceed to the sketch step.

> **Do NOT call the `drop` endpoint after this step.** `node:created` with `cellId` already places the node in the correct cell. Calling drop afterwards creates a duplicate cell reference without removing the original, causing the node to appear in two columns simultaneously.

### Step 5b — Render the sketch onto the SCREEN node

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$SCREEN_NODE_ID/sketch" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"description": "<screenTitle — what this screen shows>", "elements": [...]}'
```

### Step 5c — Verify the screen

Confirm the node and its rendered image both actually exist before moving on:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/screens/$SCREEN_NODE_ID/verify" \
  -H "x-token: $TOKEN"
```

Check the `valid` field in the response:
- **`valid: true`** — proceed to Step 5d.
- **`valid: false`** — read the `error` field. If `nodeExists` is `false`, the node creation in Step 5a failed; retry it. If `imageExists` is `false`, the sketch render in Step 5b failed silently; retry Step 5b once. If it fails verification again, log the error for this screen in the final report and move on to the next screen — do not get stuck retrying indefinitely.

### Step 5d — Mark the task complete

After the node, sketch, and verification all succeed, mark the task for this screen as completed using TaskUpdate.

---

## Step 6 — Report back

After all screens are done, summarise:
- Chapter ID
- Numbered list: screen title
- Any errors (with status codes), including screens that failed the Step 5c verification
