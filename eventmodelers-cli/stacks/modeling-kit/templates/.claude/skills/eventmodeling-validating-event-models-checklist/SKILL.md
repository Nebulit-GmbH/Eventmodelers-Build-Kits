---
name: eventmodeling-validating-event-models-checklist
description: "Validate event-sourced CQRS models against 17 architectural checks across 7 phases. Identifies anti-patterns and confirms compliance with event sourcing principles. Use when reviewing event models for production readiness or after completing event modeling steps. Do not use for: reviewing incomplete or in-progress models (use eventmodeling-validating-event-models), or for elaborating new scenarios (use eventmodeling-elaborating-scenarios)."
allowed-tools:
  - Write
  - Bash
---

# Event Model Validation Checklist Skill

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

**Purpose**: Validate any event-sourced CQRS event model against 17 architectural checks across 7 phases. Identifies anti-patterns and confirms compliance with event sourcing principles.

**Applies To**: Any domain - e-commerce, banking, SaaS, marketplace, healthcare, etc.

**When to Use**:
- After completing Step 2 (Event Plot) of the 11-step event modeling workflow, as an early structural check
- Alongside Step 9 (Validate), as the optional production-readiness pass before declaring model complete
- When reviewing an existing event model for production readiness
- When suspicious of architectural issues in event design

**What It Does**:
1. Reads current board state (EVENT, COMMAND, READMODEL nodes) as input
2. Systematically applies 17 validation checks across 7 phases
2. Identifies violations of event sourcing principles (domain-agnostic)
3. Flags anti-patterns (calculations as events, non-entity streams, etc.)
4. Verifies read model/event distinction
5. Confirms stream independence and business rule enforcement
6. Returns pass/fail verdict with evidence

---

## Board Context

Read the current board state before running the checklist:

**Prefer MCP:** call `get_nodes` once per type, or pull the fuller graph in one shot with `get_slice_data` if you need events/commands/readmodels/screens/specs/actors together:

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "EVENT" }
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "COMMAND" }
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "READMODEL" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Board Context".

Use the board nodes as the model input. After the checklist, use `handle-comment` to post `TASK` comments on nodes that fail checks (that skill covers the MCP `add_comment`/curl choice for comment-posting itself).

## Validation Phases (Domain-Agnostic)

### Phase 1: Event Stream & Command Handler State Validation (4 checks)
- Check 1.1: Each event belongs to exactly one stream
- Check 1.2: Each command handler owns its own [CommandHandler]State class
- Check 1.3: No hard dependencies between command handlers (orchestrated via events only)
- Check 1.4: Each command is issued by exactly one thing — no COMMAND node has more than one inbound SCREEN/AUTOMATION edge

**Anti-pattern to catch**: Sharing state across handlers or treating state as persistent aggregate; a command wired from two issuers — auto-connect itself now guards against this (see `learn-eventmodelers-api` §3), so a double-issuer command found on the board is most likely a manual `set_connection` call or an edge left over from before that guard existed, not a fresh auto-connect artifact

### Phase 2: Event Quality Validation (3 checks)
- Check 2.1: Events represent domain facts, not calculations
- Check 2.2: Event data is immutable after creation
- Check 2.3: Event names use past tense (what actually happened)

**Anti-pattern to catch**: Storing computed/aggregated data as events

### Phase 3: Read Model vs Event Distinction (2 checks)
- Check 3.1: Each read model is NOT an event stream
- Check 3.2: Read model has natural query pattern

**Anti-pattern to catch**: Confusing projections/calculations with domain facts

### Phase 4: Business Rules Validation (2 checks)
- Check 4.1: Constraints enforced in command handler decision logic (encapsulated in [CommandHandler]State)
- Check 4.2: Event preconditions are explicit (what state must exist before command is valid)

**Anti-pattern to catch**: Business rules scattered across handlers or encoded in event stream structure

### Phase 5: Data Traceability (1 check)
- Check 5.1: Input → Event → Read Model traceability is complete

**Anti-pattern to catch**: Command inputs that disappear or read model fields without source

### Phase 6: Event Flow Validation (1 check)
- Check 6.1: No impossible event sequences (state machine is sound)

**Anti-pattern to catch**: Events that can occur in invalid state combinations

### Phase 7: Stream Independence (1 check)
- Check 7.1: Each stream can be versioned/restored independently

**Anti-pattern to catch**: Hard dependencies between streams

### Final Questions (3 checks)
- Question 1: Could an architect unfamiliar with this domain understand the model in 15 minutes?
- Question 2: Could you change your core algorithm/calculation without changing event history?
- Question 3: Could this be implemented in your target technology stack (e.g., TypeScript + PostgreSQL)?

---

## Output Format

The skill returns a validation report with:

### For Each Check
```
 Check 1.2: Stream Root is Business Entity, Not Calculation
Status: PASS
Evidence: [Specific examples from your model]
```

### Anti-Patterns Identified (if any)
```
CRITICAL: [Anti-pattern description]
Problem: [Why it violates event sourcing]
Violates: [Which checks fail]
Fix: [Recommended action]
```

### Final Verdict
```
Status:  PASS (or  PASS WITH WARNINGS or  FAIL)
Implementation Ready: YES (or NO - fix issues first)
Confidence: [percentage]
```

---

## Common Anti-Patterns (Domain-Agnostic)

### 1. Calculation Events
```
 ANTI-PATTERN:
CalculationPerformed {
  metric: 4.5  ← Mutable/recalculated
  timestamp: T
}

 CORRECT:
- Event: SomeActionOccurred (immutable fact)
- ReadModel: MetricView (recalculated from events)
```

**Why**: Calculations change multiple times as source data changes. Events are immutable.

### 2. Shared vs Handler-Owned State

The DDD-aggregate anti-pattern — one shared state class used by every handler — versus the correct pattern of one minimal, handler-owned state class per command. See `eventmodeling-designing-event-models`'s "Core Architectural Rule" for the full worked example (`OrderAggregate` vs. per-command state).

**Why**: Each handler is a micro-slice. Separate state classes maintain isolation, enable parallel teams, prevent merge conflicts.

### 3. Circular Dependencies
```
 ANTI-PATTERN:
StreamA → EventA → affects
StreamB → EventB → affects
StreamA (circular!)

 CORRECT:
StreamA → EventA → Event Bus
StreamB → EventB → Event Bus
ReadModels ← consume (one-way only)
No feedback loops
```

**Why**: Circular dependencies make the system hard to reason about and test.

### 4. Persistent State vs Ephemeral State
```
 ANTI-PATTERN:
Treat [CommandHandler]State as persistent entity
- Save SubmitReviewState to database after command
- Load it again next time
- Result: Duplicates event sourcing, loses audit trail

 CORRECT:
Reconstruct [CommandHandler]State on-demand
- Load events from stream
- Replay via evolve() to rebuild state
- Process command, emit outcome events
- Discard state (it's ephemeral, not persisted)
```

**Why**: State is derived from events, never stored. Events are source of truth. This enables consistent replay, audit trails, and time-travel debugging.

### 5. Command With Multiple Issuers

A command is never issued by more than one thing — a COMMAND with 2+ inbound SCREEN/AUTOMATION edges hides which actor is actually responsible. See `place-element`'s Step 7c for the full check-and-fix mechanics (which edge to keep, how to remove the rest).

**Why**: Each command represents one specific trigger's decision to act — collapsing two triggers onto one command node usually means either a naming/slice-boundary mistake or a stray manual/pre-existing edge (auto-connect itself now guards against fresh occurrences — see `learn-eventmodelers-api` §3).

---

## Questions to Ask During Validation

**For each event stream**:
1. "Do all events in this stream share the same identity (streamId)?"
2. "Could these events occur in any order, or is sequence important?"
3. "Is every event in this stream an immutable fact that actually happened?"

**For each command handler**:
1. "Does this handler own its own [CommandHandler]State class?"
2. "Is the state ephemeral (reconstructed per command, not persisted)?"
3. "Can I trace the state reconstruction: events → evolve() → decision?"

**For each read model**:
1. "Is this calculated from events via a projection?"
2. "Does it answer a specific query need?"
3. "Could its data change due to new events or state changes?"

**For system architecture**:
1. "Does each command handler operate independently (communicate via events only)?"
2. "Could I run two handlers' code in parallel without merge conflicts?"
3. "Are the only shared artifacts the event definitions?"

---

## Success Criteria

 **Model is validated when**:
- All 17 checks pass (or have documented workarounds)
- No critical anti-patterns identified
- All 3 final questions answer YES
- Event sourcing principles clearly upheld
- Ready to proceed to code generation

 **Model needs fixes when**:
- Any check fails with clear evidence
- Anti-patterns identified with specific violations
- Final questions have NO answers
- Fixes are straightforward and targeted

 **Model should be redesigned when**:
- Multiple phases fail
- Architectural assumptions are fundamentally flawed
- Anti-patterns are systemic and pervasive
- Would require rewriting core event structure

---

## Example Validation Patterns

### Pattern: Calculation vs Event
When you see something like "CalculationDone" or "ReviewRatingUpdated":
- Ask: "Is this immutable and caused by a user/system action?"
- If NO → It's a read model, not an event
- Fix: Remove from events, create read model projection instead

### Pattern: Shared vs Isolated State
When you see "ReviewAggregate" used by multiple handlers:
- Ask: "Could SubmitReviewHandler and ApproveReviewHandler work on separate files?"
- If NO → State classes aren't properly isolated
- Fix: Create SubmitReviewState and ApproveReviewState, each handler owns one

### Pattern: Persistent vs Ephemeral State
When state is saved to database after a command:
- Ask: "Is this state only needed during command processing?"
- If YES → It's ephemeral, reconstruct from events instead
- Fix: Load events, replay via evolve(), process command, discard state

### Pattern: Data That Doesn't Trace
When a read model field appears without source:
- Ask: "Where did this come from?"
- If no event source → Add event or remove field
- If sourced from calculation → Verify it's in projection, not event

---

## Integration with Event Modeling Process

**Recommended timing**:
```
Step 1: Brainstorm Events
Step 2: The Plot (Sequence)
  ↓
→ RUN eventmodeling-validating-event-models-checklist (catch structural issues early)
  ↓
Fix any violations
  ↓
Step 3-8: Storyboard, Inputs, Outputs, Conway's Law, Scenarios, Completeness
  ↓
Step 9: Validate (eventmodeling-validating-event-models)
  ↓
→ RUN eventmodeling-validating-event-models-checklist again (production-readiness pass)
  ↓
PASS → Step 10: Slice, Step 11: Document Reasoning → Code generation
FAIL → Fix identified issues
```

Running the checklist after Step 2 prevents wasting time on later steps if core events are flawed.

---

## Checklist Questions by Domain

The skill applies the same 17 checks regardless of domain. Here's how to think about it in different contexts:

**E-commerce domain**:
- Events: OrderCreated, OrderConfirmed, PaymentAuthorized, OrderShipped
- NOT events: OrderTotal, InventoryLevel, ShippingCost (these are read models)

**Banking domain**:
- Events: AccountOpened, DepositReceived, WithdrawalProcessed, FundsTransferred
- NOT events: AccountBalance, InterestCalculated (these are read models)

**SaaS domain**:
- Events: SubscriptionCreated, PaymentProcessed, PlanUpgraded, SubscriptionCancelled
- NOT events: MonthlyRecurringRevenue, ChurnRate (these are read models)

**Healthcare domain**:
- Events: PatientRegistered, AppointmentScheduled, ProcedureCompleted, BillGenerated
- NOT events: PatientAge, AverageCost (these are read models)

The principle is the same across all domains: **immutable facts as events, calculated results as read models**.

---

## Tips for Best Results

1. **Be specific**: List actual event names, command handler names, and state classes from your model
2. **Reference your documentation**: Link to or quote from your step 1-7 documents and micro-slice plans
3. **Provide context**: Explain what your domain is and how handlers will be parallelized
4. **Ask follow-ups**: If a check flags an issue, ask "How do I fix this specifically?" or "Can this handler be isolated?"
5. **Iterate**: Run again after making fixes to confirm all checks pass and handlers are properly isolated

## Quality Checklist

- [ ] All 17 checks evaluated — no check skipped without documented justification
- [ ] Every FAIL result includes the specific event, handler, or stream that violated the check
- [ ] Anti-patterns identified by name with the exact model element that triggered the flag
- [ ] Final verdict is one of: PASS / PASS WITH WARNINGS / FAIL — no ambiguous outcomes
- [ ] All 3 final architectural questions answered YES before declaring model ready for implementation
- [ ] Any FAIL result has a recommended fix, not just a problem statement

---

## Related Skills

- **eventmodeling-orchestrating-event-modeling**: Main skill coordinating the 11-step event modeling process
- **eventmodeling-brainstorming-events**: Extract events from requirements (Step 1)
- **eventmodeling-plotting-events**: Sequence events chronologically (Step 2)
- **eventmodeling-designing-event-models**: Design your complete event model
- **eventmodeling-validating-event-models**: Detailed validator with deep analysis

---

## Validation Checklist Reference

The 17-point checklist is defined in the **Validation Phases** section above.
Each check includes the anti-pattern to catch and questions to ask when evaluating your model.

