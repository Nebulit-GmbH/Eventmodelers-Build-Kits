---
name: eventmodeling-orchestrating-event-modeling
description: "Orchestrates complete event modeling workflow from requirements to code generation. Models architecture as UI/Processor → Command → Event → Read Model. Use when modeling a domain end-to-end from requirements. Do not use for: executing a single step in isolation (invoke the named step skill directly, e.g., eventmodeling-brainstorming-events for Step 1 or eventmodeling-elaborating-scenarios for Step 7), validating an already-completed model (use eventmodeling-validating-event-models), or modernizing legacy systems (use eventmodeling-integrating-legacy-systems)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Orchestrating Event Modeling

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

Coordinates the 11-step Event Modeling workflow. Each step delegates to a
specialized skill — this skill holds the sequence, transition conditions, and
what to carry forward between steps.

---

## Timeline Alignment Rules

These rules govern how every element is placed on the board. Enforce them throughout the workflow.

### State-change slice (SCREEN → COMMAND → EVENT)
- COMMAND and EVENT go in **the same column** — the command produces the event.
- SCREEN (input/command screen) goes in the **actor row of that same column**.
- **A COMMAND never stands alone.** Every COMMAND must have exactly one issuer in the actor row of its own column: a SCREEN when a human triggers it, an AUTOMATION when a processor or external-system integration triggers it. There is no third option and no exemption — a command with an empty actor-row cell is an unresolved gap the moment it's placed, not something to leave for a later step to notice. This applies just as much to a command that only *represents* an externally-triggered integration event crossing into this chapter (Step 1/Step 6 territory) as to any other command: place an AUTOMATION for the external actor even when that actor's own decision logic is out of scope for this model — the automation node documents *that* something triggers the command, not *how* it decides to.

  Every AUTOMATION placed this way still needs its own todo-list READMODEL per `eventmodeling-identifying-outputs` Step 5b — including one whose trigger is an external integration signal. There is no exemption for this either: even when the only visible trigger is the automation's own resulting event, model a todo list that opens and closes within that same slice (per Step 5b's worked pattern) rather than leaving the automation without an incoming READMODEL.

### State-view slice (EVENT → READ MODEL → SCREEN)
- READ MODEL goes in the **interaction row** of a column that is **immediately after the primary source event's column** — never at the end of the timeline.
- SCREEN (view/output screen) goes in the **actor row of the same column as the READ MODEL**.
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

### No unplaced elements (0,0 nodes)

After each step that creates elements (Steps 1–5), scan for any nodes that have no cell reference and are stranded at the default canvas position (0,0). These arise when `node:created` is called without `cellId`.

For each timeline in scope, check all node types that should be in cells.

**Prefer MCP:** call `get_nodes` once per type (each call returns the full node objects, including `meta.chapterId`/cell placement, so no separate cell-occupancy lookup is needed):
```
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "EVENT" }
```
Repeat with `"type": "COMMAND"`, `"READMODEL"`, `"SCREEN"`, `"AUTOMATION"`.

**Fallback (no MCP):**
```bash
for TYPE in EVENT COMMAND READMODEL SCREEN AUTOMATION; do
  curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
    "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=$TYPE"
done
```

For each returned node, check whether it has a valid cell assignment. A node without a `cellId` (or with `chapterId` missing) is unplaced.

**For each unplaced node:**
- **If it belongs in the current model** → compute the correct `cellId` and place it.

  **Prefer MCP:** the node already exists but has never been assigned a cell, so this is a placement, not a repositioning — use `drop_node_to_cell` (not `move_node_in_timeline`, which is for moving a node that already occupies a different cell):
  ```
  mcp__eventmodelers__drop_node_to_cell { "boardId": "$BOARD_ID", "timelineId": "<chapterId>", "cellId": "<rowId>-<colId>", "nodeId": "<nodeId>", "nodeType": "<TYPE>" }
  ```

  **Fallback (no MCP):**
  ```bash
  curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
    -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: orchestrator" \
    -H "Content-Type: application/json" \
    -d '[{"id":"<uuid>","eventType":"node:changed","nodeId":"<nodeId>","boardId":"<BOARD_ID>",
          "timestamp":1234567890,"chapterId":"<chapterId>","cellId":"<rowId>-<colId>",
          "meta":{"type":"<TYPE>","title":"<title>"}}]'
  ```
- **If it is an orphan (duplicate or no longer needed)** → delete it.

  **Prefer MCP:**
  ```
  mcp__eventmodelers__delete_node { "boardId": "$BOARD_ID", "nodeId": "<nodeId>" }
  ```

  **Fallback (no MCP):**
  ```bash
  curl -s -X DELETE "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/<nodeId>" \
    -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
  ```

Never leave an unplaced node on the board when proceeding to the next step.

### No backward arrows
The timeline must always progress left-to-right — this is the goal to design toward, not just a validation check to run afterward. Every connection arrow — SCREEN→COMMAND, COMMAND→EVENT, READMODEL→SCREEN, READMODEL→AUTOMATION, AUTOMATION→COMMAND — must point to the right or downward (within the same column). A right-to-left arrow among these is always a layout error, full stop.

**`EVENT → READMODEL` is the one exception — and it stays an exception, not a second acceptable default.** Confirmed against the platform API (`learn-eventmodelers-api` §3 — `POST .../connections`): an event in a later column may legitimately connect to a read model in an earlier column, and vice versa, because a read model is a continuously-listening projection, not a point-in-time action — it can be fed by an event anywhere on its timeline, including one placed after it. Always try to place a read model so its connections read forward first; reach for this exception only when a genuine roll-up's wide fan-in makes an all-forward layout impractical (see "God read models" above), not as a default way to avoid column planning. When you do rely on it, don't "fix" the wide-fan-in read model by relocating it to sit after its last source event just to eliminate the backward arrows — that column surgery is unnecessary and, for a genuine roll-up, often impossible to do cleanly without breaking other consumers. The one real signal to watch for is a **connected event that isn't actually used by any field** on the read model — that's a prunable connection regardless of column position, not a column-ordering problem.

Before wiring any of the five forward-only pairs, verify that `column(source) ≤ column(target)`. If this is violated:
- Move the earlier-placed element to the correct column, OR
- Insert a new column at the right position to restore the correct order.

Screens placed during Step 3 (Storyboarding) are provisional positions. Steps 4 and 5 may need to move them to align with the commands or read models placed later.

### Column insertion
Use `POST /timelines/:tl/columns` with `{"index": N}` to insert a column at a specific position (shifts existing columns right). Do not use `{}` (append) when placing read models or view screens — always target the correct position.

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

**Capture findings** — write to `.trogonai/interviews/[project-name]/EVENTMODELING.md`:

```markdown
# Event Modeling: [Project Name]

**Project**: [project-name]
**Started**: [ISO date]
**Goal**: [learning / production code / design validation / documentation]
**Constraints**: [timeline, integrations, team size, language]

## Interview Trail

| Step | Skill | Status | Key Output |
|------|-------|--------|------------|
| Orchestration | eventmodeling-orchestrating-event-modeling | Done | Domain scoped, starting point confirmed |
```

Update this file as each step completes.

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

### Step 5: Identify Outputs

Invoke `eventmodeling-identifying-outputs`.

**Input**: Event list + Commands from Step 4 + the plain screens placed in Step 3.
**Output to carry forward**: Read model definitions — projections of events
optimized for UI and processor queries — one per screen component, with any
multi-component screen already broken apart into same-named, highlighted
screen copies (this step's Step 5a/5c, not Step 3's job).
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

> **Do not reduce scenarios to a simple good-case / bad-case pair.** The `eventmodeling-elaborating-scenarios` skill defines a structured scenario workshop covering seven scenario types per command. All applicable types must be written before this step is complete.

**Scenario types to work through for each command** — which apply is determined by the domain, not by a fixed rule:
1. **Happy Path** — the normal success case
2. **Validation Failure** — invalid or missing input
3. **State Violation** — command issued when system is in an invalid state
4. **Duplicate Action** — command issued again after it already succeeded
5. **Alternative Path** — different valid outcomes depending on context
6. **External Failure** — external system or scheduler fails
7. **Compensation** — rollback or undo flow

For each type, ask the relevant question against the business case and write a scenario if the situation can occur. Do not decide based on brevity — decide based on the domain.

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

**Optional — Production Readiness Checklist**: Invoke
`eventmodeling-validating-event-models-checklist` when the model is destined
for production. It runs 23 architectural checks across 7 phases and returns a
PASS / PASS WITH WARNINGS / FAIL verdict independently of Step 9. A PASS on
Step 9 does not substitute for this checklist when production readiness is
required.

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

   **Fallback (no MCP):**
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$CHAPTER_ID/lanes" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: orchestrator" \
     -H "Content-Type: application/json" \
     -d '{"type":"feedback","label":"Notes"}'
   # → { laneId, type, label, index, totalLanes }
   ```

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

   **Fallback (no MCP):**
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: orchestrator" \
     -H "Content-Type: application/json" \
     -d '[{"id":"<event-uuid>","eventType":"node:created","nodeId":"<node-uuid>","boardId":"<BOARD_ID>",
           "timestamp":1234567890,"chapterId":"<CHAPTER_ID>","cellId":"<feedbackLaneId>-<firstColumnId>",
           "meta":{"type":"MARKDOWN","title":"Modeling Reasoning — <Chapter Name>","description":"<full markdown body>"}}]'
   ```

   The note's body lives in **`meta.description`** as plain markdown source — headings, lists, bold, code fences, tables all render. **Not `meta.content`** — that field is accepted and stored without error but never rendered by the board UI, producing a visibly empty note; this was caught by comparing against a note authored directly in the UI, so treat it as confirmed, not a guess. There is no separate render/sketch call (unlike SCREEN/HTML_SCREEN) and no `fields[]` array on this element type.

**What the note should actually contain** — write for the next person (or next session) who opens this board cold, not for whoever just built it:
- **Scope**: what business process this chapter covers, and its stream roots (identity keys).
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

- **`eventmodeling-designing-event-models`** — Use when stream identity,
  per-command state shapes, or event causality need detailed design work. Can
  be applied at any step where those decisions arise, most commonly during or
  after Step 1.
- **`eventmodeling-optimizing-stream-design`** — Use after the model is
  complete to validate stream growth estimates and snapshotting decisions.
- **`eventmodeling-translating-external-events`** — Use when external systems
  (webhooks, IoT, third-party APIs) need to feed into the domain model.

---

## Quality Checklist

- [ ] No elements stranded at 0,0 — every EVENT, COMMAND, READMODEL, SCREEN, and AUTOMATION has a valid `cellId` in its chapter
- [ ] All 11 modeling steps completed — no step skipped without explicit reason
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
