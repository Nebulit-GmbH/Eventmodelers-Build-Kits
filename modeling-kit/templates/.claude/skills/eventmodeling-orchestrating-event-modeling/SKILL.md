---
name: eventmodeling-orchestrating-event-modeling
description: "Orchestrates complete event modeling workflow from requirements to code generation. Models architecture as UI/Processor → Command → Event → Read Model. Use when modeling a domain end-to-end from requirements. Do not use for: executing a single step in isolation (invoke the named step skill directly, e.g., eventmodeling-brainstorming-events for Step 1 or eventmodeling-elaborating-scenarios for Step 7), validating an already-completed model (use eventmodeling-validating-event-models), or modernizing legacy systems (use eventmodeling-integrating-legacy-systems)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Orchestrating Event Modeling

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

Coordinates the 9-step Event Modeling workflow. Each step delegates to a
specialized skill — this skill holds the sequence, transition conditions, and
what to carry forward between steps.

---

## Timeline Alignment Rules

These rules govern how every element is placed on the board. Enforce them throughout the workflow.

### State-change slice (SCREEN → COMMAND → EVENT)
- COMMAND and EVENT go in **the same column** — the command produces the event.
- SCREEN (input/command screen) goes in the **actor row of that same column**.

### State-view slice (EVENT → READ MODEL → SCREEN)
- READ MODEL goes in the **interaction row** of a column that is **immediately after the primary source event's column** — never at the end of the timeline.
- SCREEN (view/output screen) goes in the **actor row of the same column as the READ MODEL**.
- If the primary source event's column already has a COMMAND in the interaction row, insert a **new column immediately after** (using `index = currentColumnIndex + 1`) and place the READ MODEL there.

### Never stack read models at the end
Placing all read models in new columns at the very end of the timeline severs the visual connection to the events they're derived from. The board must show a coherent left-to-right narrative where each slice is self-contained.

### No unplaced elements (0,0 nodes)

After each step that creates elements (Steps 1–5), scan for any nodes that have no cell reference and are stranded at the default canvas position (0,0). These arise when `node:created` is called without `cellId`.

For each timeline in scope, check all node types that should be in cells:
```bash
for TYPE in EVENT COMMAND READMODEL SCREEN AUTOMATION; do
  curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
    "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=$TYPE"
done
```

For each returned node, check whether it has a valid cell assignment. A node without a `cellId` (or with `chapterId` missing) is unplaced.

**For each unplaced node:**
- **If it belongs in the current model** → compute the correct `cellId` and call `node:changed` to assign it:
  ```bash
  curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
    -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: orchestrator" \
    -H "Content-Type: application/json" \
    -d '[{"id":"<uuid>","eventType":"node:changed","nodeId":"<nodeId>","boardId":"<BOARD_ID>",
          "timestamp":1234567890,"chapterId":"<chapterId>","cellId":"<rowId>-<colId>",
          "meta":{"type":"<TYPE>","title":"<title>"}}]'
  ```
- **If it is an orphan (duplicate or no longer needed)** → delete it:
  ```bash
  curl -s -X DELETE "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/<nodeId>" \
    -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
  ```

Never leave an unplaced node on the board when proceeding to the next step.

### No backward arrows
The timeline must always progress left-to-right. Every connection arrow — SCREEN→COMMAND, COMMAND→EVENT, EVENT→READMODEL, READMODEL→SCREEN — must point to the right or downward (within the same column). A right-to-left arrow is always a layout error.

Before wiring any connection, verify that `column(source) ≤ column(target)`. If this is violated:
- Move the earlier-placed element to the correct column, OR
- Insert a new column at the right position to restore the correct order.

Screens placed during Step 3 (Storyboarding) are provisional positions. Steps 4 and 5 may need to move them to align with the commands or read models placed later.

### Column insertion
Use `POST /timelines/:tl/columns` with `{"index": N}` to insert a column at a specific position (shifts existing columns right). Do not use `{}` (append) when placing read models or view screens — always target the correct position.

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

After each step completes, before invoking the next skill:

### 1. Write a phase summary to memory

Append a summary block to `.trogonai/interviews/[project-name]/EVENTMODELING.md`:

```markdown
### Step N complete — [Skill Name]
- **What was done**: [2-4 bullet points — key artifacts created, decisions made, gates passed]
- **Carry-forward**: [what the next step needs from this step]
- **Open questions**: [anything unresolved or deferred]
```

Also update the Interview Trail table row for this step (Status → Done, Key Output → one-line summary).

### 2. Compact the context

After writing the summary, run `/compact` to clear the accumulated context before loading the next skill. The summary written above is the handoff — the next skill reads it from the file, not from the conversation history.

This keeps each step's context lean and prevents token bloat from accumulating across all 9 steps.

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

Use the Story-Board-Screen skill to sketch and provide Mockups. 

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

**Input**: Event list + Commands from Step 4.
**Output to carry forward**: Read model definitions — projections of events
optimized for UI and processor queries.
**Gate**: Every screen data need from the storyboards is satisfied by a read
model.

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
**Output to carry forward**: Given-When-Then specifications for each command
and view, posted to the board spec cells.
**Gate**: Every command has scenarios covering **all applicable types** from the elaborating-scenarios workflow — not just happy path + one error case. See the gate checklist below.

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

> The `eventmodeling-elaborating-scenarios` skill designs scenarios **and** posts them to the board. It uses `GET /timelines/$TL/spec-info` to resolve node IDs, then `POST /timelines/$TL/columns/$COL/scenarios` with all scenarios for that column in one call (array body). The SCENARIO spec node is created automatically. Ensure the timeline and column IDs are resolved and passed to the skill before invoking it.

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

## Final Output

A complete event model consisting of:
- Role Catalog (human roles and system actors with permissions)
- Chronological event timeline
- UI storyboards with role-based swimlanes
- Command definitions with actor attribution
- Read model designs
- System boundaries (if Conway's Law applied)
- Given-When-Then scenarios
- Completeness verification
- Validation report with readiness verdict

### Optional Follow-on Skills

These skills are not part of the 9-step main path but extend the model for
specific needs:

- **`eventmodeling-designing-event-models`** — Use when stream identity,
  per-command state shapes, or event causality need detailed design work. Can
  be applied at any step where those decisions arise, most commonly during or
  after Step 1.
- **`eventmodeling-optimizing-stream-design`** — Use after the model is
  complete to validate stream growth estimates and snapshotting decisions.
- **`eventmodeling-translating-external-events`** — Use when external systems
  (webhooks, IoT, third-party APIs) need to feed into the domain model.
- **`eventmodeling-slicing-event-models`** — Use after Step 9 PASS to break
  the model into independently deployable feature slices and plan parallel
  team implementation.

---

## Quality Checklist

- [ ] No elements stranded at 0,0 — every EVENT, COMMAND, READMODEL, SCREEN, and AUTOMATION has a valid `cellId` in its chapter
- [ ] All 9 modeling steps completed — no step skipped without explicit reason
- [ ] Role Catalog exists with named human roles and system processors
- [ ] Every command is attributed to a specific role from the Role Catalog
- [ ] Every read model satisfies at least one UI or processor query need
- [ ] At least one Given-When-Then scenario exists per command
- [ ] Completeness check shows no unresolved field traceability gaps
- [ ] Validation returns PASS or PASS WITH WARNINGS with all critical issues resolved
- [ ] Interview trail in `.trogonai/` updated with status of each completed step
- [ ] Phase summary written to memory and `/compact` run after every completed step before loading the next skill
