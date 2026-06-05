---
name: eventmodeling-validating-event-models
description: "Step 9 of Event Modeling - Validate event-sourced models for completeness, consistency, and event sourcing principles. Ensures events are immutable facts, state projections are deterministic, and commands are pure. Identifies gaps and suggests improvements before code generation. Use when reviewing models before code generation. Do not use for: the structured 23-check production checklist (use eventmodeling-validating-event-models-checklist) or field-level completeness verification (use eventmodeling-checking-completeness)."
allowed-tools:
  - Write
  - Bash
---

# Validating Event Models

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Core Architectural Rule (Non-Negotiable)

 **CRITICAL: Every command must have its own minimal state projection (NOT a DDD Aggregate)** What DDD calls an "aggregate root" is actually a READ MODEL. Command handlers must NEVER use read models for validation.

This is the primary validation gate. If a model violates this rule, it fails validation immediately.

```text
VIOLATION EXAMPLE (WILL FAIL VALIDATION):
OrderAggregate { orderId, customerId, items[], total, status, paymentId, address, shippedAt, cancelledAt, ... }
  ↑ This is a READ MODEL, not command state
Used by: ConfirmOrder, ShipOrder, CancelOrder, ApproveReturn
   REJECTED: This is DDD aggregate pattern (a read model), not event sourcing command state

CORRECT PATTERN (PASSES VALIDATION):
ConfirmOrderState { status, orderId }
ShipOrderState { status, orderId, paymentId }
CancelOrderState { status, orderId, createdAt }
ApproveReturnState { status, orderId, paymentId }
   APPROVED: Each command has minimal state

OrderSummaryView { orderId, customerId, items[], total, status, paymentId, ... }
   OK: This is a READ MODEL for UI queries, separate from command state
```

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

### 1. Event Stream Completeness Check

Verify each event stream has:
- Clear stream name (identity)
- At least one event type
- Initial event (what creates the stream)
- State transitions documented
- Deterministic state projection

**For each event:**
- Uses past tense (Created, Confirmed, etc.)
- Contains **only facts** (no computed fields)
- All data is **immutable**
- Unique semantics (no duplicates)
- Includes timestamp/causality info

**For each state projection:**
- Can be deterministically rebuilt from events
- Replay logic is pure (no side effects)
- Used only for command validation
- Can be safely discarded and regenerated

**For each command:**
- Clear input parameters
- Validation rules (against state)
- Resulting events specified (or rejection reason)
- Pure logic (no side effects except event appending)

### 2. Consistency Checks

- [ ] **Event-Stream Mapping**: Every event belongs to exactly one stream
- [ ] **Command Outcomes**: Every command produces events OR documents rejection
- [ ] **Deterministic Projections**: State can only be derived one way from events
- [ ] **No Side Effects in Projections**: Pure state reconstruction logic
- [ ] **Event Immutability**: No event data is ever modified
- [ ] **Naming Consistency**: Are naming patterns consistent?
  - Commands: Verb present (CreateOrder, ConfirmPayment)
  - Events: Verb past tense (OrderCreated, PaymentConfirmed)
  - Streams: Entity type + identity (Order:123, Payment:456)

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

- [ ] **Stream Identity Clear**: Stream name uniquely identifies entity
  - Order:order-123, Customer:cust-456
  - Orders collection with Order1, Order2

- [ ] **State is Derived**: Current state always comes from replaying events
  - "Load state: replay all events for Order:123"
  - "Load state: query database Orders table"

### 4. Event Flow Validation

- [ ] **Command → Event Mapping**: Clear what each command produces
- [ ] **No Zombie Commands**: Commands that never produce events (read-only OK)
- [ ] **Event Versioning**: How are old events handled if structure changes?
- [ ] **Compensation Events**: How are errors/reversals handled?
  - "PaymentFailed event appended when payment declined"
  - "Update payment event to status=failed"
- [ ] **Cross-Stream Communication**: Through events or external process?
  - "OrderConfirmed event triggers InventoryReservation command"
  - "Order directly modifies Inventory state"

### 5. Role & Actor Attribution Validation

Verify that every command has explicit actor attribution from the Role Catalog:

- [ ] **Role Catalog exists**: A Role Catalog was defined in Step 1 (eventmodeling-brainstorming-events)
  - CRITICAL: No Role Catalog found — commands have no actor attribution
  - PASS: Role Catalog with human roles and system actors defined

- [ ] **Every command has actor attribution**: No command uses generic "User"
  - CRITICAL: `CreateOrder` attributed to "User" (which user? Customer? Admin? Seller?)
  - PASS: `CreateOrder` attributed to "Customer" (specific role from catalog)

- [ ] **Every human role has at least one command path**: No orphaned roles
  - WARNING: "Support Agent" in Role Catalog but has zero commands
  - PASS: Every role has at least one command

- [ ] **Every human role has at least one read model**: Roles can see system state
  - WARNING: "Seller" has no read model — how do they see their data?
  - PASS: Every role has at least one view

- [ ] **Permission boundaries respected**: Commands are only issued by authorized roles
  - CRITICAL: `OverrideOrderStatus` not restricted to Support Agent role
  - PASS: Each command's role matches the permission boundary in the catalog

**Validation Verdict**:
If no Role Catalog exists → **REJECT MODEL — Role Catalog is a prerequisite**
If any command lacks actor attribution → **REJECT MODEL — all commands must have explicit role/actor**

### 6. Command State Read Models Validation (CRITICAL)

 **This is the PRIMARY validation gate. Violations are CRITICAL and must be fixed before approval.** Validate that **command state read models** are **minimal and command-specific**, not bundled like DDD aggregates.

**Note**: These are read models semantically categorized as "Command State" (optimized for command validation), as opposed to "Query Models" (optimized for UI queries).

**CRITICAL RULE CHECK**:

- [ ] **Naming Convention Compliance** - For automation tooling
  - CRITICAL: Interface named `OrderState` (ambiguous - command? query?)
  - PASS: `ConfirmOrderState` (clear: command state for ConfirmOrder)
  - PASS: `ShipOrderStateToDo` (clear: planned, needs implementation)
  - PASS: `OrderQueryModel` (clear: query read model)

- [ ] **NO shared state between commands** - This is the #1 rule
  - CRITICAL: "OrderState used by ConfirmOrder, ShipOrder, CancelOrder, ApproveReturn"
  - PASS: "ConfirmOrderState for ConfirmOrder, ShipOrderState for ShipOrder, etc."

- [ ] **Each command has its own state interface** - CRITICAL: Only one OrderState interface for all commands
  - PASS: ConfirmOrderState, ShipOrderState, CancelOrderState, ApproveReturnState

- [ ] **No Full Aggregate State**: Commands don't load all entity fields upfront
  - CRITICAL: "ConfirmOrder loads: { status, items[], total, shipping, paymentId, customer details, ... }"
  - PASS: "ConfirmOrder loads only: { status, orderId }"

- [ ] **State Only For Validation**: No unused fields in state
  - "ShipOrderState has exactly: { status, orderId, paymentId } — all needed"
  - CRITICAL: "ShipOrderState has: { status, orderId, paymentId, items[], total, address, ... } but only uses status and paymentId"

- [ ] **Per-Command State Shapes**: Different interfaces for different commands
  - ConfirmOrderState: { status, orderId }
  - ShipOrderState: { status, orderId, paymentId } (DIFFERENT)
  - CancelOrderState: { status, orderId, createdAt }
  - CRITICAL: All use the same OrderState

**Validation Verdict**:
If ANY command shares state with another command → **REJECT MODEL - CRITICAL VIOLATION**

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

- [ ] **Read Models Separate from Command State**: Read models are rich projections, NOT the command-validation state
- [ ] **Read Models Optional**: Are they needed or just convenience?
- [ ] **Serve Real Queries**: Each read model answers a specific question
  - "OrderSummaryView serves 'get orders by customer' query"
  - "OrderDetailsView duplicates all data from OrderState"
- [ ] **Consistent Update**: All relevant events update the read model
- [ ] **Regenerable**: Can be rebuilt from events at any time

### 9. Issues & Recommendations Report

Format findings as:

```markdown
# Event Model Validation Report: [Domain]

## Issues Found

### Critical (Must Fix)
1. **Stream Root**: Order
   **Issue**: No command for order cancellation
   **Impact**: Cannot model cancellation requirement
   **Fix**: Add CancelOrder command with OrderCancelled event

2. **Event**: PaymentProcessed
   **Issue**: Missing payment method in event data
   **Impact**: Cannot determine if card declined, etc.
   **Fix**: Add paymentMethod, authCode fields

3. **State Design**: Order stream
   **Issue**: ConfirmOrder loads full OrderState with items[], shipping, etc.
   **Impact**: Violates minimal state principle
   **Fix**: ConfirmOrder should load only: { status, orderId }

### Warnings (Should Consider)
1. **Stream Root**: Order
   **Issue**: Events contain computed total instead of raw amounts
   **Recommendation**: Store line item amounts in event, compute total in read models
   **Rationale**: Events are facts, computations belong in projections

2. **ReadModel**: CustomerDashboard
   **Issue**: Denormalizes data from 3 stream roots
   **Recommendation**: Ensure dashboard is truly for querying, not command validation
   **Rationale**: Read models support UI queries, not decision logic

## Completeness Analysis

| Aspect | Status | Details |
|--------|--------|---------|
| Stream Roots |  Complete | 5 stream roots identified |
| Commands |  80% | Missing: ReactivateAccount |
| Events |  Complete | 18 events cover all transitions |
| State Designs |  70% | Several have unnecessary fields for validation |
| Read Models |  Complete | 4 views cover query needs |

## Event Sourcing Compliance

- Immutable Events:  100%
- Minimal Command State:  75%
- Stream Root Clarity:  Clear identities
- Event Sourcing Pattern:  Follows ES principles
- CQRS Separation:  Command state vs Read models clear

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

## Validation Scoring

Provide a score for each dimension (0-100):
- **Completeness**: Do all requirements have corresponding model elements?
- **Consistency**: Are all patterns applied uniformly?
- **Correctness**: Do business rules match domain expert knowledge?
- **Clarity**: Are invariants and constraints explicit?
- **Projection/Command-State Compliance**: Does every command use its own minimal state projection, with no command handler reading from a query/read model for validation?

Overall: **Ready for Implementation** if all critical issues are resolved.

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
- [ ] No direct references between streams
- [ ] Projections serve specific query needs (or are removed)
- [ ] Everything can be rebuilt from the event stream
- [ ] Command state naming follows `[CommandName]State` convention
- [ ] No state is shared between different commands
- [ ] All command state is minimal (only fields needed for validation)
- [ ] **Role Catalog exists with human roles and system actors**
- [ ] **Every command attributed to a specific role/actor (no generic "User")**
- [ ] **Every human role has at least one command and one read model**
- [ ] **Permission boundaries from Role Catalog are respected**
