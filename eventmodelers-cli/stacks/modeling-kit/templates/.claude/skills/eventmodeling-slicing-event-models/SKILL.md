---
name: eventmodeling-slicing-event-models
description: "Identify feature slices directly from a completed event model's timeline and create slice definitions on the board — each COMMAND becomes a state-change slice, each READMODEL becomes a state-view slice, each AUTOMATION becomes an automation slice. Use after completing event modeling to define slice boundaries and note event dependencies between them. Do not use for: organizational team structure based on Conway's Law (use eventmodeling-applying-conways-law) or planning before the event model is complete (complete the full model first using eventmodeling-orchestrating-event-modeling)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Slicing Event Models

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference (in particular the **Slices** section). Do not proceed until both skills have been loaded.

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

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

- **Exactly one chapter** → use it automatically, tell the user which one was selected.
- **Multiple chapters** → list them by name/ID and use `AskUserQuestion` to ask which one to slice.
- **No chapters** → stop and tell the user to create a chapter/timeline first (e.g. via the `/timeline` skill).

## Step 2: Enumerate Commands, Read Models, and Automations

Use `spec-info` (or existing board knowledge) to list every COMMAND, READMODEL, and AUTOMATION node across the resolved timeline:

```bash
curl "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/spec-info" -H "x-token: $TOKEN"
# → { timelineId, elements: [{ id, title, type }] }
```

Filter to `type` in `COMMAND`, `READMODEL`, `AUTOMATION`.

`spec-info` doesn't include the column each element sits in, so fetch the chapter node to resolve it:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$TL" -H "x-token: $TOKEN"
# → meta.timelineData.columns: [{ id, index }]
# → meta.timelineData.cells:   [{ id: "<rowId>-<columnId>", nodeId }]
```

For each filtered element, find the cell whose `nodeId` matches the element's `id` — the `columnId` is the cell `id` with the leading `<rowId>-` (36 chars + hyphen) stripped off. Record `{ elementId, elementType, title, columnId }` for every COMMAND, READMODEL, and AUTOMATION.

Check which columns already have a slice, so you don't create duplicates:

```bash
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices -H "x-token: $TOKEN"
# → { slices: [{ id, title, status }] }
```

A column already has a slice if its element's title matches an existing slice's title.

## Step 3: Define slices

For each column from Step 2 that doesn't already have a matching slice, mark that **existing** column as a slice via the **slice-definitions** endpoint:

```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slice-definitions \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"columnId":"<colId>","title":"PlaceOrder"}'
# → 200 { nodeId, timelineId, columnId, title }
```

- COMMAND column → title = command name (state-change slice)
- READMODEL column → title = read model name (state-view slice)
- AUTOMATION column → title = automation name, or the command it issues (automation slice)

Use **`slice-definitions`**, never the plain **`slices`** endpoint here — `slices` creates a brand-new column with its own swimlane/content nodes, which would duplicate the element already placed on the timeline. `slice-definitions` only adds a `SLICE_BORDER` node to the column you already resolved in Step 2. `title` always comes from the request body — it is never derived automatically from the command/read model/automation node.

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