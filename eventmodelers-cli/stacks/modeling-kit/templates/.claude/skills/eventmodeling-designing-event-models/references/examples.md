# Designing Event Models — Worked Examples

These are conceptual worked examples (Order domain) illustrating the event-model design reasoning this skill applies — useful for understanding the reasoning, but the actual instructions to follow live in the numbered Workflow sections of the main SKILL.md.

## 1. Design Events — worked example

```text
Entity: Order (order-123)

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
   (implicit: orderId, previous status verified)

3. OrderShipped
   Triggered by: ShipOrder command
   Data: shipmentId, shippedAt
   (from command: shipmentId)
   (implicit: orderId, confirmed status verified)
```

## 2. Design Commands — worked example

```text
Command: ConfirmOrder
Source: UI or Processor (only these can issue)
Input: orderId, paymentId

Preconditions:
  - order status is 'Draft' (reject: already confirmed)
  - paymentId is valid (reject: invalid payment)

Outcomes:
   Success: OrderConfirmed event
     Data: paymentId, confirmedAt
     Implicit: orderId, previous status
   Rejection: error returned, no event created
```

## 3. Design Read Models — worked example

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

## 4. Document Event Causality — worked example

```text
Command Flow:
CreateOrder command
    → OrderCreated event
       ↓ (may trigger downstream action)
ConfirmOrder command (depends on OrderCreated having happened)
    → OrderConfirmed event
       ↓ (may trigger downstream action)
ShipOrder command (depends on OrderCreated + OrderConfirmed having happened)
    → OrderShipped event
```

## 5. Document State Transitions — worked example

```text
Order State Transitions:

Initial state: (no order yet)
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

## Events

### Entity: Order

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

---

## Commands

### Command: CreateOrder
- Input: customerId, items[], shippingAddress
- Preconditions: Items valid, customerId exists
- Events produced: OrderCreated
- Possible outcomes: Success (OrderCreated) or validation error

### Command: ConfirmOrder
- Input: orderId, paymentId
- Preconditions: Order in Draft status, payment validated
- Events produced: OrderConfirmed
- Possible outcomes: Success or "Already confirmed" error

---

## Read Models (Optional)

### ReadModel: OrderSummaryView
- Purpose: Quick lookup of order status
- Events: OrderCreated, OrderConfirmed, OrderShipped, OrderCancelled
- Queries served: GetOrder(orderId), ListOrdersByCustomer(customerId)
```
