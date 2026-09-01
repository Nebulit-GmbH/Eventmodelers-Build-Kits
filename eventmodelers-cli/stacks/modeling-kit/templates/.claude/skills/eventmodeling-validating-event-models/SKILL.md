---
name: eventmodeling-validating-event-models
description: "Step 9 of Event Modeling - Validate the model for completeness and consistency. Ensures events are immutable facts, read models are deterministic projections, and commands are traceable decisions. Identifies gaps before the model is declared done. Use when reviewing a model before it's considered final. Do not use for: the structured 12-check checklist (use eventmodeling-validating-event-models-checklist) or field-level completeness verification (use eventmodeling-checking-completeness)."
allowed-tools:
  - Write
  - Bash
---

# Validating Event Models

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

For validation you treat the Event Model as read only. The only thing you are allowed to change is comments.
For critical questions, add comments to elements.

For every field in the command, it must be clear where it is coming from.
Either it´s defined in a transitively connected Read Model, or it is marked as "generated" in either a screen or an automation.
There should not be any fields without a defined source.

The source can be also determined by looking at the defined Scenarios. Are all Scenarios covered?

## Board Context

Before starting, read the current board state to validate what is actually on the board.

Prefer MCP — call `mcp__eventmodelers__get_nodes` once per type (no header wiring needed, auth resolves from the connected session):

```
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "EVENT" }
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "COMMAND" }
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "READMODEL" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Board Context".

After validation, use the `handle-comment` skill to post findings on the relevant nodes — `TASK` for critical violations that must be fixed, `QUESTION` for warnings and recommendations. (That skill already handles the `add_comment` MCP-vs-curl choice internally — no separate rewrite needed here.)

## Purpose

Ensures the event model is complete, correct, and internally consistent.

## Workflow

When given an event model, perform comprehensive validation:

### 0. Automated structural pass — run `validate_model` first

Before the manual checks below, run the server-side checklist once per chapter:

```
mcp__eventmodelers__validate_model { "boardId": "$BOARD_ID", "chapterId": "<chapterId>" }
```

It returns a compact `findings` list (no node dumps) covering: unplaced nodes, backward arrows among the forward-only pairs (with the todo-list `EVENT → READMODEL` exception already applied), COMMANDs with zero or multiple issuers, READMODELs with no inbound EVENT, columns with more than one screen, and COMMAND/READMODEL columns with no SCENARIO. This replaces the per-type `get_nodes` scans and the `get_node` `projection: "edges"` spot-checks those manual checks would otherwise need — start from its `findings`, then use the sections below for the semantic checks it can't make (naming, immutability, field-source traceability, scenario coverage depth). A `verdict` of `PASS` on `validate_model` is necessary but not sufficient — still do the semantic pass.

### 1. Entity/Timeline Completeness Check

Verify each entity's timeline has:
- Clear name (identity)
- At least one event type
- An initial event (what starts the entity's story)
- State transitions documented

**For each event:**
- Uses past tense (Created, Confirmed, etc.)
- Contains **only facts** (no computed fields)
- All data is **immutable**
- Unique semantics (no duplicates)

**For each read model:**
- Can be deterministically derived from events
- No side effects in how it's built

**For each command:**
- Clear input parameters
- Preconditions defined in scenarios
- Resulting events specified (or rejection reason)

### 2. Consistency Checks

- [ ] **Event-Entity Mapping**: Every event belongs to exactly one lane/entity
- [ ] **Single Command Issuer**: Every command is issued by exactly one SCREEN or AUTOMATION — never two. Check each COMMAND node's inbound edges; more than one SCREEN/AUTOMATION wired into the same command is a CRITICAL violation (commonly an auto-connect artifact — see `place-element` Step 7c)
- [ ] **Command Outcomes**: Every command produces events OR documents a rejection
- [ ] **Deterministic Read Models**: A read model can only be derived one way from its events
- [ ] **Event Immutability**: No event data is ever modified
- [ ] **Naming Consistency**: Are naming patterns consistent?
  - Commands: present-tense verb (CreateOrder, ConfirmPayment)
  - Events: past-tense verb (OrderCreated, PaymentConfirmed)

### 3. Event Modeling Principles Compliance

- [ ] **Events are Facts**: describe what happened, not potential futures
  - "OrderMayBeConfirmed" →  "OrderConfirmed"
  - "PaymentPending" (as an event) →  "PaymentInitiated", "PaymentAuthorized"

- [ ] **Events are Immutable**: no modification of event data
  - "Update OrderCreated event with new total" →  "Append OrderTotalCorrected event"

- [ ] **Complete Event Data**: events contain all facts a read model needs to project them
  - Event "OrderConfirmed" missing paymentId →  Event includes paymentId

- [ ] **No Computed Fields in Events**: only raw captured facts
  - OrderCreated includes "totalTax" (computed) →  Includes items + amounts; tax computed in the read model

- [ ] **Deterministic Read Models**: replaying the same events always produces the same read model

### 4. Event Flow Validation

- [ ] **Command → Event Mapping**: clear what each command produces
- [ ] **No Zombie Commands**: commands that never produce events (read-only commands are fine if documented as such)

### 5. Role & Actor Attribution Validation

Verify that every command has explicit actor attribution from the Role Catalog:

- [ ] **Role Catalog exists**: a Role Catalog was defined in Step 1 (eventmodeling-brainstorming-events)
  - CRITICAL: no Role Catalog found — commands have no actor attribution
  - PASS: Role Catalog with human roles and system actors defined

- [ ] **Every command has actor attribution**: no command uses generic "User"
  - CRITICAL: `CreateOrder` attributed to "User" (which user? Customer? Admin? Seller?)
  - PASS: `CreateOrder` attributed to "Customer" (specific role from catalog)

### 6. Command Validation

- [ ] **Preconditions Clear**: when can each command execute?
  - "Can only confirm if state is Draft"
  - "Can sometimes confirm"
- [ ] **Rejection Handling**: what happens if a precondition fails?
  - "Reject, no events appended"
  - "Append a rejection/failure event and continue" (if that's the modeled outcome)
- [ ] **Valid State Transitions**: document what state changes are allowed
```text
Draft → Confirmed (ConfirmOrder)
Draft → Cancelled (CancelOrder)
Confirmed → Shipped (ShipOrder)
Confirmed ↛ Draft (invalid)
```

### 7. Read Model Validation

- [ ] **Read Models**: are rich projections shaped for their query
- [ ] **Read Models Optional**: are they needed, or just convenience?
- [ ] **Regenerable**: could be rebuilt from events at any time

### 8. Issues & Recommendations Report

Format findings as comments:

```markdown
## Validation Summary

**Overall Status**:  Ready with recommendations

**Blockers**: 0 critical issues

**Recommended Fixes**:
1. Add missing OrderCancelled event
2. Document all implicit preconditions explicitly

## Next Steps
1. Review recommendations with domain expert
2. Update model with critical fixes
```

## Common Issues to Flag

| Issue | Pattern | Fix |
|-------|---------|-----|
| Missing cancellation flows | No "Cancelled" events | Add the missing outcome slices |
| Implicit preconditions | "Obviously can't do X" | Make preconditions explicit |
| Orphaned events | Events no one reads | Link to a read model or command |
| No read models | Commands validated against raw event replay with no documented read model | Add a read model documenting what the command actually reads |
| Command issued by multiple things | COMMAND node has 2+ inbound SCREEN/AUTOMATION edges | Keep the deliberate same-column issuer, remove the rest via `set_connection` (`action: "remove"`) — see `place-element` Step 7c |

## Key Principles

See `eventmodeling-core-rules` for the element definitions this validation checks against (events as immutable facts, read models as optional projections, commands as decisions against documented preconditions).

## Success Criteria

Your event model validation is successful when:

- All requirements are captured in events
- Commands clearly trigger events
- Business rules are explicit preconditions (not hidden assumptions)
- Read models serve actual query needs
- Events are immutable facts (past tense, no computed fields)
- All command-to-event mappings are documented
- Critical issues are resolved or documented as known limitations
- A Role Catalog exists with all human roles and system actors, and every command has explicit actor attribution

## Quality Checklist

- [ ] All events are immutable facts (past tense)
- [ ] No computed fields stored in events
- [ ] Read models are derived deterministically from events
- [ ] Commands are checked against documented preconditions
- [ ] Each command either produces events or rejects (no silent failures)
- [ ] **No command has more than one inbound SCREEN/AUTOMATION edge (a command is never issued by more than one thing)**
- [ ] Event causality/command-event mapping is clear
- [ ] State transitions are documented
- [ ] Read models serve specific query needs (or are removed)
- [ ] **Role Catalog exists with human roles and system actors**
- [ ] **Every command attributed to a specific role/actor (no generic "User")**
- [ ] **Every human role has at least one command and one read model**
- [ ] **Permission boundaries from Role Catalog are respected**
