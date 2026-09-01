---
name: eventmodeling-orchestrating-event-modeling
description: "Orchestrates complete event modeling workflow from requirements to code generation. Models architecture as UI/Processor → Command → Event → Read Model. Use when modeling a domain end-to-end from requirements. Do not use for: executing a single step in isolation (invoke the named step skill directly, e.g., eventmodeling-brainstorming-events for Step 1 or eventmodeling-elaborating-scenarios for Step 7), or validating an already-completed model (use eventmodeling-validating-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Orchestrating Event Modeling

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

Coordinates the 11-step Event Modeling workflow. Each step delegates to a
specialized skill — this skill holds the sequence, transition conditions, and
what to carry forward between steps.

## Do not cut corners to save tokens or effort

A correct model is the entire point of this workflow — it is not optional scope that can be traded away when a step gets expensive or a placement rule turns out to be inconvenient. If satisfying a rule (a todo-list automation, a missing read model for a command screen, a proper translation-automation chain for an external trigger) requires more columns, more nodes, or more tool calls than expected, that is not a signal to remove the requirement or invent an exemption — it is a signal to spend the additional calls. Budget and token cost are never a valid reason to:
- delete an automation, event, or read model that the rules call for, in order to avoid a placement conflict — solve the placement conflict instead (see the column-layout patterns throughout this file and in `eventmodeling-identifying-outputs`);
- label a command screen's missing read model as "session-context" or "accepted debt" when the rules don't actually exempt it — only a genuinely blank creation form is exempt; every other command screen needs a real read model, even a small identity/lookup one;
- collapse a two-chained-translation-automation requirement (external EVENT → translation automation → internal EVENT → worker automation) into a single direct connection because it's simpler.

If you catch yourself reasoning "this would need N more columns/nodes, let me simplify instead" — that is exactly the moment to stop and do the correct, larger version. A model with more nodes that is right is a better outcome than a smaller one that skips required elements. Flag genuine scope trade-offs to the user explicitly rather than resolving them unilaterally by cutting the model.

---

## Timeline Alignment Rules

These rules govern how every element is placed on the board. Enforce them throughout the workflow.

### State-change slice (SCREEN → COMMAND → EVENT)
- COMMAND and EVENT go in **the same column** — the command produces the event.
- SCREEN (input/command screen) goes in the **actor row of that same column**.
- **A COMMAND never stands alone.** Every COMMAND must have exactly one issuer in the actor row of its own column: a SCREEN when a human triggers it, an AUTOMATION when a processor or external-system integration triggers it. There is no third option and no exemption — a command with an empty actor-row cell is an unresolved gap the moment it's placed, not something to leave for a later step to notice. This applies just as much to a command that only *represents* an externally-triggered integration event crossing into this chapter (Step 1/Step 6 territory) as to any other command: place an AUTOMATION for the external actor even when that actor's own decision logic is out of scope for this model — the automation node documents *that* something triggers the command, not *how* it decides to.

  **Before placing that automation, check whether the trigger is already a placed EVENT node in a second (external) swimlane** (from Step 1/brainstorming), as opposed to an unmodeled webhook/API call with no such node. These are not the same case:
  - **No pre-existing EVENT node** (a plain webhook/API trigger) — place the AUTOMATION+COMMAND in one column as usual; the command produces a new EVENT there. Nothing further needed in Step 4.
  - **A pre-existing EVENT node in another system's swimlane** — do **not** place the AUTOMATION/COMMAND in that event's column, and do **not** connect `COMMAND → EVENT` to it: that event already happened in another system and cannot be "produced" by a command in this one. Attribute the command to the Role Catalog and list it in the Command Catalog as *pending Step 4b*, but leave its placement and every one of its connections to Step 4b — placing it here only produces a wrong connection that Step 4b then has to delete and redo.

  Every AUTOMATION placed this way still needs its own todo-list READMODEL, and one further rule governs *how* it's triggered: **an automation can only ever be directly triggered by an internal event — never by another system's event.** A signal arriving from a second swimlane must first be translated into an internal event by its own dedicated translation automation (external EVENT → todo-list READMODEL → translation AUTOMATION+COMMAND+*internal* EVENT) before any worker automation reacts to it — never one automation whose todo list is opened by the external EVENT directly. There is no exemption for a "pure relay" automation either — even one triggered only by its own resulting event still gets a todo list that opens and closes within the same slice. This is designed immediately after Step 4, in **Step 4b — Design Automation Chains** (`eventmodeling-designing-automation-chains`), precisely so it's resolved before Step 5 ever has to catch it as a gap.

### State-view slice (EVENT → READ MODEL → SCREEN)
- READ MODEL goes in the **interaction row** of a column that is **immediately after the primary source event's column** — never at the end of the timeline.
- SCREEN (view/output screen) goes in the **actor row of the same column as the READ MODEL**. When that column's interaction row is unavailable to the read model (e.g. already holds a COMMAND), the **read model** gets a new column immediately **before** the screen's — the screen's own position is never moved to resolve this (`eventmodeling-identifying-outputs`'s Step 5g has the full mechanics).
- If the primary source event's column already has a COMMAND in the interaction row, insert a **new column immediately after** (using `index = currentColumnIndex + 1`) and place the READ MODEL there.

### Never stack read models at the end
Placing all read models in new columns at the very end of the timeline severs the visual connection to the events they're derived from. The board must show a coherent left-to-right narrative where each slice is self-contained.

### One read model per component, not one read model per screen
A read model does not necessarily serve a whole screen — **one component in a screen resembles one read model.** Storyboarding (Step 3) only produces a plain screen per screen state; it does not decide components. That decision, and the work of breaking a multi-component screen apart into copies, happens in Step 5 (Identifying Outputs), because a component is defined by its read model.

A screen-wide read model that has to aggregate from events scattered across many columns is the most common source of unnecessary coupling — a "god read model." A screen with a stats row and a list below it is two components: two read models and two screen copies of the *same page* (same screen name on both copies; the copies differ only in which component is marked/highlighted crisp while the other is blurred/dimmed), not one screen-wide read model. Each narrower read model then sits naturally close to its own source event, and the `EVENT → READMODEL → SCREEN` chain for each component stays short and forward. See `eventmodeling-identifying-outputs`'s "Step 5a — Enumerate consumers and identify components" and "Step 5c — Break apart multi-component screens into copies" for the mechanics — apply this during Step 5, before the placement problem exists, rather than reordering columns to patch it afterward.

The narrow exception to "prefer a new read model" is a single homogeneous list/table (e.g. a catalog whose per-row status comes from many different lifecycle events): that is still **one** component — you cannot split "one field's value" into multiple read models just because many event types feed it, and a field like that legitimately keeps its wide fan-in. Reach for this exception only after genuinely failing to find a split, not as the default read. **But treat this as a per-field fact about one specific field's irreducible fan-in, never as a label you apply to the whole read model or the whole screen.** There is no "roll-up component" exemption that, once invoked, clears every other field sharing that node from scrutiny — that shortcut is exactly how a god read model smuggles in unrelated fields (e.g. bundling a book's title/author — needing only its own 1-2 events — into the same node as a copy's live availability status, just because both happen to render on the same page). Run the checks below on **every** read model, every time, regardless of whether some field on it was already justified as wide.

### The >3-events heuristic — evaluate every field, every time

**Wide fan-in is the absolute exception, not a comfortable resting point.** Default to assuming a wide read model is wrong and a new, narrower read model is almost always the better answer — the burden of proof is on keeping the connections, not on splitting them. Whenever a read model ends up connected to more than 3 events, your first hypothesis should be "this can and should become two (or more) read models," and you only abandon that hypothesis after the two checks below genuinely fail to find a split — not because the component looks homogeneous at a glance, not because a prior step called it a roll-up, and not because splitting would mean more nodes/columns on the board. More nodes is a fine outcome; a wide read model that could have been narrower is not.

Two distinct checks, both required, and neither is satisfied by having done it once for a different field on the same node:

1. **Field-level minimality.** Re-derive, field by field, exactly which connected events each field actually needs. Any event connected to the read model that no field's `mapping` traces back to is a prunable connection — remove it (`set_connection` with `action: "remove"`), regardless of how the read model got wide.
2. **Kind-of-computation split.** Within one visual component, a field needing 1-2 simple, non-overlapping events (e.g. a monotonic counter incremented/decremented by its own dedicated events, or an identity/fact field set once and occasionally updated) is a fundamentally different kind of computation from a field needing wide fan-in across a whole entity's lifecycle (e.g. "is this available right now," which by construction depends on every event that can change that state). When a read model bundles both kinds, split the wide-fan-in field(s) out into their own read model and screen-copy — always, with no exception for "but the wide field is a legitimate roll-up so the node as a whole is fine." A legitimate wide field never excuses a narrow field riding along in the same node, and a handful of narrow fields never excuses leaving a wide field un-isolated.

After both checks, a read model may still be wide because one or more of its fields have irreducible, genuinely-single-field fan-in — that is an outcome you document (per "Documenting decisions inline" above, naming the specific field and why), not a category ("roll-up component") you assign to the node up front and stop checking. Re-run this evaluation on every read model at every step that touches it, including ones a prior step already looked at — a field added or a screen re-scoped later can introduce exactly the bundling problem this heuristic exists to catch.

### Recognizing a dedicated business event behind a derived condition

This is a **business-modeling decision, not a technical one** — it is not triggered by a read model's fan-in count and is not a fix for anything the >3-events heuristic flags. A read model landing on wide fan-in is at most a symptom that might prompt you to ask the question below; it is never the reason to answer it one way or the other, and the question is worth asking regardless of how many events are involved.

The question to ask is simply: **is this fact worth a new event?** A derived condition — "is this available right now," "has this moved to its next stage," etc. — is worth its own event when it's a fact a domain expert would recognize and name in its own right (not just "some field I compute"), and when that fact is valuable to a later step in the process — another automation would react to it, a different bounded context would want to subscribe to it, some downstream process needs to trigger off of it. If both hold, it deserves to exist as its own dedicated event — e.g. "the copy was marked available" — not just as derived read-model logic recomputed from several other events.

When that's the case, model it as its own event, produced via the same todo-list + automation translation pattern `eventmodeling-designing-automation-chains` (Step 4b) uses for external integrations, but triggered internally by whichever raw events can produce that outcome. If the condition is purely for display, with nothing downstream that would ever act on it, it stays a plain read-model projection — no new event needed, no matter how many raw events feed it or how wide the resulting fan-in looks.

**Only fold together causes that are genuinely redundant for the same outcome — never causes that carry distinct business meaning.** A derived condition's causes typically split into two groups: several distinct events that all mean the *same* thing from the business's point of view (e.g. `CopyReservationReleased`, `CopyReturned`, and `CopyReturnedFromRepair` all mean "the copy is available again"), and several distinct events that each mean something the business still wants told apart (e.g. `CopyReserved` → Reserved, `CopyCheckedOut` → CheckedOut, `CopySentForRepair` → UnderRepair, `CopyReportedLost` → Lost, `CopyWithdrawn` → Withdrawn). Only the first group is safe to consolidate — a dedicated event like `CopyMarkedAvailable` collapses "N different reasons, same outcome" into one reusable signal without losing information. Collapsing the second group into something like a generic `CopyMarkedUnavailable` would erase the *why*, which some downstream consumer may actually need — leave those as separate events and direct connections, even though the read model's fan-in then stays wider than the fully-consolidated ideal. That remaining fan-in is not a failure of anything — it means those events are each individually meaningful, not synonymous with each other, and collapsing them would have been the actual modeling mistake.

### No unplaced elements (0,0 nodes)

After each step that creates elements (Steps 1–5), scan for any nodes that have no cell reference and are stranded at the default canvas position (0,0). These arise when `node:created` is called without `cellId`.

For each timeline in scope, check all node types that should be in cells.

**Prefer MCP:** run `validate_model` once per chapter — the `unplaced` findings it returns are exactly this scan, plus five other structural checks, in one call and with a compact response (no full node objects):
```
mcp__eventmodelers__validate_model { "boardId": "$BOARD_ID", "chapterId": "$TIMELINE_ID" }
```
Only fall back to per-type `get_nodes` (`chapterId`-scoped, once each for `EVENT`, `COMMAND`, `READMODEL`, `SCREEN`, `AUTOMATION`) when you also need the node bodies for another reason in the same pass.

**Fallback (no MCP):** see `references/api-fallback.md` — "No unplaced elements (0,0 nodes) — Scan for unplaced nodes".

For each returned node, check whether it has a valid cell assignment. A node without a `cellId` (or with `chapterId` missing) is unplaced.

**For each unplaced node:**
- **If it belongs in the current model** → compute the correct `cellId` and place it.

  **Prefer MCP:** the node already exists but has never been assigned a cell, so this is a placement, not a repositioning — use `drop_node_to_cell` (not `move_node_in_timeline`, which is for moving a node that already occupies a different cell):
  ```
  mcp__eventmodelers__drop_node_to_cell { "boardId": "$BOARD_ID", "timelineId": "<chapterId>", "cellId": "<rowId>-<colId>", "nodeId": "<nodeId>", "nodeType": "<TYPE>" }
  ```

  **Fallback (no MCP):** see `references/api-fallback.md` — "No unplaced elements (0,0 nodes) — Place a found unplaced node".
- **If it is an orphan (duplicate or no longer needed)** → delete it.

  **Prefer MCP:**
  ```
  mcp__eventmodelers__delete_node { "boardId": "$BOARD_ID", "nodeId": "<nodeId>" }
  ```

  **Fallback (no MCP):** see `references/api-fallback.md` — "No unplaced elements (0,0 nodes) — Delete an orphaned node".

Never leave an unplaced node on the board when proceeding to the next step.

### No backward arrows
The timeline must always progress left-to-right — this is the goal to design toward, not just a validation check to run afterward. Every connection arrow — SCREEN→COMMAND, COMMAND→EVENT, READMODEL→SCREEN, READMODEL→AUTOMATION, AUTOMATION→COMMAND — must point to the right or downward (within the same column). A right-to-left arrow among these is always a layout error, full stop.

**`EVENT → READMODEL` has exactly one exception, and it is narrow.** A read model that already carries a `READMODEL → AUTOMATION` edge — i.e. a todo-list read model feeding an automation, per `eventmodeling-designing-automation-chains` (Step 4b) — may also be fed by a later-column event closing an item it opened earlier. That accumulator shape is what the todo-list pattern exists for, and it is confirmed against the platform API (`learn-eventmodelers-api` §3 — `POST .../connections`). **Outside that one case, the platform rejects the connection, for good reason:** without it, a read model would become a moving target for whatever screen or scenario later reaches back into it.

For every other read model — in particular one feeding a SCREEN rather than an AUTOMATION — never connect a later event back into it, no matter how convenient. If a later event needs to update what a screen already shows, resolve it the same way Step 5c resolves multi-component screens: place a **new copy of the read model** in (or immediately after) the later event's column, connect the later event forward into that copy, and place a matching copy of the same screen there (same title, updated data, optionally re-marked/highlighted per `html-screen`'s Marks feature). Never link the new copy back to the earlier instance.

A wide fan-in read model (many connected events, one column) is a different problem with a different fix — see "one read model per component" and the >3-events heuristic above. It is never a justification for a backward arrow. The one real signal to treat as a prunable connection regardless of column position is a **connected event that isn't actually used by any field** on the read model.

Before wiring any of the five forward-only pairs, verify that `column(source) ≤ column(target)`. If this is violated:
- Move the earlier-placed element to the correct column, OR
- Insert a new column at the right position to restore the correct order.

Screens placed during Step 3 (Storyboarding) are provisional positions. Steps 4 and 5 may need to move them to align with the commands or read models placed later.

### Column insertion
Use `add_column` with `{"index": N}` to insert a column at a specific position (shifts existing columns right) — or, when the insertion point is "immediately before/after a node already on the board" rather than a numeric position you'd otherwise have to compute, pass `beforeNodeId`/`afterNodeId` instead and let the tool resolve the index itself. Do not use no position at all (append) when placing read models or view screens — always target the correct position.

**Suppress auto-connect when inserting into an existing chain.** When you insert columns next to nodes that are *not* meant to connect to what you're about to place — e.g. slotting an output read model's column in beside an automation-chain column — the node placement's default auto-connect will wire the new node to whatever type-compatible node happens to sit in its own or the previous column (the "nearest event to the left"). That is the source of the recurring stray-edge cleanup. When the placement you're about to make should be wired only by your own explicit `set_connections` batch, pass `autoConnect: false` on the placing call (`submit_node_events`, `place_element`, `create_screen`/`create_screens`) and then wire every edge yourself. Keep the default (auto-connect on) for Steps 1/3/4 where same-column neighbors are exactly the intended wiring.

### Prefer batch MCP tools over one-call-per-item loops

Several MCP tools have a batch form that does the exact same thing as calling their singular form once per item, with the same validation rules and (where order matters, e.g. wiring a READMODEL→AUTOMATION edge before the backward EVENT→READMODEL edge that depends on it) the same in-order guarantee — just fewer round trips. Whenever a step's own instructions below show a single-item call and more than one item is being processed in the same pass, use the batch form instead:

- `set_connections` (not `set_connection` repeated) — wiring multiple edges
- `auto_connect_nodes` (not `auto_connect_node` repeated) — auto-connecting multiple freshly-placed nodes
- `create_slice_definitions` (not `create_slice_definition` repeated) — defining multiple slices
- `create_screens` (not `create_screen` repeated) — creating multiple HTML screens whose content is already authored
- `move_nodes` (not `move_node_in_timeline` repeated) — moving multiple already-placed nodes within one timeline
- `delete_nodes` / `delete_columns` (not `delete_node`/`delete_column` repeated) — removing multiple nodes or columns, e.g. a corrective cleanup after a modeling mistake
- `add_column`'s `count` param (not `add_column` repeated) — appending or inserting several columns at once; `beforeNodeId`/`afterNodeId` resolve the insertion point from an already-placed node instead of a computed index
- `create_chapter`'s `columns` param — when the chapter's initial column count is already known, instead of creating the default 3 and appending more after

Also prefer `get_nodes`' `chapterId` param over an unscoped board-wide fetch whenever the step is working within one timeline (the common case), and `get_node`'s `projection: "cells"` over a full chapter fetch whenever only `{rows, columns, cells}` is needed (most cell/column bookkeeping lookups).

For a "what is on the board and how is it wired right now" check between steps — the common orientation read, and the input to choosing an insertion anchor — use `get_board_outline` (`{boardId, chapterId}`). It returns one compact object: per-column node lists (`{id, type, title, lane}`) plus a flat edge list, with no rendered screen HTML or field bodies. Reserve full `get_nodes` (no projection) for when you actually need a node's `meta.fields` or page content.

**Structural validation is one call, not a scan.** `validate_model` (`{boardId, chapterId}`) runs the whole structural checklist server-side — unplaced nodes, backward arrows (todo-list exception applied), zero/multi-issuer commands, sourceless read models, two-screens-in-a-column, missing scenarios — and returns only `findings`. Use it for the mandatory post-step unplaced check and as the first move in Step 9, instead of per-type `get_nodes` loops and `get_node` `projection: "edges"` spot-checks.

**Ask echo-heavy write tools for less.** `add_scenario`, `add_storyline`, `set_connections` and `submit_node_events` each accept `compact: true`, which drops the full-object echo from the response (returning `{specNodeId, added, count, isNewNode}`, a `{connected, existed, removed, notFound, failed, errors}` tally, or `{persisted: <count>}` respectively). Pass it whenever you're not going to read individual fields back off the response — which is almost always for a large `set_connections` batch or a bulk scenario post.

### Documenting decisions inline, at any step

Separate from the Step 11 chapter-level reasoning note: at **any** step (1–10), if that step makes a decision or assumption important enough that a later reader could otherwise misread the model, add a small MARKDOWN note in the **column where that decision applies** (same feedback-lane + MARKDOWN mechanics as Step 11 — see there for the exact calls). Use sparingly — this is for a genuine "why is it like this" moment (an assumption that fills a gap the brief left open, a rejected alternative, a non-obvious constraint), not routine narration of what a step did.

---

## Interview Phase

**Skip if**: user has provided a clear domain description, requirements or
scope, and stated output goal (code, design, learning, docs).

**When interviewing**, use AskUserQuestion:

1. **Domain** — "What are you modeling? Describe the business process in 2-3
   sentences."
2. **Requirements state** — "(A) Written requirements/user stories, (B) Rough
   ideas, (C) Existing system to reverse-engineer?"
3. **Goal** — "(A) Learning event modeling, (B) Generate production code,
   (C) Design validation, (D) Team documentation?"
4. **Constraints** — "Any constraints? (timeline, external integrations, team
   size, target language/framework)"
5. **Starting point** — "Are you starting from scratch, or do you already have
   outputs from earlier steps (event list, commands, scenarios)?"

Confirm understanding before proceeding: "So we're modeling [domain], goal is
[goal], constraints are [constraints]. Starting from [step]. Does that match?"

**Capture findings** — create `.trogonai/interviews/[project-name]/EVENTMODELING.md` with this header (this step is what creates the file; every later step appends to it per `eventmodeling-interview-protocol`):

```markdown
# Event Modeling: [Project Name]

**Project**: [project-name]
**Started**: [ISO date]
**Goal**: [learning / production code / design validation / documentation]
**Constraints**: [timeline, integrations, team size, language]

## Interview Trail

| Step | Skill | Status | Key Output |
|------|-------|--------|------------|
```

Then follow **`eventmodeling-interview-protocol`** to record this step's own findings and add its Interview Trail row ("Orchestration" / `eventmodeling-orchestrating-event-modeling` / domain scoped, starting point confirmed). Every later step updates the same file as it completes.

---

## Phase Transition Protocol (Mandatory After Every Step)

After each step completes, before invoking the next skill, write a phase summary to memory.

Append a summary block to `.trogonai/interviews/[project-name]/EVENTMODELING.md`:

```markdown
### Step N complete — [Skill Name]
- **What was done**: [2-4 bullet points — key artifacts created, decisions made, gates passed]
- **Carry-forward**: [what the next step needs from this step]
- **Open questions**: [anything unresolved or deferred]
```

Also update the Interview Trail table row for this step (Status → Done, Key Output → one-line summary).

---

## Mid-Workflow Entry

If the user already has outputs from earlier steps, start from where they are.
Ask which steps are complete and what artifacts exist. Do not re-run completed
steps — pick up from the first incomplete step.

---

## Workflow

### Step 1: Brainstorm Events

Invoke `eventmodeling-brainstorming-events`.

**Input**: Domain requirements and any existing knowledge about the domain.
**Output to carry forward**: Event list + Role Catalog + dedicated timelines
(one chapter per workflow / bounded context) with events already placed in
their correct timeline. The Role Catalog (all human roles and system actors)
feeds into every subsequent step. Timeline discovery happens here — it does
not happen in Step 2.
**Gate**: Do not proceed until the Role Catalog exists, events cover all known
business processes, and every event is placed into a named chapter.

---

### Step 2: Plot Events

Invoke `eventmodeling-plotting-events`.

**Input**: Events already placed in their timelines from Step 1. This step
focuses on **one timeline at a time** — ask the user which timeline to
sequence first if multiple exist.
**Output to carry forward**: Chronological event ordering within the chosen
timeline showing causal dependencies between events.
**Gate**: The chosen timeline reads as a coherent narrative before proceeding.
Repeat for each additional timeline before moving to Step 3.

---

### Step 3: Storyboard

Invoke `eventmodeling-storyboarding-events`.

**Input**: Event timeline + Role Catalog.
**Output to carry forward**: UI mockups/wireframes with one swimlane per
human role, showing what data each screen displays and collects.
**Gate**: Every human role from the Role Catalog has at least one screen.

Use the `html-screen` skill to render a real HTML/CSS mockup for every screen — this is the default for each screen. Fall back to `storyboard-screen` (wireframe sketch) only when the user explicitly asked for sketches/wireframes.

You can reuse columns if screens can be matched to existing events, place the screen in the same
column as the event in the actor lane

---


### Step 4: Identify Inputs

Invoke `eventmodeling-identifying-inputs`.

**Input**: Storyboards + Role Catalog.
**Output to carry forward**: Command definitions, each attributed to a specific
role or system processor.
**Gate**: Every UI action in the storyboards maps to a named command.

---

### Step 4b: Design Automation Chains

Invoke `eventmodeling-designing-automation-chains`.

**Input**: Every AUTOMATION placed in Step 4, each already paired with its own
COMMAND in one column.
**Output to carry forward**: Every automation's todo-list READMODEL, placed
and wired; every externally-triggered automation resolved into a two-stage
translation chain (external EVENT → todo-list READMODEL → translation
AUTOMATION+COMMAND+internal EVENT → worker automation's own todo list).
**Gate**: No AUTOMATION on the board lacks an incoming `READMODEL →
AUTOMATION` connection, and no automation's todo list is opened directly by
another system's (second-swimlane) event. Skip this step only if Step 4
placed zero automations.

---

### Step 5: Identify Outputs

Invoke `eventmodeling-identifying-outputs`.

**Input**: Event list + Commands from Step 4 + automation chains already
resolved in Step 4b + the plain screens placed in Step 3.
**Output to carry forward**: Read model definitions — projections of events
optimized for UI queries — one per screen component, with any
multi-component screen already broken apart into same-named, highlighted
screen copies (this step's Step 5a/5c, not Step 3's job). Automation
todo-list read models are already complete from Step 4b and are not
re-derived here — this step only ever designs screen-facing read models.
**Gate**: Every screen data need from the storyboards is satisfied by a read
model, and no read model spans more than one component.

---

### Step 6: Apply Conway's Law

Invoke `eventmodeling-applying-conways-law`.

**Input**: Full event model so far (events, commands, read models).
**Output to carry forward**: System swimlanes mapping events and commands to
team boundaries.
**Gate**: Each boundary can be independently owned by a team. Skip this step
if Conway's Law boundaries are not relevant to the project.

---

### Step 7: Elaborate Scenarios

Invoke `eventmodeling-elaborating-scenarios`.

**Input**: Commands and read models.
**Output to carry forward**: Given-When-Then specifications (or storylines, for
walkthrough-style coverage) for every command **and every read model**, posted
to the board spec cells.
**Gate**: Every command has scenarios covering **all applicable types** from
the elaborating-scenarios workflow — not just happy path + one error case —
**and every READMODEL on the board has at least one view scenario**. See the
gate checklist below. A command-only pass is an incomplete Step 7, even if
every command's coverage looks exhaustive.

> **Do not reduce scenarios to a simple good-case / bad-case pair.** The `eventmodeling-elaborating-scenarios` skill defines a structured scenario workshop covering seven scenario types per command (Happy Path, Validation Failure, State Violation, Duplicate Action, Alternative Path, External Failure, Compensation — see that skill's own table for the question-form definition of each) — which apply is determined by the domain, not by a fixed rule. All applicable types must be written before this step is complete; do not decide based on brevity.

> **Read models need scenarios too — easy to forget since the seven types above are command-shaped.** Every READMODEL needs at least one view scenario (GWT or storyline); a read model with zero scenarios is as incomplete as a command with zero. `eventmodeling-elaborating-scenarios`'s own checklist covers the details — connectivity rules, GWT-vs-storyline judgment per read model, and avoiding redundancy between a storyline and its GWTs — don't re-derive those here, just enforce the gate.

> The `eventmodeling-elaborating-scenarios` skill designs scenarios **and** posts them to the board. It uses `GET /timelines/$TL/spec-info` to resolve node IDs, then `POST /timelines/$TL/columns/$COL/scenarios` with all scenarios for that column in one call (array body) — this applies identically whether the column holds a COMMAND or a READMODEL. The SCENARIO spec node is created automatically. Ensure the timeline and column IDs are resolved and passed to the skill before invoking it.

---

### Step 8: Check Completeness

Invoke `eventmodeling-checking-completeness`.

**Input**: Full model — events, commands, read models, scenarios, Role Catalog.
**Output to carry forward**: Field traceability matrix confirming every field
has an origin and a destination. List of any gaps found.
**Gate**: All gaps resolved or explicitly accepted before proceeding.

---

### Step 9: Validate

Invoke `eventmodeling-validating-event-models`.

**Input**: Complete event model.
**Output**: Validation report with PASS / PASS WITH WARNINGS / FAIL verdict.
**Gate**: PASS verdict before declaring the model ready for implementation.

If FAIL: address findings and re-invoke `eventmodeling-validating-event-models`.

**Optional — Structural Checklist**: Invoke
`eventmodeling-validating-event-models-checklist` for a second, mechanical
pass. It runs 12 structural checks across 6 phases and returns a
PASS / PASS WITH WARNINGS / FAIL verdict independently of Step 9. A PASS on
Step 9 does not substitute for this checklist.

---

### Step 10: Slice the Model

Invoke `eventmodeling-slicing-event-models`.

**Input**: Complete, validated event model (PASS from Step 9).
**Output to carry forward**: One slice definition per COMMAND (state-change),
per READMODEL (state-view), and per AUTOMATION on the board — the model's
independently deployable feature boundaries, ready for implementation.
**Gate**: Every COMMAND, READMODEL, and AUTOMATION on the timeline has a
matching slice definition; no duplicates were created for elements that
already had one.

---

### Step 11: Document Reasoning

Not delegated to a separate skill — performed directly by this orchestrating skill, since the reasoning being documented is the *orchestrator's own* accumulated context across all prior steps, not something a single-step skill has visibility into.

**Input**: The complete, sliced, validated model (Steps 1–10) plus this session's own record of decisions made along the way — assumptions added beyond the literal brief, sequencing corrections, business rules deliberately encoded as scenarios rather than events, read-model sharing choices, and any cross-context/integration gaps found (e.g. during Step 6 or Step 9).

**Output to carry forward**: One MARKDOWN node per chapter, placed in that chapter's first column, containing the full modeling reasoning for that bounded context in as much detail as the session actually has to give — not a boilerplate template filled in thinly.

**Gate**: Every chapter on the board has exactly one reasoning MARKDOWN node in its first column, non-empty, written after the model for that chapter was already complete (so it can describe the *finished* shape, not a plan).

**Mechanics** — a chapter has no `feedback` lane by default; add one first, then place a MARKDOWN node in it:

1. **Add a feedback lane** (once per chapter, skip if one already exists — check `meta.timelineData.rows` for `type === "feedback"` first):

   **Prefer MCP:**
   ```
   mcp__eventmodelers__add_lane { "boardId": "$BOARD_ID", "timelineId": "$CHAPTER_ID", "type": "feedback", "label": "Notes" }
   ```

   **Fallback (no MCP):** see `references/api-fallback.md` — "Step 11 — Document Reasoning — Add a feedback lane".

2. **Resolve the first column's ID** — the leftmost entry in `meta.timelineData.columns` (same chapter fetch used throughout this workflow for row/column lookups).

3. **Create the MARKDOWN node**, `cellId = "<feedbackLaneId>-<firstColumnId>"`:

   **Prefer MCP:**
   ```
   mcp__eventmodelers__submit_node_events {
     "boardId": "$BOARD_ID",
     "events": [{
       "id": "<event-uuid>", "eventType": "node:created", "nodeId": "<node-uuid>",
       "boardId": "$BOARD_ID", "timestamp": 1234567890,
       "chapterId": "$CHAPTER_ID", "cellId": "<feedbackLaneId>-<firstColumnId>",
       "meta": { "type": "MARKDOWN", "title": "Modeling Reasoning — <Chapter Name>", "description": "<full markdown body>" }
     }]
   }
   ```

   **Fallback (no MCP):** see `references/api-fallback.md` — "Step 11 — Document Reasoning — Create the MARKDOWN node".

   The note's body lives in **`meta.description`** as plain markdown source — headings, lists, bold, code fences, tables all render. **Not `meta.content`** — that field is accepted and stored without error but never rendered by the board UI, producing a visibly empty note; this was caught by comparing against a note authored directly in the UI, so treat it as confirmed, not a guess. There is no separate render/sketch call (unlike SCREEN/HTML_SCREEN) and no `fields[]` array on this element type.

**What the note should actually contain** — write for the next person (or next session) who opens this board cold, not for whoever just built it:
- **Scope**: what business process this chapter covers, and its entities (identity keys).
- **Assumptions added beyond the literal brief** — anything invented to fill a gap the requirements left open, and why (e.g. adding a resolution event so a state isn't a one-way trap door).
- **Business rules deliberately encoded as scenarios, not new events** — so a reader doesn't mistake a missing event for an oversight.
- **Sequencing or design corrections made mid-workflow** — e.g. a column reorder because an event's original placement implied the wrong causality.
- **Read model design rationale** — especially where one read model deliberately serves several screens/automations, so it doesn't read as a missing 1:1 mapping.
- **Any cross-context or integration gaps found** (Step 6 Conway's Law, or discovered incidentally, e.g. a same-timeline connection constraint blocking a needed cross-chapter data dependency) — state the finding and the viable resolutions, matching whatever TASK/QUESTION comment was also posted on the affected node.
- **Closing summary**: element counts and the validation verdict for this chapter's slice of the model.

If a chapter's story is genuinely simple, say so briefly rather than padding — but for any chapter with real design decisions behind it, this note is the place those decisions survive past the session that made them.

---

## Final Output

A complete, sliced event model consisting of:
- Role Catalog (human roles and system actors with permissions)
- Chronological event timeline
- UI storyboards with role-based swimlanes
- Command definitions with actor attribution
- Read model designs
- System boundaries (if Conway's Law applied)
- Given-When-Then scenarios
- Completeness verification
- Validation report with readiness verdict
- Slice definitions marking every independently deployable feature boundary
- A Modeling Reasoning MARKDOWN node in each chapter's first column, documenting the design decisions, assumptions, and any integration gaps behind that chapter's model

### Optional Follow-on Skills

These skills are not part of the 11-step main path but extend the model for
specific needs:

- **`eventmodeling-designing-event-models`** — Use when the Command/Event/Read-Model
  structure or event causality need detailed design work. Can be applied at
  any step where those decisions arise, most commonly during or after Step 1.
- **`eventmodeling-optimizing-stream-design`** — Use after the model is
  complete to validate that every entity's event timeline is anchored on a
  single business identity, not a disguised collection or event log.
- **`eventmodeling-translating-external-events`** — Use when external systems
  (webhooks, IoT, third-party APIs) need to feed into the domain model.

### Further Reading

- **[Project Planning with Event Modeling](references/project-planning-with-event-modeling.md)** — why explicit step contracts produce a flat cost curve and let teams build in parallel, plus velocity-based estimation and capacity planning built on workflow steps instead of story points.

---

## Quality Checklist

- [ ] No elements stranded at 0,0 — every EVENT, COMMAND, READMODEL, SCREEN, and AUTOMATION has a valid `cellId` in its chapter
- [ ] No `EVENT → READMODEL` connection points backward unless the read model already has a `READMODEL → AUTOMATION` edge (todo-list pattern) — every other later-event update uses a new read model + screen copy, never a link back to the earlier instance
- [ ] All 11 modeling steps completed (plus Step 4b whenever Step 4 placed any automations) — no step skipped without explicit reason
- [ ] Every AUTOMATION has a todo-list READMODEL, and no automation's todo list is opened directly by another system's event (Step 4b)
- [ ] Every COMMAND, READMODEL, and AUTOMATION has a matching slice definition on the board
- [ ] Every chapter has a Modeling Reasoning MARKDOWN node in its first column, written after that chapter's model was complete
- [ ] Role Catalog exists with named human roles and system processors
- [ ] Every command is attributed to a specific role from the Role Catalog
- [ ] Every read model satisfies at least one UI or processor query need
- [ ] At least one Given-When-Then scenario exists per command
- [ ] At least one view scenario (GWT or storyline) exists per READMODEL — not just per command
- [ ] Completeness check shows no unresolved field traceability gaps
- [ ] Validation returns PASS or PASS WITH WARNINGS with all critical issues resolved
- [ ] Interview trail in `.trogonai/` updated with status of each completed step
- [ ] Phase summary written to memory after every completed step before loading the next skill
