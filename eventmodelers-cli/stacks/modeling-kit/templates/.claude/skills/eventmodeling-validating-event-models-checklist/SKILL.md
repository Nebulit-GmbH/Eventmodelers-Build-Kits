---
name: eventmodeling-validating-event-models-checklist
description: "Validate an event model against 12 structural checks across 6 phases. Identifies notation anti-patterns and confirms the model is internally consistent. Use when reviewing an event model for readiness or after completing event modeling steps. Do not use for: reviewing incomplete or in-progress models (use eventmodeling-validating-event-models), or for elaborating new scenarios (use eventmodeling-elaborating-scenarios)."
allowed-tools:
  - Write
  - Bash
---

# Event Model Validation Checklist Skill

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

**Purpose**: Validate any event model against 12 structural checks across 6 phases. Identifies notation anti-patterns and confirms the model is internally consistent.

**Applies To**: Any domain - e-commerce, banking, SaaS, marketplace, healthcare, etc.

**When to Use**:
- After completing Step 2 (Event Plot) of the event modeling workflow, as an early structural check
- Alongside Step 9 (Validate), as an optional second pass before declaring the model complete
- When reviewing an existing event model
- When suspicious of structural issues in the model

**What It Does**:
1. Reads current board state (EVENT, COMMAND, READMODEL nodes) as input
2. Systematically applies 12 validation checks across 6 phases
3. Identifies notation anti-patterns (calculations modeled as events, events mixed into the wrong entity's timeline, etc.)
4. Verifies read model/event distinction
5. Confirms every event and command traces cleanly
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

Also run `validate_model` (`{boardId, chapterId}`) once per chapter up front — several checklist items (Command With Multiple Issuers in Phase 1, backward-arrow / event-flow in Phase 6, read-model-source distinctions in Phase 3) have a purely structural half the tool answers directly, so start each of those from its `findings` and spend the manual effort on the semantic judgement the tool can't make.

Use the board nodes as the model input. After the checklist, use `handle-comment` to post `TASK` comments on nodes that fail checks (that skill covers the MCP `add_comment`/curl choice for comment-posting itself).

## Validation Phases (Domain-Agnostic)

### Phase 1: Event & Command Ownership Validation (2 checks)
- Check 1.1: Each event belongs to exactly one entity/timeline
- Check 1.2: Each command is issued by exactly one thing — no COMMAND node has more than one inbound SCREEN/AUTOMATION edge

**Anti-pattern to catch**: a command wired from two issuers — auto-connect itself now guards against this (see `learn-eventmodelers-api` §3), so a double-issuer command found on the board is most likely a manual `set_connection` call or an edge left over from before that guard existed, not a fresh auto-connect artifact

### Phase 2: Event Quality Validation (3 checks)
- Check 2.1: Events represent domain facts, not calculations
- Check 2.2: Event data is immutable after creation
- Check 2.3: Event names use past tense (what actually happened)

**Anti-pattern to catch**: storing computed/aggregated data as an event

### Phase 3: Read Model vs Event Distinction (2 checks)
- Check 3.1: Each read model is NOT an event timeline
- Check 3.2: Read model has a natural query pattern

**Anti-pattern to catch**: confusing projections/calculations with domain facts

### Phase 4: Business Rules Validation (2 checks)
- Check 4.1: Every command's preconditions are documented explicitly
- Check 4.2: Event preconditions are explicit (what must already be true before a command is valid)

**Anti-pattern to catch**: business rules scattered across the model or left implicit ("obviously can't ship an unconfirmed order")

### Phase 5: Data Traceability (1 check)
- Check 5.1: Input → Event → Read Model traceability is complete

**Anti-pattern to catch**: command inputs that disappear, or read model fields without a source

### Phase 6: Event Flow Validation (2 checks)
- Check 6.1: No impossible event sequences (the slice-transition flow is sound)
- Check 6.2: No event belongs to more than one entity's timeline — an event that seems to span two entities usually means a naming or boundary mistake, not a shared fact

**Anti-pattern to catch**: events that can occur in invalid combinations; a "shared" event quietly coupling two entities together

### Final Questions (2 checks)
- Question 1: Could a modeler unfamiliar with this domain understand the model in 15 minutes?
- Question 2: Could the business rule/calculation behind a read model change without rewriting event history?

---

## Output Format

The skill returns a validation report with:

### For Each Check
```
 Check 1.2: Command Issued by Exactly One Thing
Status: PASS
Evidence: [Specific examples from your model]
```

### Anti-Patterns Identified (if any)
```
CRITICAL: [Anti-pattern description]
Problem: [Why it violates event modeling principles]
Violates: [Which checks fail]
Fix: [Recommended action]
```

### Final Verdict
```
Status:  PASS (or  PASS WITH WARNINGS or  FAIL)
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

**Why**: Calculations change as source data changes. Events are immutable.

### 2. Command With Multiple Issuers

A command is never issued by more than one thing — a COMMAND with 2+ inbound SCREEN/AUTOMATION edges hides which actor is actually responsible. See `place-element`'s Step 7c for the full check-and-fix mechanics (which edge to keep, how to remove the rest).

**Why**: Each command represents one specific trigger's decision to act — collapsing two triggers onto one command node usually means either a naming/slice-boundary mistake or a stray manual/pre-existing edge (auto-connect itself now guards against fresh occurrences — see `learn-eventmodelers-api` §3).

### 3. An Event Shared Across Entities
```
 ANTI-PATTERN:
EntityA → EventA → also placed on EntityB's timeline

 CORRECT:
EntityA → EventA (on EntityA's timeline only)
EntityB reacts to EventA via a read model/automation, it doesn't own it
```

**Why**: An event belongs to the story of exactly one entity. If a second entity needs to react to it, that's a read model or automation reading it — not the same event living on two timelines.

---

## Questions to Ask During Validation

**For each entity's timeline**:
1. "Do all events on this timeline belong to the same entity?"
2. "Could these events occur in any order, or does sequence matter?"
3. "Is every event on this timeline an immutable fact that actually happened?"

**For each command**:
1. "Are its preconditions written down, not just assumed?"
2. "Does it produce an event, or document why it's rejected?"

**For each read model**:
1. "Is this calculated from events via a projection?"
2. "Does it answer a specific query need?"
3. "Could its data change due to new events?"

---

## Success Criteria

 **Model is validated when**:
- All 12 checks pass (or have documented workarounds)
- No critical anti-patterns identified
- Both final questions answer YES
- Event modeling principles are clearly upheld

 **Model needs fixes when**:
- Any check fails with clear evidence
- Anti-patterns identified with specific violations
- A final question has a NO answer
- Fixes are straightforward and targeted

 **Model should be redesigned when**:
- Multiple phases fail
- Structural assumptions are fundamentally flawed
- Anti-patterns are systemic and pervasive
- Would require rewriting the core event timeline

---

## Example Validation Patterns

### Pattern: Calculation vs Event
When you see something like "CalculationDone" or "ReviewRatingUpdated":
- Ask: "Is this immutable and caused by a user/system action?"
- If NO → It's a read model, not an event
- Fix: Remove from events, create a read model projection instead

### Pattern: Data That Doesn't Trace
When a read model field appears without source:
- Ask: "Where did this come from?"
- If no event source → Add the event or remove the field
- If sourced from a calculation → Verify it's in the read model, not the event

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
→ RUN eventmodeling-validating-event-models-checklist again (final structural pass)
  ↓
PASS → Step 10: Slice, Step 11: Document Reasoning
FAIL → Fix identified issues
```

Running the checklist after Step 2 prevents wasting time on later steps if the core events are flawed.

---

## Checklist Questions by Domain

The skill applies the same 12 checks regardless of domain. Here's how to think about it in different contexts:

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

1. **Be specific**: List actual event and command names from your model
2. **Reference your documentation**: Link to or quote from your step 1-7 documents
3. **Provide context**: Explain what your domain is
4. **Ask follow-ups**: If a check flags an issue, ask "How do I fix this specifically?"
5. **Iterate**: Run again after making fixes to confirm all checks pass

## Quality Checklist

- [ ] All 12 checks evaluated — no check skipped without documented justification
- [ ] Every FAIL result includes the specific event, command, or entity that violated the check
- [ ] Anti-patterns identified by name with the exact model element that triggered the flag
- [ ] Final verdict is one of: PASS / PASS WITH WARNINGS / FAIL — no ambiguous outcomes
- [ ] Both final questions answered YES before declaring the model ready
- [ ] Any FAIL result has a recommended fix, not just a problem statement

---

## Related Skills

- **eventmodeling-orchestrating-event-modeling**: Main skill coordinating the full event modeling process
- **eventmodeling-brainstorming-events**: Extract events from requirements (Step 1)
- **eventmodeling-plotting-events**: Sequence events chronologically (Step 2)
- **eventmodeling-designing-event-models**: Design your complete event model
- **eventmodeling-validating-event-models**: Detailed validator with deep analysis

---

## Validation Checklist Reference

The 12-point checklist is defined in the **Validation Phases** section above.
Each check includes the anti-pattern to catch and questions to ask when evaluating your model.
