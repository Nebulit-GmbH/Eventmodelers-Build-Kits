---
name: eventmodeling-validating-event-models
description: "Step 9 of Event Modeling - Validate event-sourced models for completeness, consistency, and event sourcing principles. Ensures events are immutable facts, state projections are deterministic, and commands are pure. Identifies gaps and suggests improvements before code generation. Use when reviewing models before code generation. Do not use for: the structured 23-check production checklist (use eventmodeling-validating-event-models-checklist) or field-level completeness verification (use eventmodeling-checking-completeness)."
allowed-tools:
  - Write
  - Bash
---

# Validating Event Models

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

For validation you treat the Event Model as read only. The only thing you are allowed to change is comments.
For critical questions, add comments to elements.

For every field in the command, it must be clear where it is coming from.
Either it´s defined in a transitively connected Read Model, or it is marked as "generated" in either a screen or an automation.
There should not be any fields without a defined source.

The source can be also determined by looking at the defined Scenarios. Are all Scenarios covered?

## Board Context

Before starting, read the current board state to validate what is actually on the board:

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT"
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=COMMAND"
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=READMODEL"
```

After validation, use the `handle-comment` skill to post findings on the relevant nodes — `TASK` for critical violations that must be fixed, `QUESTION` for warnings and recommendations.

## Purpose
Ensures event-sourced models are complete, correct, and follow pure event sourcing principles (minimal per-command state).

## Workflow

When given an event model, perform comprehensive validation:

### 1. Swimlane Completeness Check

Verify each swimlane has:
- Clear name (identity)
- At least one event type
- Initial event (what creates the stream)
- State transitions documented

**For each event:**
- Uses past tense (Created, Confirmed, etc.)
- Contains **only facts** (no computed fields)
- All data is **immutable**
- Unique semantics (no duplicates)

**For each state projection:**
- Can be deterministically rebuilt from events
- Replay logic is pure (no side effects)

**For each command:**
- Clear input parameters
- Validation rules defined in scenarios (against state)
- Resulting events specified (or rejection reason)
- Pure logic (no side effects except event appending)

### 2. Consistency Checks

- [ ] **Event-Stream Mapping**: Every event belongs to exactly one lane
- [ ] **Command Outcomes**: Every command produces events OR documents rejection
- [ ] **Deterministic Projections**: State can only be derived one way from events
- [ ] **No Side Effects in Projections**: Pure state reconstruction logic
- [ ] **Event Immutability**: No event data is ever modified
- [ ] **Naming Consistency**: Are naming patterns consistent?
  - Commands: Verb present (CreateOrder, ConfirmPayment)
  - Events: Verb past tense (OrderCreated, PaymentConfirmed)

### 3. Event Sourcing Principles Compliance

Check against event sourcing fundamentals:

- [ ] **Events are Facts**: Events describe what happened, not potential futures
  - "OrderMayBeConfirmed" →  "OrderConfirmed"
  - "PaymentPending" (in events) →  "PaymentInitiated", "PaymentAuthorized"

- [ ] **Events are Immutable**: No modification of event data
  - "Update OrderCreated event with new total" →  "Append OrderTotalCorrected event"

- [ ] **Complete Event Data**: Events contain all facts needed for state rebuild
  - Event: "OrderConfirmed" (missing paymentId) →  Event includes paymentId

- [ ] **No Computed Fields in Events**: Only raw captured facts
  - OrderCreated includes "totalTax" (computed) →  Includes items + amounts, tax computed in projection

- [ ] **Deterministic Projections**: Replaying events always produces same state
  - Projection uses: for each event, do X
  - Projection uses: external API call during replay

- [ ] **State is Derived**: Current state always comes from replaying events
  - "Load state: replay all events for Order:123"
  - "Load state: query database Orders table"

### 4. Event Flow Validation

- [ ] **Command → Event Mapping**: Clear what each command produces
- [ ] **No Zombie Commands**: Commands that never produce events (read-only OK)

### 5. Role & Actor Attribution Validation

Verify that every command has explicit actor attribution from the Role Catalog:

- [ ] **Role Catalog exists**: A Role Catalog was defined in Step 1 (eventmodeling-brainstorming-events)
  - CRITICAL: No Role Catalog found — commands have no actor attribution
  - PASS: Role Catalog with human roles and system actors defined

- [ ] **Every command has actor attribution**: No command uses generic "User"
  - CRITICAL: `CreateOrder` attributed to "User" (which user? Customer? Admin? Seller?)
  - PASS: `CreateOrder` attributed to "Customer" (specific role from catalog)

### 6. Command State Read Models Validation (CRITICAL)

 **This is the PRIMARY validation gate. Violations are CRITICAL and must be fixed before approval.** Validate that **command state read models** are **minimal and command-specific**, not bundled like DDD aggregates.

### 7. Command & State Validation

- [ ] **State-Based Decisions**: Commands decide based on current state only
- [ ] **Valid State Transitions**: Document what state changes are allowed
```text
Draft → Confirmed (ConfirmOrder)
Draft → Cancelled (CancelOrder)
Confirmed → Shipped (ShipOrder)
Confirmed ↛ Draft (invalid)
```
- [ ] **Preconditions Clear**: When can each command execute?
  - "Can only confirm if state is Draft"
  - "Can sometimes confirm"
- [ ] **Error Handling**: What happens if validation fails?
  - "Reject with ValidationError, no events appended"
  - "Append ErrorEvent and continue"

### 8. Projection Validation

- [ ] **Read Models**: Read models are rich projections
- [ ] **Read Models Optional**: Are they needed or just convenience?
- [ ] **Regenerable**: Can be rebuilt from events at any time

### 9. Issues & Recommendations Report

Format findings as comments:

```markdown

## Validation Summary

**Overall Status**:  Ready with recommendations

**Blockers for Implementation**: 0 critical issues

**Recommended Fixes**:
1. Add missing OrderCancelled event
2. Move PaymentMethod to its own minimal state projection
3. Document all implicit invariants explicitly

**Ready for Code Generation**: Yes, after implementing recommendations

## Next Steps
1. Review recommendations with domain expert
2. Update model with critical fixes
3. Proceed to code generation
```

## Common Issues to Flag

| Issue | Pattern | Fix |
|-------|---------|-----|
| Missing cancellation flows | No "Cancelled" events | Add compensation paths |
| Implicit invariants | "Obviously can't do X" | Make invariants explicit |
| Command state too broad | Shared state used by 2+ commands | Split into per-command minimal state projections |
| Orphaned events | Events no one listens to | Link to projections or commands |
| No read models | Commands reading query/read models for validation | Add separate query read models; keep command state minimal |
| Circular dependencies | Projection A depends on B, B on A | Redesign stream boundaries |

## Key Principles for Event Sourcing

1. **Events are the source of truth**: Everything else is derived from them
2. **Immutable event log**: Events never change, only appended
3. **State is a projection**: Current state is built by replaying events
4. **Commands are pure decisions**: Validate against state, produce events or reject
5. **Projections are optional**: Can be rebuilt at any time
6. **Stream per entity**: Each entity has one append-only event stream

## Success Criteria

Your event model validation is successful when:

- All requirements are captured in events
- Commands clearly trigger events
- Stream roots have clear, minimal boundaries
- Business rules are explicit invariants (not hidden assumptions)
- Read models serve actual query needs (not used by commands)
- Command state is minimal and command-specific (not shared across multiple commands)
- Events are immutable facts (past tense, no computed fields)
- State can be deterministically rebuilt from events
- All command-to-event mappings are documented
- Critical issues are resolved or documented as known limitations

A model is **ready for code generation** if:
- No critical issues remain
- All command state follows naming convention (e.g., `[CommandName]State`)
- No state is shared between different commands
- All events are immutable facts
- All business rules are explicit
- A Role Catalog exists with all human roles and system actors
- Every command has explicit actor attribution from the Role Catalog

## Quality Checklist

- [ ] All events are immutable facts (past tense)
- [ ] No computed fields stored in events
- [ ] State projection is deterministic from events
- [ ] Commands validate against current state only
- [ ] Each command either produces events or rejects (no silent failures)
- [ ] Event causality/command-event mapping is clear
- [ ] State transitions are documented
- [ ] No direct references between lanes
- [ ] Projections serve specific query needs (or are removed)
- [ ] Everything can be rebuilt from the event stream
- [ ] No state is shared between different commands
- [ ] All command state is minimal (only fields needed for validation)
- [ ] **Role Catalog exists with human roles and system actors**
- [ ] **Every command attributed to a specific role/actor (no generic "User")**
- [ ] **Every human role has at least one command and one read model**
- [ ] **Permission boundaries from Role Catalog are respected**
