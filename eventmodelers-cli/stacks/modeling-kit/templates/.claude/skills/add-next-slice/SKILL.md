---
name: add-next-slice
description: Decide on and create a genuinely new slice from scratch when there's no existing COMMAND/READMODEL/AUTOMATION left to slice — the model doesn't yet suggest an obvious next capability, or every existing element already has a Done slice. Use when eventmodeling-slicing-event-models finds nothing left to make explicit. Do not use for: making an already-modelled element's slice explicit (use eventmodeling-slicing-event-models — that skill only slices existing elements, it never invents new ones).
---

# Add Next Slice

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference (in particular the **Slices** section). Do not proceed until both skills have been loaded.

**Purpose**: Given a timeline where every existing COMMAND/READMODEL/AUTOMATION already has a slice (or there's no model content at all yet), decide on a plausible next capability and create it as a brand-new slice — screen, command/read model, and event all at once.

This is the counterpart to `eventmodeling-slicing-event-models`, which only ever makes *existing* elements explicit as slices and correctly refuses to invent new ones. Something has to own deciding what comes next — that's this skill; `eventmodeling-slicing-event-models` points here whenever it finds nothing left to slice.

---

## Core Concept: A Slice Is One Command, One Read Model, or One Automation — Never Combined

Same rules as `eventmodeling-slicing-event-models` — the slice you create here must obey them too, not just slices made from pre-existing elements.

A **Feature Slice** is the thinnest possible vertical cut through the model — exactly one decision or one query:

```
state-change slice = SCREEN/Processor → COMMAND → EVENT(s)
state-view slice   = EVENT(s) → READMODEL → SCREEN/Processor
automation slice   = EVENT(s) → AUTOMATION → COMMAND → EVENT(s)
```

A slice never mixes a COMMAND and a READMODEL — the platform models these as two distinct slice types (`state-change` and `state-view`). If the capability you decide on in Step 1 needs both a command and a read model (e.g. "place an order" needs the `PlaceOrder` command *and* an `OrderDetailView` read model), that's **two slices** — create them one at a time, each its own `create_slice` call.

**Key characteristics**:
- Exactly one COMMAND (state-change), exactly one READMODEL (state-view), or one AUTOMATION's command — never combined
- Named after that command, read model, or automation
- Independently deployable
- Communicates with other slices via events only

---

## This is never the ambiguous/no-default case the per-turn "Questioning rule" allows you to stop on

"I don't know what the next capability is" is not the same as "any guess risks doing the wrong thing." A plausible next slice — the next lifecycle stage, an unaddressed affordance on an existing screen, a natural CRUD/notification gap — always exists for a working domain, and a wrong guess here costs nothing: it's just another slice on the board, easy to rename or discard later.

**Posting a comment and closing the prompt with no board mutation is not an acceptable outcome of this skill.** That only defers the same empty decision to the next identical prompt, forever. If you already posted a `QUESTION`/`TASK` comment about this exact ambiguity on a previous turn, that does not make it acceptable to do so again instead of creating something — the comment already served its purpose (flagging the assumption for a human to correct later); this turn should still create the slice.

---

## Step 1: Decide on the next capability

**If the prompt gives no specific instruction about what the next slice should be** (e.g. a bare "add the next slice"), don't ask for one — look at the previous slices already on the timeline and derive the next one yourself:

- Read the existing COMMAND/READMODEL/AUTOMATION titles and their fields in narrative order (left to right on the timeline) — they tell a story (e.g. Reserve Table → Cancel Reservation → Check-In → ...).
- Identify what the story is missing next: the natural following lifecycle stage, an unaddressed affordance implied by an existing screen (a button/link with nothing behind it yet), or a CRUD/notification gap the existing entity clearly has (created but never updated/cancelled/queried in detail, an action with no confirmation view, etc.).
- Prefer the option that most directly continues the existing narrative over one that starts an unrelated new thread — the goal is the slice that makes the most sense as *next*, not just *any* plausible slice.

If a specific instruction *is* given (the prompt names a capability, or references a comment/discussion that does), use that instead of inferring one.

If, after looking at the existing slices, it's genuinely unclear which of several equally-reasonable next steps to pick, post a `QUESTION` comment (via `handle-comment`) noting the assumption you're about to make — then make it and create the slice in the same turn, every time. Never stop at just the comment.

## Step 2: Create the slice

```
mcp__eventmodelers__create_slice { "boardId": "<BOARD_ID>", "timelineId": "<TL>", "type": "state-change", "nodes": {"interaction": {"title": "CancelReservation"}} }
```

Pick `type` based on what you decided in Step 1 — `state-change` for a new command, `state-view` for a new read model, `automation` for a new automation. Always pass `nodes.interaction.title` as the command/read model/automation name you decided on in Step 1 — per the Core Concept above, the slice is *named after that element*, and the backend only derives the slice title from this field; omitting it produces a useless generic "State Change"/"State View"/"Automation" label instead. This also creates the slice's `SLICE_BORDER` automatically — no separate `create_slice_definition` call needed.

**Fallback (no MCP):**
```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slices \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"state-change","nodes":{"interaction":{"title":"CancelReservation"}}}'
```

## Step 3: Replace the placeholder screen — matching the board's existing style

For `state-change`/`state-view`, the actor node this creates is an `HTML_SCREEN` — but only as a **stub**: a single visibly-placeholder page ("Untitled screen — design pending"), never real content. Never leave it at that:

1. Look up the board's other screens on this timeline (`mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "HTML_SCREEN" }`, or the equivalent already-loaded slice data) and note their established visual style — layout conventions, color/tone, recurring components (nav bar, card style, button treatment).
2. Invoke the `html-screen` skill on the new stub node, passing a `description` that covers **both** what this screen should contain (derived from the new command/read model's fields) **and** the style to match (derived from what you just observed in step 1). `html-screen` has no visibility into other screens on the board — gathering that context and folding it into the description is this skill's job, not something to expect `html-screen` to do on its own.
3. Default to `html-screen` here, never `storyboard-screen` (wireframe sketch) — a sketch is only for an explicit user request for one.

## Step 4: Report back

Tell the user (or, in an autonomous modeling session, note it in the turn's progress line):
- The capability you decided on and why
- The slice type and node IDs created
- Whether the placeholder screen was replaced with a real design, and what style it matched