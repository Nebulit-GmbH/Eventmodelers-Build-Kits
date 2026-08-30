---
name: eventmodeling-slicing-event-models
description: "Identify feature slices directly from a completed event model's timeline and create slice definitions on the board — each COMMAND becomes a state-change slice, each READMODEL becomes a state-view slice, each AUTOMATION becomes an automation slice. Use after completing event modeling to define slice boundaries and note event dependencies between them. Do not use for: organizational team structure based on Conway's Law (use eventmodeling-applying-conways-law), planning before the event model is complete (complete the full model first using eventmodeling-orchestrating-event-modeling), or 'add the next slice' when every existing element already has one (use add-next-slice — this skill only makes existing elements explicit, it never invents new ones)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Slicing Event Models

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` (in particular the **Slices** section) only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

> Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

**Purpose**: Turn a completed event model's timeline into explicit slice definitions on the board, and note the event dependencies between them.

**When to Use**:
- After completing the full event model (commands, events, read models are in place)
- To make slice boundaries explicit on the board before implementation
- To see which slices' events other slices depend on

---

## Core Concept: A Slice Is One Command, One Read Model, or One Automation — Never Combined

A **Feature Slice** is the thinnest possible vertical cut through the model — exactly one decision or one query:

```
state-change slice = SCREEN/Processor → COMMAND → EVENT(s)
state-view slice   = EVENT(s) → READMODEL → SCREEN/Processor
automation slice   = EVENT(s) → AUTOMATION → COMMAND → EVENT(s)
```

A slice never mixes a COMMAND and a READMODEL — the platform models these as two distinct slice types (`state-change` and `state-view`). If a "feature" needs both a command and a read model (e.g. "place an order" needs the `PlaceOrder` command *and* an `OrderDetailView` read model), that's **two slices**, not one.

**Key characteristics**:
- Exactly one COMMAND (state-change), exactly one READMODEL (state-view), or one AUTOMATION's command — never combined
- Named after that command, read model, or automation
- Independently deployable
- Communicates with other slices via events only

---

## Slices Already Exist in the Timeline

By the time an event model is complete, the slices are already implied by the timeline's structure. This skill's job is to make them explicit on the board — not to invent broader groupings.

Walk the timeline column by column:
- Every **COMMAND** → one `state-change` slice, named after the command
- Every **READMODEL** → one `state-view` slice, named after the read model
- Every **AUTOMATION** → one `automation` slice, named after the automation (or the command it issues)

---

## Step 1: Resolve the Timeline

`$TL` (the timeline/chapter UUID) is required for every call below. If it wasn't given up front, resolve it before doing anything else:

Prefer MCP:
```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 1: Resolve the Timeline".

- **Exactly one chapter** → use it automatically, tell the user which one was selected.
- **Multiple chapters** → list them by name/ID and use `AskUserQuestion` to ask which one to slice.
- **No chapters** → stop and tell the user to create a chapter/timeline first (e.g. via the `/timeline` skill).

## Step 2: Enumerate Commands, Read Models, and Automations

Use `spec-info` (or existing board knowledge) to list every COMMAND and READMODEL node across the resolved timeline — `spec-info` only ever returns EVENT/COMMAND/READMODEL, never AUTOMATION, so pass `elementTypes` to skip the EVENT rows you don't need here:

Prefer MCP:
```
mcp__eventmodelers__get_spec_info { "boardId": "<BOARD_ID>", "timelineId": "<TL>", "elementTypes": ["COMMAND", "READMODEL"] }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 2: Enumerate Commands, Read Models, and Automations — spec-info".

Separately, enumerate AUTOMATION nodes via `get_nodes { "boardId": "<BOARD_ID>", "type": "AUTOMATION", "chapterId": "<TL>" }` — `spec-info` cannot return them.

`spec-info` doesn't include the column each element sits in, so fetch the chapter node to resolve it — `projection: "cells"` returns just `{rows, columns, cells}`, not the whole chapter node:

Prefer MCP:
```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<TL>", "projection": "cells" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 2: Enumerate Commands, Read Models, and Automations — Chapter Node".

For each filtered element, find the cell whose `nodeId` matches the element's `id` — the `columnId` is the cell `id` with the leading `<rowId>-` (36 chars + hyphen) stripped off. Record `{ elementId, elementType, title, columnId }` for every COMMAND, READMODEL, and AUTOMATION.

Check which columns already have a slice, so you don't create duplicates:

Prefer MCP:
```
mcp__eventmodelers__list_slices { "boardId": "<BOARD_ID>" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 2: Enumerate Commands, Read Models, and Automations — Check Existing Slices".

A column already has a slice if its element's title matches an existing slice's title.

## Step 3: Define slices

For every column from Step 2 that doesn't already have a matching slice, mark each **existing** column as a slice via the **slice-definitions** endpoint — batch all of them into one call rather than one call per column:

Prefer MCP:
```
mcp__eventmodelers__create_slice_definitions { "boardId": "<BOARD_ID>", "timelineId": "<TL>", "slices": [
  { "columnId": "<colId1>", "title": "PlaceOrder" },
  { "columnId": "<colId2>", "title": "OrderStatusView" }
] }
```
(`create_slice_definition`, singular, still exists for a one-off single-column case, but prefer the batch form here since Step 3 is defining every remaining column's slice in one pass.)

**Fallback (no MCP):** see `references/api-fallback.md` — "Step 3: Define Slices".

- COMMAND column → title = command name (state-change slice)
- READMODEL column → title = read model name (state-view slice)
- AUTOMATION column → title = automation name, or the command it issues (automation slice)

Use **`create_slice_definitions`/`slice-definitions`**, never `create_slice`/the plain **`slices`** endpoint here — `create_slice`/`slices` creates a brand-new column with its own swimlane/content nodes, which would duplicate the element already placed on the timeline. `create_slice_definitions`/`slice-definitions` only adds a `SLICE_BORDER` node to each column you already resolved in Step 2. `title` always comes from the request body — it is never derived automatically from the command/read model/automation node.

**If Step 2 finds nothing to slice** (every COMMAND/READMODEL/AUTOMATION on the timeline already has a matching `SLICE_BORDER`), this skill's job is done — there is no existing element left to make explicit. Do not invent new model content here; that is out of scope for a skill whose whole design assumes the model is already complete. Invoke the `add-next-slice` skill instead — it owns deciding on and creating a genuinely new slice from scratch.

## Step 4 (Optional): Note Dependencies Between Slices

Slices depend on each other only through events — never directly:

- **Event dependency** — slice B's command or read model needs an event that slice A produces.
- **No dependency** — slices work off entirely separate events.

This is useful to surface back to the user (e.g. "`OrderDetailView` depends on `PlaceOrder`'s `OrderPlaced` event"). Slicing itself does not require planning team allocation, sprint sizing, or effort estimates — that's a separate concern from defining the slices.

---

## Quality Checklist

- [ ] Every slice contains exactly one COMMAND (state-change), one READMODEL (state-view), or one AUTOMATION — never a COMMAND and a READMODEL together
- [ ] Slice name matches the command/read model/automation title exactly
- [ ] No slice was created for an element that already has one
- [ ] Dependencies are expressed as events only, never as direct slice-to-slice calls or shared state

---

## Reference Documentation

- **[patterns.md](references/patterns.md)** — naming, boundaries, cross-slice communication patterns
- **[examples.md](references/examples.md)** — worked example of deriving slices from a timeline
- **[api-fallback.md](references/api-fallback.md)** — curl fallback calls for every MCP operation this skill uses.