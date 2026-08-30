# Designing Event Models — Worked Examples

These are conceptual worked examples (Order domain) illustrating the event-model design reasoning this skill applies — useful for understanding the reasoning, but the actual instructions to follow live in the "Core Architectural Rule" statement and the numbered Workflow sections of the main SKILL.md.

## Core Architectural Rule — WRONG vs. CORRECT

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

## 1. Design Event Streams — worked example

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

## 2. Design Command State Read Models — worked example

Example for the Order stream, with a separate command state read model for each command:

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

## 3. Design Commands — worked example

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

## 4. Design Read Models — worked example

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

## 5. Document Event Causality — worked example

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

## 6. Document State Transitions — worked example

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

## Output Format — full worked example

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
