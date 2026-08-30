---
name: storyboard-screen
description: Design and render a single AI-generated wireframe sketch screen onto an existing SCREEN node using the sketch API — use only when the user explicitly asks for a wireframe/sketch; html-screen is the default for ordinary screen requests
---

# Storyboard Screen Designer

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

> **EXPLICIT USE ONLY**: Do not reach for this skill on an ordinary "design a screen" / "storyboard this" request — the default is `html-screen`, which renders a real HTML/CSS mockup onto an HTML_SCREEN node. Use this skill **only** when the user explicitly asks for a "sketch", a "wireframe", a "low-fidelity mockup", or names the SCREEN node type directly.

> **MANDATORY RENDER**: The sketch API call in Step 4 is **not optional**. This skill exists solely to produce a rendered wireframe. A SCREEN node without a rendered sketch is an empty placeholder that adds no value to the model. If the sketch API call is skipped or fails, the task is incomplete — retry or report the error.

Design a single wireframe screen and render it onto an existing SCREEN node. Use this to redesign a screen, add detail to a placeholder, or update a screen after a flow changes.

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `description` | what the screen should contain, e.g. "login with email and password" | required |
| `boardId` | a board ID string | from `connect` skill (`BOARD_ID`) |
| `nodeId` | the SCREEN node UUID to update | **ask the user if missing** |
| `baseUrl` | explicit URL override | from `connect` skill (`BASE_URL`) |

If `nodeId` is missing, ask for it before doing anything. `BOARD_ID` and `BASE_URL` come from the `connect` skill.

## Step 2 — If updating an existing screen, load its current description first

If `nodeId` refers to a screen that has already been rendered (i.e. this is an adjustment/tweak, not a brand-new screen), **do not design from scratch**. First load the existing sketch description so the edit preserves the rest of the layout.

**Prefer MCP:**

```
mcp__eventmodelers__get_image_snapshot_description { "boardId": "<BOARD_ID>", "nodeId": "<NODE_ID>" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 2 — Load existing description".

Skip this step entirely when the node is brand-new (no prior render) — go straight to Step 3.

## Step 3 — Design the screen

Design the screen using the grid description language — either from scratch (new screen, or Step 2 returned `404`) or by editing the elements loaded in Step 2. Think carefully about the layout — what elements does this screen need? Where should they go on the 50×40 grid?

Also compose a `visualDescription` — a prose description (2–4 sentences) of the screen's visual layout and content, written so that someone who cannot see the image can understand what is shown: what UI sections appear, what text/labels are visible, where buttons and inputs are placed, and the overall purpose of the screen.

## Grid description language

Canvas: **50 × 40 grid units** (1000 × 800 px, 1 unit = 20 px).

Always start with a full white background:
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

**Default palette — gray shades**: Unless instructed otherwise, use a grayscale palette. Prefer `white` for surfaces, `grey` for backgrounds, containers, borders, and secondary/placeholder text, and `black` for headings and primary text. Only introduce color when the user explicitly requests it.

Keep all coordinates within bounds: gridX 0–50, gridY 0–40.

### Example
```json
{
  "elements": [
    {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"},
    {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":3,"fill":"#424242"},
    {"type":"headline","gridX":2,"gridY":1,"text":"Dashboard","fontSize":18,"fill":"white"},
    {"type":"text","gridX":2,"gridY":6,"text":"Welcome back","fontSize":14,"fill":"grey"},
    {"type":"rectangle","gridX":2,"gridY":9,"gridWidth":21,"gridHeight":8,"fill":"#e0e0e0","stroke":"#bdbdbd"},
    {"type":"headline","gridX":4,"gridY":11,"text":"142","fontSize":24,"fill":"#424242"},
    {"type":"text","gridX":4,"gridY":14,"text":"Orders this month","fontSize":11,"fill":"grey"},
    {"type":"button","gridX":35,"gridY":36,"gridWidth":12,"gridHeight":2,"text":"Logout","fill":"#bdbdbd","stroke":"grey"}
  ]
}
```

## Step 4 — Render the sketch

**Prefer MCP:**

```
mcp__eventmodelers__render_screen {
  "boardId": "<BOARD_ID>",
  "nodeId": "<NODE_ID>",
  "elements": [...],
  "description": "<what this screen shows>"
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 4 — Render the sketch".

## Step 5 — Define field data lineage (mandatory)

Every screen — new or updated — needs `meta.fields`: one entry per piece of data the screen displays or captures, each with a `mapping` naming where that data comes from. A screen with only a title and no fields is an empty placeholder from a data-lineage standpoint, even once the wireframe is rendered. See the `html-screen` skill's "Step 5 — Define field data lineage" for the full `mapping`-format table (command/session/read-model/derived forms).

Name the read model even if it doesn't exist as a board node yet — this skill only renders the screen, it does not create READMODEL nodes or connections. But naming the source is **not optional**: a screen displaying data should almost never have a field with no mapping. If you can't say which read model a displayed field comes from, that's a sign the model is missing something — not a reason to skip the field.

Set `cardinality` too (`"Single"` unless the field is a repeated/list value), then push the fields onto the node:

**Prefer MCP:**
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "SCREEN", "fields": [
      {"name": "status", "type": "String", "example": "confirmed", "mapping": "ActiveReservationView.status", "cardinality": "Single"}
    ] }
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 5 — Define field data lineage".

## Step 6 — Report back

Tell the user:
- The node ID that was updated
- Whether the render succeeded (HTTP 204)
- Any errors
