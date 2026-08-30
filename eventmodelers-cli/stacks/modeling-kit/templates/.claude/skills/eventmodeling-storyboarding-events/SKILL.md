---
name: eventmodeling-storyboarding-events
description: "Step 3 of Event Modeling - Create UI storyboards/mockups showing what users see at each step. Capture all data fields needed from user perspective. Use after sequencing events. Do not use for: identifying commands or processor actions (use eventmodeling-identifying-inputs) or designing read models (use eventmodeling-identifying-outputs)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Storyboarding Events

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already specified: existing UI patterns or mockups to reference, critical data fields, and UI/UX preferences. Interview when these details haven't been discussed or when the user wants guidance on storyboarding depth.

**Interview Strategy**: Clarify UI needs, data priorities, and existing patterns to guide storyboard design. This ensures mockups capture all necessary fields without over-designing.

### Critical Questions

When UI design guidance is needed:

1. **Current UI State** (Impact: Determines if you're designing from scratch or enhancing existing)
   - Question: "Do you have: (A) Existing UI/wireframes to reference, (B) Rough sketches, (C) Starting from scratch?"
   - Why it matters: Existing UI provides constraints and patterns; starting fresh allows more design freedom
   - Follow-up triggers: If (A) → ask to share; if (C) → ask about platform/technology

2. **Most Critical Data Fields** (Impact: Determines storyboard focus and detail level)
   - Question: "Which data fields are most important for users to see? (e.g., order status, payment confirmation, tracking info)"
   - Why it matters: Knowing priorities helps avoid over-designing; users need to see what matters most first
   - Follow-up triggers: For each critical field → ask "What decisions do users make based on this data?"

3. **UI/UX Preferences & Constraints** (Impact: Shapes storyboard style and interaction patterns)
   - Question: "Any UI preferences? (A) Web, (B) Mobile, (C) Both. And design style: (A) Minimal wireframes, (B) Detailed mockups, (C) Interact prototypes?"
   - Why it matters: Platform and fidelity affect storyboard detail; mobile has different constraints than web
   - Follow-up triggers: If (C) → ask about prototype tool; if minimal → discuss what level of detail is enough

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Existing UI patterns or references
  - AND identified critical data fields
  - AND specified storyboard detail level

Then: Skip interview, proceed directly to storyboarding

Else: Conduct interview
```

**Phase 1: Context Assessment** (Questions 1-2)
- Understand existing UI context
- Identify data priorities
- Establish storyboard scope

**Phase 2: Design Guidance** (Question 3)
- Determine platform and fidelity
- Adjust storyboard detail accordingly

### Capturing Interview Findings

Document findings to guide storyboard creation:

```markdown
## Interview Findings: [Domain Name] UI

**Existing UI Context**: [Starting from scratch / Enhancing / Matching pattern]
**Most Critical Data**: [List fields in priority order]
**Platform**: [Web / Mobile / Both]
**Storyboard Detail**: [Minimal wireframes / Detailed mockups]

**Key UI Interactions**:
- [Action 1]: [What data triggers it]
- [Action 2]: [What data triggers it]

**Storyboard Focus**:
- Prioritize showing [most critical fields]
- Ensure [specific interactions] are clear
- Reference [existing patterns] for consistency
```

Optional: Write to `.trogonai/interviews/[timestamp]-storyboarding-events.interview.internal.trogonai.md`.

---

## Workflow

Given the event timeline, create UI storyboards:

### 1. Identify UI Screens/Views
Create a mockup for each state of the system: for each screen, note the trigger action, the command it produces, the resulting event, and the data fields the screen captures. A full worked example (Order Creation Form) is in `references/examples.md`.

### 2. Show State Transitions Between Screens
Document what changes when events occur: after each event, the next screen shows the fields that were just set by that event, alongside the next command the user can trigger. A full worked example (Order Confirmation, after OrderCreated) is in `references/examples.md`.

### 3. Document All Data Fields
For each screen, list what data is displayed, and the specific event each field's value originated from. A full worked example (Order Status View) is in `references/examples.md`.

### 4. Show Data Flow Through Screens
Map how data enters/exits UI: user input flows into a command, the command produces an event, and the event's data flows back out into the next screen that displays it. A full worked example is in `references/examples.md`.

### 5. Organize Screens by Swimlane (Actor/System)

**MANDATORY**: Use the **Role Catalog** from Step 1 (eventmodeling-brainstorming-events) as the source of swimlanes. Every human role in the catalog MUST have its own swimlane. Every system actor that has a UI or todo-list view gets a swimlane too — but this swimlane is narrative-only (see "Board Integration" below): system actors never get a physical actor lane of their own on the board, only human roles do.

Group screens by who interacts with them: one swimlane per human role (Customer, Seller, Support Agent, ...) listing that role's screens, plus one narrative swimlane per system actor (Payment Processor, Inventory System, ...) listing the screens/views it interacts with. A full worked example (Order domain swimlane grouping) is in `references/examples.md`.

**Validation**: If a role from the catalog has zero screens, either:
- The role is missing screens (add them), or
- The role doesn't belong in the catalog (remove it in Step 1)

This shows which actors interact with which screens and helps visualize system boundaries.

**This grouping is not just narrative for human roles** — "Board Integration" below turns each *human role's* swimlane in this catalog into its own physical actor lane on the board, so a screen's role determines which lane it is actually placed in, not just how it is described in the report. System actor swimlanes stay narrative-only: their automations are placed in the chapter's shared default actor lane, never a lane fabricated to mimic a human role's lane (see "Placing Automations" below).

### 6. Show Processor "Todo List" Pattern
For automated processors, show the todo list metaphor: each received triggering event adds a todo item, the processor checks each item's condition, and success or failure produces a corresponding event while marking the item done or failed. A full worked example (InventoryReserver's todo list) is in `references/examples.md`.

**When it comes time to elaborate scenarios for this todo list (`eventmodeling-elaborating-scenarios`), reach for a storyline rather than plain GWT scenarios.** A todo list is exactly the shape a storyline is built for: the *same* read model (the todo list itself) walked through multiple states — empty → item added → item marked done/failed — which is one narrated walkthrough, not a set of isolated before/after pairs. See that skill's "Storylines" section for the data shape and posting mechanics.

### 7. Identify Missing Data
Highlight where data doesn't have a clear source:

```
Problem: Order Status screen needs "expectedShip" date
Current state: Not in any event
Solution: Add expectedShip to InventoryReserved event

Problem: Order status needs "last updated" timestamp
Current state: No tracking of when last change occurred
Solution: Every event includes timestamp
```

## Board Integration

Before starting the analysis, read existing screen nodes from the board to avoid designing screens that already exist. Screens created by this skill default to HTML_SCREEN, but older boards may still have plain SCREEN (sketch) nodes — check both types:

**Prefer MCP:**
```
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "HTML_SCREEN" }
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "SCREEN" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Board Integration — Check existing screen nodes".

After completing the screen analysis, use the `handle-comment` skill to post a QUESTION comment on any screen node where data fields are unclear or missing sources are identified.

## Resolve One Actor Lane Per Human Role (do this once, before placing any screens)

**Each human role gets its own physical lane — never place two different human roles' screens in the same actor row.** **System actors and processors are not part of this map** — they are never given a labeled lane of their own; every automation renders in the chapter's shared default actor lane instead (see "Placing Automations" below). A chapter is created with exactly one default `actor` lane, but a chapter can hold several actor-type lanes at once (`learn-eventmodelers-api` §2, `POST .../lanes`). Build a role→lane map covering human roles only, once per chapter, before the screen-placement loop, instead of resolving it screen-by-screen:

1. Fetch the chapter and collect every row where `type === "actor"`, keyed by its `label`:

   **Prefer MCP** — `projection: "cells"` returns just `{rows, columns, cells}`, not the whole chapter node:
   ```
   mcp__eventmodelers__get_node { "boardId": "$BOARD_ID", "nodeId": "$CHAPTER_ID", "projection": "cells" }
   # → rows — collect every row where type === "actor" into { label → rowId }
   ```

   **Fallback (no MCP):** see `references/api-fallback.md` — "Resolve One Actor Lane Per Human Role — Step 1: Fetch the chapter's actor rows".

2. For every **human role only** in the Role Catalog (Step 1's swimlane list above), check the map for a `label` that matches the role name (case-insensitive). If found, reuse that `rowId`. **Skip system actors/processors entirely** — do not create or look up a lane for them here; they never get an entry in this map.

3. **If no matching lane exists, create one** — labeled with the role name, so the lane is visibly identifiable on the board:

   **Prefer MCP:**
   ```
   mcp__eventmodelers__add_lane { "boardId": "$BOARD_ID", "timelineId": "$CHAPTER_ID", "type": "actor", "label": "<Role Name>" }
   ```

   **Fallback (no MCP):** see `references/api-fallback.md` — "Resolve One Actor Lane Per Human Role — Step 3: Create a new actor lane".

   Add the returned `rowId` to the map under that role's name. Do this once per role, not once per screen.

4. **Leave the chapter's original default actor lane alone** — there is no rename endpoint for an existing lane, so don't try to relabel it or force the first role into it. It is fine for it to stay unused; every role, including the first one, gets a freshly labeled lane from Step 3.

The result is a `{ roleName: actorRowId }` map, covering human roles only, used by every SCREEN placed in this chapter (Step A below) — resolve it once, not per screen, and re-fetch/extend it only if a new human role appears mid-session that wasn't in the original catalog. **AUTOMATION nodes never consult this map** — they always target the chapter's default actor lane (see "Placing Automations" below).

## Mandatory Field Definitions on Screen Nodes

> **CRITICAL: Every screen node MUST include `meta.fields` with a `mapping` on every field.** A screen without fields cannot show data lineage — it becomes impossible to verify that all displayed data has a source event or command. This applies regardless of which content type the screen renders as (HTML_SCREEN by default, or SCREEN when a sketch was explicitly requested).

There are two types of screens, and each type has a different `mapping` source:

### Command screen (input/action screen)

An **input screen** captures data that will be sent as a command. Its fields map to the command they feed into.

| Field type | `mapping` | `generated` | Example |
|---|---|---|---|
| User types a value | `"<CommandTitle>.<fieldName>"` | `false` | `"ReserveBike.bikeId"` |
| Read from session | `"session:<fieldName>"` | `false` | `"session:customerId"` |
| Pre-populated from a previous event | `"<EventTitle>.<fieldName>"` | `false` | `"BikeReserved.stationId"` |
| Calculated for display only (not sent to command) | `"derived:<expression>"` | `true` | `"derived:sum(items.price)"` |

### View screen (output/read model screen)

A **view screen** displays data read from a Read Model. Its fields map to the read model that serves the data. View screens are placed adjacent to their read model in Step 5 (Identifying Outputs) — during storyboarding, record the intended read model name as the source even if the read model hasn't been designed yet.

| Field type | `mapping` | `generated` | Example |
|---|---|---|---|
| Displayed from a read model | `"<ReadModelTitle>.<fieldName>"` | `false` | `"ActiveReservationView.status"` |
| Displayed from a direct event (no read model yet) | `"<EventTitle>.<fieldName>"` | `false` | `"BikeReserved.startTime"` |
| Calculated/formatted on the client | `"derived:<expression>"` | `true` | `"derived:formatDuration(durationMinutes)"` |

### Example: command screen fields

```json
{
  "type": "HTML_SCREEN",
  "title": "Reserve a Bike",
  "fields": [
    {"name": "bikeId",      "type": "String",   "example": "bike-17",               "mapping": "ReserveBike.bikeId"},
    {"name": "stationId",   "type": "String",   "example": "stn-03",                "mapping": "ReserveBike.stationId"},
    {"name": "startTime",   "type": "DateTime", "example": "2026-06-01T09:00:00Z",  "mapping": "ReserveBike.startTime"},
    {"name": "endTime",     "type": "DateTime", "example": "2026-06-01T17:00:00Z",  "mapping": "ReserveBike.endTime"},
    {"name": "bikeCategory","type": "String",   "example": "City Bike",             "mapping": "AvailableBikeView.category"},
    {"name": "dailyRate",   "type": "Decimal",  "example": "0.10",                  "mapping": "AvailableBikeView.ratePerMinute"}
  ]
}
```

### Example: view screen fields (Read Model as source)

```json
{
  "type": "HTML_SCREEN",
  "title": "Reservation Confirmed",
  "fields": [
    {"name": "reservationId",  "type": "String",   "example": "res-001",               "mapping": "ActiveReservationView.reservationId"},
    {"name": "bikeName",       "type": "String",   "example": "City Bike — Gazelle",   "mapping": "ActiveReservationView.bikeName"},
    {"name": "stationName",    "type": "String",   "example": "Central Park East",     "mapping": "ActiveReservationView.stationName"},
    {"name": "startTime",      "type": "DateTime", "example": "2026-06-01T09:00:00Z",  "mapping": "ActiveReservationView.startTime"},
    {"name": "expiresAt",      "type": "DateTime", "example": "2026-06-01T09:30:00Z",  "mapping": "ActiveReservationView.expiresAt"},
    {"name": "estimatedCost",  "type": "Decimal",  "example": "48.00",                 "mapping": "derived:durationHours × AvailableBikeView.ratePerMinute × 60"}
  ]
}
```

### Connected-element rule (critical constraint)

> **A field `mapping` may only reference an element that is connected to this SCREEN via a board connection arrow.**
>
> - A command screen may only map to: the COMMAND it submits, the SCREEN's own input (user-input), or a READ MODEL whose `READMODEL → SCREEN` arrow points to this screen.
> - A view screen may only map to: the READ MODEL connected to it via a `READMODEL → SCREEN` arrow, or derived expressions.
> - If a mapping references an element that is not yet connected — for example, `AvailableBikeView.category` when no such read model exists on the board — that is a **gap**. It signals either:
>   1. A read model is missing and must be created in Step 5 (Identifying Outputs), or
>   2. The connection arrow is missing and must be added.
>
> **When you encounter a mapping that cannot resolve to a connected element, write the mapping as-is but flag it as a gap in the completeness notes.** Do not invent connections that don't exist.

Every field must also set `"cardinality"` — use `"Single"` unless the field genuinely displays/collects a list of values (e.g. a repeated line-item row), in which case use `"List"`. Default to `"Single"` when unsure. Only add the fields the screen actually shows or captures — do not add speculative fields; enrich later via `/attributes`.

A screen that only has a title and no fields is an empty placeholder — place the fields before moving on.

## Mandatory Screen Rendering

Every screen node requires rendered content. **HTML_SCREEN (via the `html-screen` rendering path below) is the default for every screen** — render a real HTML/CSS mockup, not a wireframe sketch. Only use the sketch path (plain SCREEN node, grid elements) when the user's request explicitly asked for a "sketch", "wireframe", or "low-fidelity mockup". The correct order for every screen is:

**Step A — Compute the cell ID.** This applies to SCREEN nodes (human roles only) — AUTOMATION nodes follow "Placing Automations" below instead. Screens go in **that screen's own role's actor lane** in their target column — look up `actorRowId` from the role→lane map built above, keyed by the screen's role (e.g. "Admin", "User"). Never fall back to "the" actor lane as if there were only one.

1. Determine the target column (same column as the event/command for a command/input screen, OR the same column as the read model for a view/output screen — one column to the right only if that shared column isn't available).
2. `actorRowId = roleLaneMap[<this screen's role>]` — the map was already resolved once for the whole chapter; do not re-fetch the chapter per screen. If this screen's role is genuinely new (wasn't in the original Role Catalog), resolve/create its lane now the same way (see above) and add it to the map before continuing.
3. `cellId = actorRowId + "-" + columnId`

**Step B (default) — Create the HTML_SCREEN node and render it in one atomic call.** Use `create_screen` with `contentType: "html"` — this creates the node, places it in `cellId`, and renders its pages together, so there is no window where the node exists without content:

**Prefer MCP:**
```
mcp__eventmodelers__create_screen {
  "boardId": "<BOARD_ID>",
  "contentType": "html",
  "nodeId": "<node-uuid>",
  "chapterId": "<CHAPTER_ID>",
  "cellId": "<actorRowId>-<columnId>",
  "pages": ["<div>...</div>"],
  "description": "<concise description of what this screen shows>",
  "fields": [ /* per "Mandatory Field Definitions" below — set in this same call */ ]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Mandatory Screen Rendering — Step B: Create the HTML_SCREEN node".

The MCP `create_screen` call above already sets `meta.fields` (per "Mandatory Field Definitions" below) in the same call — no separate `node:changed` follow-up needed when using MCP.

A storyboard screen is placed at a *provisional* position — Steps 4 and 5 wire it to its COMMAND / READMODEL once those exist, and may move it first. Pass `autoConnect: false` on `create_screen` / `create_screens` here so the placement doesn't pre-wire the screen to whatever happens to sit in the adjacent column; the real `SCREEN → COMMAND` and `READMODEL → SCREEN` edges are created deliberately in Steps 4 and 5. When creating several screens whose HTML is already authored, use `create_screens` (batch) with `autoConnect: false`.

Design the page(s) as real HTML/CSS, following the `html-screen` skill's guidance: write full-size markup (16px body text, generous padding — the canvas scales it down, don't shrink it yourself), one complete self-contained fragment per page (no `<html>`/`<head>`/`<body>` wrapper — the canvas adds those), no `<script>`/inline handlers (stripped server-side), and Bulma CSS classes (`title`, `button`, `is-primary`, `field`/`control`/`input`, etc. — remember heading size modifiers like `class="title is-1"`) since Bulma 0.9.4 is loaded by default. Every page MUST include real field labels matching the actual event/command fields this screen captures or displays, and at least one primary action (submit/confirm button) for command screens.

> **CRITICAL: NEVER pass an empty `pages` array.** An empty pages array produces a blank placeholder and is always wrong. You MUST design and include actual page markup before calling the render API.

**Step B (sketch path, explicit request only) — Create the SCREEN node with `cellId`** (`node:created`) — only when the user explicitly asked for a wireframe/sketch:

**Prefer MCP:**
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": 1234567890,
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<actorRowId>-<columnId>",
    "meta": {"type": "SCREEN", "title": "<Screen Title>", "fields": [...]}
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Mandatory Screen Rendering — Step B (sketch path): Create the SCREEN node".

**Step C (sketch path only) — Render the wireframe sketch immediately** (`POST /images/$NODE_ID/sketch`).

> **Do NOT call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first, causing the node to appear in two columns simultaneously. `node:created + cellId` is the single placement step — render the sketch right after.

> **CRITICAL: NEVER pass `"elements": []`. An empty elements array produces a blank, invisible screen and is always wrong. You MUST design and include actual wireframe elements before calling the sketch API.**

Call the sketch API between node creation and cell placement, with a fully designed elements array:

**Prefer MCP:**
```
mcp__eventmodelers__render_screen {
  "boardId": "$BOARD_ID",
  "nodeId": "$NODE_ID",
  "description": "<concise description of what this screen shows>",
  "elements": [
    {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"},
    {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":3,"fill":"violet"},
    {"type":"headline","gridX":2,"gridY":1,"text":"Screen Title","fontSize":16,"fill":"white","gridWidth":46},
    ...more elements...
  ]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Mandatory Screen Rendering — Step C (sketch path): Render the wireframe sketch".

Design each wireframe using the grid description language from the `storyboard-screen` skill (50×40 grid, 1 unit = 20 px):

| Element type | Required fields | Optional fields |
|---|---|---|
| `rectangle` | gridX, gridY, gridWidth, gridHeight | fill, stroke |
| `text` | gridX, gridY, text | fontSize (default 12), fill, gridWidth |
| `headline` | gridX, gridY, text | fontSize (default 20), fill, gridWidth |
| `button` | gridX, gridY, gridWidth, gridHeight, text | fill, stroke |
| `input` | gridX, gridY, gridWidth, gridHeight, text (placeholder) | fill, stroke |
| `line` | gridX, gridY, gridX2, gridY2 | stroke |
| `circle` | gridX, gridY, gridRadius | fill, stroke |

Named colors: `black` `grey` `light-violet` `violet` `blue` `light-blue` `yellow` `orange` `green` `light-green` `light-red` `red` `white` `transparent`

Every sketch MUST include at minimum:
- A full white background rectangle: `{"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"}`
- A colored header bar with the screen title
- Real UI elements matching the screen's purpose: form inputs with labelled fields, data tables or lists, status badges, action buttons
- Field labels that match the actual event/command fields this screen captures or displays
- At least one primary action (submit button, confirm button, etc.) for command screens

A screen node without rendered content (HTML pages by default, or a wireframe sketch on the explicit-request path) is an empty placeholder. It must not be left unrendered.

## Timeline Placement Rules

When placing screens on the board, follow these alignment rules:

| Screen type | Where it goes on the board |
|-------------|---------------------------|
| **Input/command screen** (triggers a command) | **The role's own actor lane, same column as the COMMAND and EVENT** it produces. The screen and command share a column — the screen sits in that role's actor lane, the command in the interaction row, the event in the swimlane row. |
| **View/output screen** (displays a read model) | **The role's own actor lane, the SAME column as the READ MODEL** it displays (READMODEL in the interaction row, screen in the actor row — a downward connection, not a backward one). Only bumps one column to the right if that column's interaction row is already taken by something else. If the screen displays more than one read model, only the primary one shares its column — every additional read model goes further left. This column is finalised in Step 5 (Identifying Outputs) — during storyboarding, just document which read model each view screen will query. |

> **Do not create standalone screen columns that are disconnected from commands or read models.** Every screen must either share its column with the command it submits, or share its column with the (primary) read model it displays.

### Multi-component screens are broken apart in Step 5, not here

Storyboarding renders **one plain screen per screen state** — do not pre-split a screen into per-component copies here. Deciding how many components a view screen actually has, and breaking it apart into one highlighted copy per component, is `eventmodeling-identifying-outputs`'s job (its "Step 5a — Enumerate consumers and identify components" and "Step 5c — Break apart multi-component screens into copies"), because a component is defined by its read model and read models aren't designed until Step 5. During storyboarding, just place the single screen in the same column where its read model will end up (per the table above); document which read model it will query even before that read model exists.

### Placing Automations

When a processor or system actor reacts to events automatically (no human interaction), place an **AUTOMATION** node in the chapter's **default actor lane** instead of a SCREEN — never create, reuse, or look up a per-system-actor lane for it, and never resolve it through the human role→lane map above. Automations go in the same column as the COMMAND they trigger. Unlike a view screen, an automation's READMODEL is never in that same column — the automation's own column already holds the COMMAND it issues (interaction row), so the read model that feeds it always goes one column to the left.

**Do not design automation actor lanes to mimic human ones.** A "Payment Processor" or "Inventory System" swimlane in the narrative report (Step 5 above) is a documentation grouping only — it must never be materialized as its own labeled `actor`-type lane on the board. Only human roles get a physical lane; every automation, regardless of which system actor it narratively belongs to, renders in the same shared default actor lane.

A column is an automation column (not a screen column) when:
- The action is triggered by the system, not a user gesture
- No human sees or interacts with the UI at this step
- The pattern is `READMODEL → AUTOMATION → COMMAND` (the processor reads state, decides, issues a command)

Examples:
- Payment gateway webhook arrives → AUTOMATION "Authorize Payment"
- Inventory check fires after payment authorized → AUTOMATION "Reserve Inventory"
- Notification service sends an email → AUTOMATION "Send Confirmation Email"

Human roles get SCREEN nodes placed in their own labeled actor lane. System actors and processors get AUTOMATION nodes placed in the shared default actor lane. Place both types during storyboarding — do not defer automations to a later step.

### Maintain a Consistent Actor Perspective Across Columns

Tell the story from **one actor's perspective as much as possible**. When walking the timeline column by column, keep placing screens in the same role's lane as the previous screen unless the process genuinely hands the story off to a different actor (e.g. a Member requests a reservation, then the Librarian must act on that request — that's a real handoff, place the Librarian's screen next). Do not alternate actors column-to-column just because a different role's read model also changed at that point — a state change only earns its own screen when someone would actually look at it as the next beat in the story, not for symmetry between lanes.

Before placing a screen, ask "whose turn is it in the story?" If the answer is still the same actor as the last screen, keep the story there — it's fine, and expected, for a stretch of consecutive columns to belong entirely to one actor while another actor's lane sits empty. It's also fine to occasionally cut away to show what another actor sees, but that should read as a deliberate narrative beat, not a mechanical alternation.

```
✅ Consistent: Member screens in cols 1, 2, 3 (their whole request flow), then Librarian screens in cols 4, 5 (their whole fulfillment flow)
❌ Checkerboard: Librarian, Member, Librarian, Member, Librarian across cols 1-5 with no real handoff driving each switch
```

### One Screen Per Column (Hard Rule)

**Never place more than one SCREEN node in the same column**, even across different actor lanes. Each column represents a single moment in the timeline. Two screens in the same column means two different interactions at the same moment — that breaks the visual narrative and always signals a design error.

```
✅ Correct: Member "Reserve Book" in col 8  |  Librarian "Confirm Checkout" in col 11
❌ Wrong:   Member "My Loans" AND Librarian "Confirm Checkout" both in col 11
```

If a second role also needs a screen related to the same event, insert a new column immediately after and place the second screen there. Prefer `mcp__eventmodelers__add_column { "boardId": "$BOARD_ID", "timelineId": "$CHAPTER_ID", "index": N }`; fallback (no MCP) is `POST /timelines/:tl/columns` with `{"index": N}` to insert at the correct position.

---

## Output Format

Older versions of this skill wrote the storyboard as a markdown document (swimlane organization, one section per screen, processor todo lists, a field traceability matrix) rather than rendering and placing screen nodes on the board — that legacy template is kept in `references/examples.md` for reference only; it is not the actual output mechanism. The actual output is the rendered HTML_SCREEN/AUTOMATION nodes placed per "Mandatory Screen Rendering" and "Timeline Placement Rules" above.

## Quality Checklist

- [ ] **Every screen has rendered content** — HTML pages by default (`create_screen`/`render_screen` with `contentType: "html"` returned success), or a wireframe sketch only when explicitly requested — no exceptions
- [ ] **No column contains more than one SCREEN node** across all actor lanes
- [ ] **Screens follow one actor's perspective across consecutive columns** — no mechanical alternation between two actors' lanes column-to-column; a different actor's screen appears only where the story genuinely hands off to them
- [ ] Every screen's wireframe shows real field labels matching the event/command fields
- [ ] Every displayed field has a source event
- [ ] Every user action maps to a command
- [ ] Commands map to events
- [ ] Data flows make sense
- [ ] No missing data sources
- [ ] State transitions are clear
- [ ] Alternative states are shown
- [ ] Error states are shown
- [ ] **Every human role from the Role Catalog has at least one swimlane**
- [ ] **Every human-role swimlane is labeled with the role name from the catalog**
- [ ] **Swimlanes organized by actor/system in the narrative report**
- [ ] **Every human role's swimlane is a real, distinct `actor`-type lane on the board (`meta.timelineData.rows`), not just a grouping in the markdown report** — no two different human roles share the same `actorRowId`
- [ ] **No system actor / processor has been given its own labeled actor lane** — every AUTOMATION node sits in the chapter's default actor lane, never a lane fabricated to mimic a human role's
- [ ] **Human role screens clearly separated from processor screens**
- [ ] **Processor todo list pattern shown for automated systems**
- [ ] **System boundaries visible through swimlane organization**

## Key Principles

1. **User-Centric**: Design from what users see and do
2. **Data Traceability**: Every field has origin and destination
3. **Completeness**: All needed data is visible
4. **Clarity**: UI clearly shows system state
5. **Consistency**: Same data presented consistently across screens
6. **Narrative Continuity**: Tell the story from one actor's perspective across consecutive columns; switch actors only for a genuine handoff, not for symmetry between lanes

## Common Patterns

### Input Screen Pattern
```
User fills form (captures command data)
  ↓
Submit button (issues command)
  ↓
Event created with form data
  ↓
Confirmation screen displayed
```

### Status Screen Pattern
```
System displays current state (from read model)
  ↓
Based on latest events
  ↓
Shows all relevant information
  ↓
Available actions based on state
```

### Error State Pattern
```
User action fails (command rejected)
  ↓
No event created
  ↓
Error message displayed
  ↓
UI allows retry or alternative action
```
