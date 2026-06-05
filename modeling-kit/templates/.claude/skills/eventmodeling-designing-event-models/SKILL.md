---
name: eventmodeling-designing-event-models
description: "Designs event-sourced domain models. Maps business processes to immutable events and state projections. Events are the source of truth; state is derived from events for command validation. Use when designing event streaming architectures from domain analysis. Do not use for: brainstorming events from scratch (use eventmodeling-brainstorming-events), optimizing stream sizing or snapshotting (use eventmodeling-optimizing-stream-design), or translating external system events (use eventmodeling-translating-external-events)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Designing Event Models

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has specified: stream identity strategy, command-specific state needs, and read model requirements. Interview when stream boundaries or state design are unclear.

**Interview Strategy**: Establish stream identity and per-command state boundaries before designing. Ambiguous boundaries are the primary cause of the DDD aggregate anti-pattern appearing in event-sourced models.

### Critical Questions

1. **Stream Identity** (Impact: Determines how events are grouped into streams)
   - Question: "What's the entity that owns events? (e.g., orderId, reviewId, customerId) What's the lifetime? Single transaction or years?"
   - Why it matters: Wrong stream identity causes design problems; correct identity keeps streams appropriately scoped
   - Follow-up triggers: If multiple candidates → ask "Which entity's identity would you use to load events for a single command decision?"

2. **Minimal State vs Bundled State** (Impact: Prevents DDD aggregate anti-pattern)
   - Question: "Will different commands need different state? Or does every command need the same full state?"
   - Why it matters: Each command should have minimal, command-specific state—not bundled DDD aggregates
   - Follow-up triggers: If "same full state" → walk through two commands and ask what each actually reads during validation

### Interview Flow

**Conditional Entry**:
```text
If user has provided:
  - Stream identity (which entity ID anchors the stream)
  - AND at least two commands with explicitly different state needs documented
  - AND read model requirements (what queries the UI or processors make)

Then: Skip interview, proceed directly to design

Else: Conduct interview
```

**Phase 1: Stream Boundaries** (Question 1)
- Confirm which entity anchors the stream
- Establish stream lifetime expectations
- Identify whether multiple candidate roots exist and resolve them

**Phase 2: State Design** (Question 2)
- Confirm per-command state isolation
- Identify whether DDD aggregate thinking is present upfront
- Establish minimal state shapes for at least two commands

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## Designing Event Models (eventmodeling-designing-event-models)

### Stream Identity
[From Q1: Which entity? What identity key? Lifetime?]

### Per-Command State Decisions
[From Q2: Which commands need different state? Initial minimal state shapes?]

### Design Decisions
- Stream root: [entity name] identified by [id field]
- State isolation: [confirmed / DDD pattern caught and corrected]
```

Update Interview Trail:
```markdown
| Design | eventmodeling-designing-event-models | Done | Stream identity, per-command state shapes |
```

---

## Core Architectural Rule

 **NEVER use a "DDD Aggregate Root" (bundled state) for command validation** Every command handler has its own minimal state projection. What DDD calls an "aggregate root" is actually a **read model**, not command-validation state.

```text
 WRONG: Using DDD Aggregate as command state
OrderAggregate { orderId, customerId, items[], total, status, paymentId, address, shippedAt, cancelledAt, ... }
    ↑ This is a READ MODEL, not command state
    ↓ NEVER use for command validation
  handleConfirmOrder(OrderAggregate)
  handleShipOrder(OrderAggregate)
  handleCancelOrder(OrderAggregate)

 CORRECT: Minimal state per command
ConfirmOrderState { status, orderId }
    ↓
  handleConfirmOrder(ConfirmOrderState)

ShipOrderState { status, orderId, paymentId }
    ↓
  handleShipOrder(ShipOrderState)

CancelOrderState { status, orderId, createdAt }
    ↓
  handleCancelOrder(CancelOrderState)

OrderSummaryView { orderId, customerId, items[], total, status, paymentId, ... }
    ↑ This is for UI queries, NOT command validation
```

## Purpose
Converts domain analysis into the event sourcing architecture pattern:

**UI/Processor** → **Command** → [Command State Read Model] → **Event** → **Query Read Models** - **UI/Processor**: Entry points that trigger intent
- **Command**: Intent data (can be rejected)
- **Stream Root**: Logical grouping of immutable events (NOT a DDD aggregate bundle)
- **Command State Read Model**: Minimal projection derived from events, optimized for this specific command's validation. Each command gets its own read model interface. Different commands = different shapes. (Categorized as "Command State" for semantic clarity)
- **Event**: Result of successful command (immutable fact: command data + implicit context)
- **Query Read Models**: Rich projections of events optimized for UI/Processor queries. Separate from command state. (Categorized as "Query Models" for semantic clarity)

## Workflow

Given a domain analysis, design a complete event-sourced model:

### 1. Design Event Streams
Events are the immutable source of truth. Each stream holds facts about one entity:
- **Stream Name**: Entity type + identity (Order:order-123)
- **Event Type**: What changed? (past tense: Created, Confirmed, Shipped)
- **Event Data**: Combines command input + implicit stream state facts
- **Causality**: Triggered by which command?

Format:
```text
Stream: Order:order-123

Events (chronological):
1. OrderCreated
   Triggered by: CreateOrder command
   Data: customerId, items[], total, shippingAddress, createdAt
   (from command: customerId, items[], shippingAddress)
   (implicit: total calculated from items)

2. OrderConfirmed
   Triggered by: ConfirmOrder command
   Data: paymentId, confirmedAt
   (from command: paymentId)
   (implicit: orderId from stream, previous status verified)

3. OrderShipped
   Triggered by: ShipOrder command
   Data: shipmentId, shippedAt
   (from command: shipmentId)
   (implicit: orderId, confirmed status verified)
```

**Key Rules**:
- Events are **immutable facts** from successful commands
- Event data = command input + implicit stream state context
- Stream identity is explicit (Order:order-123)
- Event order matters for state reconstruction
- Never modify or delete events
- Events only exist if command succeeded

### 2. Design Command State Read Models (Minimal Per-Command)

 **Critical Rule: Each command must have its own read model (command state). NEVER share read models between commands.** **Naming Convention (for Automation)**:
- `[CommandName]State` = Implemented command state read model
- `[CommandName]StateToDo` = Planned command state read model (marked for implementation)

Examples:
- `PublishReviewState` = implemented
- `EditReviewStateToDo` = planned, needs implementation
- `SellerRespondState` = implemented

**Semantic Categorization**: These are read models, but categorized as "Command State" based on their purpose (command validation, not UI queries).

Command state read models are **derived** from events and **minimal**:
- Read only events needed for a specific command's decision
- Build state by replaying only relevant events
- **ENFORCEMENT**: Different commands = different read model interfaces. Period.
- Each command handler defines what state projection it needs (and ONLY what it needs)
- Projection can be regenerated from events at any time

Example for Order stream with separate command state read model for EACH command:

```text
## ConfirmOrder Command (IMPLEMENTED)
State interface: ConfirmOrderState { status, orderId }
Builder: buildConfirmOrderState(events)
Naming: [CommandName]State = implemented
- OrderCreated event → Set status='Draft'
- OrderConfirmed event → Set status='Confirmed'
(SKIP: items, total, shipping - not needed for this command)

## ShipOrder Command (IMPLEMENTED)
State interface: ShipOrderState { status, orderId, paymentId }
Builder: buildShipOrderState(events)
Naming: [CommandName]State = implemented
(DIFFERENT from ConfirmOrderState)
- OrderCreated event → (skip)
- OrderConfirmed event → Set status='Confirmed', set paymentId
- OrderShipped event → Set status='Shipped'

## CancelOrder Command (PLANNED - NOT IMPLEMENTED)
State interface: CancelOrderStateToDo { status, orderId, createdAt }
Builder: buildCancelOrderStateToDo(events) [STUB - TODO]
Naming: [CommandName]StateToDo = planned, needs implementation
(DIFFERENT from both above)
- OrderCreated event → Set status='Draft', createdAt
- OrderCancelled event → Set status='Cancelled'
```

**Enforcement Rule**:
- ConfirmOrderState used ONLY by handleConfirmOrder
- ShipOrderState used ONLY by handleShipOrder
- NEVER share state between commands
- NEVER create a single "OrderState" for all Order commands

This is **NOT** a full aggregate state bundle—it's minimal, command-specific state access.

### 3. Design Commands
Commands are **intent data from UI or Processor**:
- Represent what user/system wants to do
- Can be rejected (validation failure)
- Only UI or Processor can issue commands
- Load current stream state for validation
- Produce events if valid, or reject if invalid

Format:
```text
Command: ConfirmOrder
Source: UI or Processor (only these can issue)
Input: orderId, paymentId

Processing:
    1. Load current state from Order:orderId stream
    2. Validate preconditions:
       - state.status === 'Draft' (reject: already confirmed)
       - paymentId is valid (reject: invalid payment)
    3. If all valid:
       - Produce: OrderConfirmed event
         - Data: paymentId, confirmedAt
         - Implicit: orderId (from stream), previous status (from state)
    4. If any validation fails:
       - Reject: return error (no event created)

Outcomes:
     Success: OrderConfirmed event appended to stream
     Rejection: Error returned, no event created
```

**Key Rules**:
- Only UI or Processor can issue commands (entry points)
- One command per UI/Processor action
- Commands validate against stream state
- Successful command → Event(s) created
- Failed validation → Command rejected, no event
- Commands are synchronous decision logic (pure)

### 4. Design Read Models
Read models are **projections of events for UI/Processor queries**:
- Built from events (only source is events)
- Optimized for specific query patterns
- Consumed by UI or Processor (for display/decision)
- Can be regenerated from events anytime

Format:
```text
ReadModel: OrderSummaryView
Purpose: UI displays customer order list, Processor checks order status

Subscribed to events:
  - OrderCreated
  - OrderConfirmed
  - OrderShipped
  - OrderCancelled

Data (optimized for queries):
  {
    orderId: string
    customerId: string
    total: number
    status: string
    createdAt: Date
    confirmedAt?: Date
    shippedAt?: Date
  }

Update from events:
  - OrderCreated → Insert row (id, customer, total, status='Draft')
  - OrderConfirmed → Update status='Confirmed', set confirmedAt
  - OrderShipped → Update status='Shipped', set shippedAt
  - OrderCancelled → Update status='Cancelled'

Consumed by:
  - UI: displays list of orders
  - Processor: checks if order can be shipped
```

### 5. Document Event Causality
Show how events relate to each other:

```text
Command Flow:
CreateOrder command
    → OrderCreated event
       ↓ (may trigger external process)
ConfirmOrder command (reads OrderCreated state)
    → OrderConfirmed event
       ↓ (may trigger)
ShipOrder command (reads OrderCreated + OrderConfirmed state)
    → OrderShipped event
```

### 6. Document State Transitions
Show valid state transitions:

```text
Order Stream State Transitions:

Initial state: (empty stream)
  ↓
CreateOrder → OrderCreated
  ↓
State: Draft

Draft state:
  → ConfirmOrder → OrderConfirmed → State: Confirmed
  → CancelOrder → OrderCancelled → State: Cancelled

Confirmed state:
  → ShipOrder → OrderShipped → State: Shipped
  → CancelOrder (rejected - already confirmed)

Shipped state:
  → No more transitions allowed
```

### Output Format

Present complete model as:

```markdown
# Event Model: [Domain]

## Event Streams

### Stream: Order

**Identity**: orderId

**Events**:
- OrderCreated: Initial event creating the order
Data: customerId, items[], total, shippingAddress

- OrderConfirmed: Payment confirmed
Data: paymentId, confirmedAt

- OrderShipped: Order shipped
Data: shipmentId, shippedAt

- OrderCancelled: Order cancelled
Data: cancelledAt, reason

**State Projection (Human Example)**:
For the ConfirmOrder command, we need minimal state:
```text
ConfirmOrderState:
  - orderId: 'order-123'
  - status: 'Draft'
```

For the ShipOrder command, we need different data:
```text
ShipOrderState:
  - orderId: 'order-123'
  - status: 'Confirmed'
  - paymentId: 'payment-456'
```

---

## Commands

### Command: CreateOrder
- Input: customerId, items[], shippingAddress
- Validation: Items valid, customerId exists
- Events produced: OrderCreated
- Possible outcomes: Success (OrderCreated) or Validation error

### Command: ConfirmOrder
- Input: orderId, paymentId
- Validation: Order in Draft status, payment validated
- Events produced: OrderConfirmed
- Possible outcomes: Success or "Already confirmed" error

---

## Read Models (Optional)

### ReadModel: OrderSummaryView
- Purpose: Quick lookup of order status
- Events: OrderCreated, OrderConfirmed, OrderShipped, OrderCancelled
- Queries served: GetOrder(orderId), ListOrdersByCustomer(customerId)

---

## Implementation Notes
- All state is derived from events
- Commands validate against derived state
- No transaction across streams
- Events are source of truth
- Read models can be rebuilt from events
```

## Key Event Sourcing Principles

1. **Events are Facts**: Events describe what happened, not what might happen
2. **Immutable Event Log**: Events are appended, never modified
3. **State is Minimal and Command-Driven**: State is built by replaying events, but ONLY for what a specific command needs to validate. Not all stream fields are needed for all commands.
4. **Not DDD Aggregates**: Stream roots group events logically, but aren't bundles of related data like DDD aggregates. State is determined per-command, not designed upfront for the whole stream.
5. **Commands are Pure**: No side effects, just decision logic against minimal state
6. **Read Models are Separate**: Read models (projections) are separate from command-validation state. Read models can have rich data; command state stays minimal.
7. **Event Causality**: Commands → [minimal state] → Events → [read models]

## Design Patterns

### Compensation Pattern
Handle errors by appending compensation events:
```text
Command: ProcessPayment failed
  → PaymentFailed event
    (triggered by external error)
  → OrderCancelled event (compensation)
    (or retry logic)
```

### Temporal Queries
Answer "what was the state at time T?":
```text
Replay events up to timestamp T
  → Get historical state
```

## Best Practices for Event Model Design

### 1. Design Minimal State Per Command
Each command handler only loads the state it needs:
- "LoadOrderState loads { id, items, total, shipping, customer, payment, status, ... }"
- "ConfirmOrderState loads { status, orderId }"
- "ShipOrderState loads { status, orderId, paymentConfirmed }"

### 2. Separate Command State from Query Models
Keep command-validation state and read models strictly separate:
- **Command State** (minimal): Used by handlers to validate commands
- **Query Models** (rich): Used by UI/Processor to display/query data
- Never share between them

### 3. Name State Interfaces by Command
Use the pattern `[CommandName]State` to make the relationship explicit:
- `PublishReviewState` for PublishReview command
- `EditReviewState` for EditReview command
- `ReviewState` (ambiguous - which command?)

### 4. Document State Transitions Clearly
Show what state changes trigger what commands:
- Include initial state
- Show all valid transitions
- Mark impossible transitions (and why)
- Document rejection conditions

### 5. Make All Constraints Explicit
Transform "obvious" business rules into documented invariants:
- "Obviously can't ship an unconfirmed order"
- "ShipOrder validation: requires status='Confirmed' with paymentId"

### 6. Keep Event Data Factual
Events record facts, not derived values:
- "OrderCreated { items, total }" (total is computed from items)
- "OrderCreated { items[] with unitPrice, shippingAddress }" (total computed in projection)

## Quality Checklist

- [ ] All events are immutable facts (past tense)
- [ ] Events contain only captured data, no computed fields
- [ ] State projection is deterministic from events
- [ ] Each command validates against current state
- [ ] Commands either produce events or reject
- [ ] Event causality is clear
- [ ] State transitions are documented
- [ ] No references between streams in events
- [ ] Read models are optional, not required
- [ ] All logic is state → events (pure functions)
