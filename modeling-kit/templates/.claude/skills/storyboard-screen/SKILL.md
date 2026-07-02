---
name: storyboard-screen
description: Design and render a single AI-generated wireframe screen onto an existing SCREEN node using the sketch API
---

# Storyboard Screen Designer

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

> **MANDATORY RENDER + VERIFY**: The sketch API call in Step 3 and the verification in Step 4 are **not optional**. This skill exists solely to produce a rendered wireframe. A SCREEN node without a rendered sketch is an empty placeholder that adds no value to the model. If the sketch API call is skipped or fails, or verification reports `valid: false`, the task is incomplete — retry or report the error.

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

## Step 2 — Design the screen

Design the screen yourself using the grid description language. Think carefully about the layout — what elements does this screen need? Where should they go on the 50×40 grid?

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
Named: `black` `grey` `light-violet` `violet` `blue` `light-blue` `yellow` `orange` `green` `light-green` `light-red` `red` `white` `transparent`
Or any hex code.

**Default palette — gray shades**: Unless instructed otherwise, use a grayscale palette. Prefer `white` for surfaces, `#f5f5f5` / `#e0e0e0` / `#bdbdbd` for backgrounds and containers, `grey` for borders and secondary text, `#424242` or `black` for headings and primary text, and `#757575` for placeholder/muted text. Only introduce color when the user explicitly requests it.

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

## Step 3 — Render the sketch

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$NODE_ID/sketch" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"description": "<what this screen shows>", "elements": [...]}'
```

Expect `204 No Content` on success.

## Step 4 — Verify the screen

Confirm the node and its rendered image both actually exist:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/screens/$NODE_ID/verify" \
  -H "x-token: $TOKEN"
```

If `valid` is `false`, read the `error` field and retry the failing step (Step 3 if `imageExists` is `false`) once before reporting failure.

## Step 5 — Report back

Tell the user:
- The node ID that was updated
- Whether the render succeeded (HTTP 204) and verification passed (`valid: true`)
- Any errors
