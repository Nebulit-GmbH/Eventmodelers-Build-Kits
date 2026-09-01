---
name: eventmodeling-checking-completeness
description: "Step 8 of Event Modeling - Completeness Check. Verify every field has origin and destination. Ensure complete event model before code generation. Use after all scenarios defined. Do not use for: architectural validation against event sourcing principles (use eventmodeling-validating-event-models) or elaborating Given-When-Then specs (use eventmodeling-elaborating-scenarios)."
allowed-tools:
  - Write
  - Bash
---

# Checking Completeness

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

## Board Context

Before starting, read the current board state to drive the analysis from what is actually on the board rather than relying solely on conversation context:

**Prefer MCP:**
```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "EVENT" }
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "COMMAND" }
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "READMODEL" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Board Context".

Use these results as the source of truth for the completeness check.

**Before treating any nodes as duplicates**: check each node's `data.linkedTo` field (see `learn-eventmodelers-api`). A node with `linkedTo` set is an intentional **linked copy** of another node — placed elsewhere on the timeline for readability, not a modeling defect. When two or more nodes share a title/type:
- If any of them carries `linkedTo`, do not report a duplicate. This is expected, not a gap.
- Never propose deleting, suppressing, or "cleaning up" either node in a linked pair. Specifically, never target the node that has *no* `linkedTo` (the original) for removal — copies reference it via `moveToWidget=<originNodeId>`, so deleting it breaks every copy.
- Only flag same-titled nodes as an actual duplicate gap when **none** of them has `linkedTo` — i.e., they are genuinely two independent, unlinked nodes describing the same concept.

After the analysis, use the `handle-comment` skill to post findings on relevant nodes — `TASK` for required fixes, `QUESTION` for gaps that need clarification.

## Workflow

Perform comprehensive completeness check:

### 1. Field Origin & Destination Matrix
For every field in every event, verify its origin (a command, a calculation, or the system) and every destination that consumes it (other events, read models, external systems), marking each field's status as complete or a gap. A full worked example (Order domain) is in `references/examples.md`.

### 2. Check All Commands
Verify every command input is captured somewhere in the resulting event, whether directly or implicitly. A full worked example is in `references/examples.md`.

### 3. Check All Read Models
Verify every field a read model displays is sourced from a connected event. A full worked example is in `references/examples.md`.

### 4. Check Slice Coverage

Every column that holds a COMMAND or READMODEL node must have a slice defined (a SLICE_BORDER node on that column) — otherwise it can never be built as a feature. Skip columns whose COMMAND/READMODEL node has `data.linkedTo` set: it's a linked copy (see Board Context above), and only the original's column needs a slice.

**Prefer MCP** — `list_slices` is lighter than filtering all nodes, and also returns each slice's status:
```
mcp__eventmodelers__list_slices { "boardId": "<BOARD_ID>" }
```
Or, to get the full SLICE_BORDER nodes (with `columnId`) the same way as the curl fallback:
```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "SLICE_BORDER" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "4. Check Slice Coverage".

Cross-reference each COMMAND/READMODEL node's column against the `columnId` of the SLICE_BORDER nodes, flagging any column with no matching slice as a gap (skipping linked copies, which are exempt). A full worked example is in `references/examples.md`.

### 5. Check Event Stream Completeness
Verify no "missing" events:

Walk the full timeline scenario end-to-end (creation through terminal state) checking for missing events, and separately verify that alternative/branch paths (cancellations, failures, compensations) are also represented. A full worked example is in `references/examples.md`.

### 6. Check System Boundaries
Verify each system owns events:

For each system/bounded context, verify it owns a coherent, non-overlapping set of events, and that any processor it runs only reacts to events it's entitled to. A full worked example is in `references/examples.md`.

### 7. Define Workflow Step Contracts
Each workflow step is a contract between the previous step and the next. Document preconditions and postconditions:

Treat each workflow step as a contract: document its preconditions (what must already be true, usually the previous step's postcondition) and its postconditions (what event now exists and which fields it carries), so a later step — or a different team — can build against the contract without waiting on the implementation. A full worked example (a three-step Order contract chain) is in `references/examples.md`.

**Why contracts matter for parallel development**: a team can start building the next step immediately against the previous step's postcondition (mocking the event it depends on), instead of waiting for that step's implementation to finish. See `eventmodeling-orchestrating-event-modeling`'s linked `project-planning-with-event-modeling.md` reference for the fully worked example and the resulting flat cost curve.

### 8. Check Field Traceability
Matrix of all fields origin → destination:

Build a matrix of every field crossing Event / Command / Read Model / Processor, confirming each field's presence is accounted for across the whole model. A full worked example is in `references/examples.md`.

### 9. Identify Gaps
Document any missing pieces:

For each candidate gap, check whether the data already exists elsewhere in the model before treating it as missing, and record which gaps were fixed versus which remain outstanding. A full worked example is in `references/examples.md`.

## Output Format

Older versions of this skill wrote the completeness check as a markdown report rather than posting comments on board nodes — that legacy template is kept in `references/examples.md` for reference only; the actual output mechanism is the `handle-comment`-based comment posting described in "Board Context" above.

## Quality Checklist

- [ ] Every field has clear origin
- [ ] Every field has identified destinations
- [ ] All command inputs are captured
- [ ] All read models have sources
- [ ] **Every column with a COMMAND or READMODEL node has a slice defined (unless it's a linked copy)**
- [ ] Event flow is complete
- [ ] No events are missing
- [ ] System boundaries are clear
- [ ] Alternative paths covered
- [ ] Error paths documented
- [ ] Processors are identified
- [ ] No circular dependencies
- [ ] All scenarios have data sources
- [ ] **Workflow step contracts defined for each step**
- [ ] **Each contract has explicit preconditions**
- [ ] **Each contract has explicit postconditions**
- [ ] **Dependencies between steps documented**
- [ ] **Teams can work in parallel based on contracts**

### CRITICAL: Event vs Read Model Validation
- [ ] **Reviewed every "calculated event"**: Is it a domain fact or pure calculation?
- [ ] **No aggregation events**: Totals, averages, counts are read models, NOT events
- [ ] **Recalculated state identified**: If a value changes multiple times, it's a read model
- [ ] **Processor outputs categorized**:
  - [ ] Facts → Events (e.g., PaymentAuthorized)
  - [ ] Calculations → Read Models (e.g., SellerRatingCalculated)
  - [ ] Notifications → No event/model (info-only)
- [ ] **History tracking correct**: Read models track history in `history[]`, not as separate events

## Completeness Criteria

The model is **complete** when:
 Every event field has a source (command or system or is marked as  generated)
 Every command input becomes event/state data
 Every read model field has event source
 All state transitions are covered
 Alternative flows are documented
 Error conditions are handled
 System boundaries are clear
 No "magic" data appears without source
 Data flows logically end-to-end
 All stakeholder needs are met
 **Events are facts (immutable domain actions)** **Read models are projections (derived/calculated state)** **No calculated events exist** (aggregations/totals are read models)
 **Every COMMAND/READMODEL column has a slice defined**, except linked copies

## Common Incompleteness Issues

| Issue | Example | Fix |
|-------|---------|-----|
| Missing event | "No event for failure" | Add failure event |
| Orphaned data | "Field in view, not in event" | Add field to event |
| Circular flow | "A needs B, B needs A" | Redesign boundary |
| Missing field | "View needs date, event has none" | Add field to event |
| Unclear origin | "Where does this come from?" | Trace back to source |
| **Calculated event** | SellerRatingCalculated, InventoryTotal | **Move to read model** (recalculated state is projection) |
| **False duplicate** | Two nodes share a title | Check `data.linkedTo` on both before reporting — a linked copy is intentional, not a gap |
| **Missing slice** | COMMAND/READMODEL column with no SLICE_BORDER | Define a slice for that column (unless it's a linked copy) |

## Next Steps

If completeness check passes:
→ Proceed to Step 9 (`eventmodeling-validating-event-models`) — completeness is not the
  final gate; validation, slicing, and documentation (Steps 9–11) still follow before
  the model is ready for code generation.

If gaps found:
→ Return to appropriate step to fix
→ Re-run completeness check
