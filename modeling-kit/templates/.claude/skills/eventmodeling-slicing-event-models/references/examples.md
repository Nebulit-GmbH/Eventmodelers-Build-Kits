# Event Modeling Slice Examples

## Table of Contents
- [Acme Corp Order Management System](#acme-corp-order-management-system)
- [Slice Interaction Diagram](#slice-interaction-diagram)
- [Dependency Matrix Example](#dependency-matrix-example)
- [Fan-Out Timeline Example](#fan-out-timeline-example)
- [Checklist for Slice Definition](#checklist-for-slice-definition)

---

## Acme Corp Order Management System

### Complete Slice Breakdown

```

 FEATURE SLICE 1: Core Order Flow

 Business Value: Customers can place and confirm orders
 Effort: 2 weeks / 1-2 engineers
 MVP Critical: YES (foundation for all others)

 Handlers & States:
   - CreateOrderHandler + CreateOrderState
   - ConfirmOrderHandler + ConfirmOrderState
 Events Produced: OrderCreated, OrderConfirmed
 Events Consumed: NONE
 Read Models Created: OrderDetailView, OrderListView

 Upstream Dependencies: NONE (this is foundation)
 Can Run Parallel: NONE (blocks everything else)



 FEATURE SLICE 2: Payment Processing

 Business Value: Orders can be paid and refunded
 Effort: 2 weeks / 1-2 engineers
 MVP Critical: YES (no revenue without payment)

 Handlers & States:
   - AuthorizePaymentHandler + AuthorizePaymentState
   - ProcessRefundHandler + ProcessRefundState
 Events Consumed: OrderConfirmed (triggers payment)
 Events Produced: PaymentAuthorized, PaymentFailed,
                  RefundInitiated, RefundCompleted
 Read Models Created: PaymentStatusView

 Upstream Dependencies: Slice 1 (needs OrderConfirmed event)
 Can Run Parallel: NONE until Slice 1 ships



 FEATURE SLICE 3: Inventory Management

 Business Value: Stock is reserved and released per order
 Effort: 2 weeks / 1-2 engineers
 MVP Critical: YES (prevents overselling)

 Handlers & States:
   - ReserveInventoryHandler + ReserveInventoryState
   - ReleaseInventoryHandler + ReleaseInventoryState
 Events Consumed: PaymentAuthorized (triggers reservation)
 Events Produced: InventoryReserved, InventoryReleased
 Read Models Created: InventoryLevelView, ReservationView

 Upstream Dependencies: Slice 2 (needs PaymentAuthorized)
 Can Run Parallel: Slice 4 (independent once Slice 2 ships)



 FEATURE SLICE 4: Fulfillment & Shipping

 Business Value: Orders are shipped and delivery is confirmed
 Effort: 2 weeks / 1-2 engineers
 MVP Critical: YES (orders must arrive)

 Handlers & States:
   - CreateShipmentHandler + CreateShipmentState
   - ConfirmDeliveryHandler + ConfirmDeliveryState
 Events Consumed: InventoryReserved (triggers shipment)
 Events Produced: ShipmentCreated, DeliveryConfirmed
 Read Models Created: ShipmentStatusView, OrderFulfillmentView

 Upstream Dependencies: Slice 3 (needs InventoryReserved)
 Can Run Parallel: Slice 3 (parallel once Slice 2 ships)

```

### Critical Path

```
CRITICAL PATH (must do in sequence):
Slice 1 (Week 1-2) → Core Orders, foundation
        ↓
Slice 2 (Week 3-4) → Payment, depends on OrderConfirmed
        ↓
Slices 3 & 4 (Week 5-6) → Inventory & Fulfillment, both depend on PaymentAuthorized
        ↓
Integration & Testing (Week 7-8)
```

### Team Fan-Out

```
TEAM FAN-OUT:
Week 1-2:  Team A works on Slice 1 (Core Orders)
Week 3-4:  Team A works on Slice 2 (Payment)
             Team B writes integration tests for Slice 1
Week 5-6:  Team A works on Slice 3 (Inventory)
             Team B works on Slice 4 (Fulfillment)
             Both work in parallel once Payment ships!
```

### MVP Options

```
MVP Option 1 (Minimal):
Launch: Slices 1-2 only (Week 4) - orders can be placed and paid
Later: Add Slices 3-4 (fulfillment)

MVP Option 2 (Full):
Launch: All 4 slices (Week 8) - complete order-to-delivery flow
```

---

## Slice Interaction Diagram

### Visual Flow

```
User Actions:
[Customer places order]
       ↓
[Core Order Flow Slice]
        Command: CreateOrder → ConfirmOrder
        Event: OrderCreated → OrderConfirmed
        Read Model: OrderDetailView
       ↓
[Event Bus: OrderConfirmed]
       ↓

    ↓
[Payment Slice]
        Command: AuthorizePayment
        Event: PaymentAuthorized
        Read Model: PaymentStatusView
       ↓
[Event Bus: PaymentAuthorized]
       ↓

    ↓              ↓
[Inventory Slice]  [Fulfillment Slice]
    Event              Event
    InventoryReserved  ShipmentCreated
    ↓                  ↓

       ↓
    [Read Models Update]
       ↓
    [Display to Users]
```

---

## Dependency Matrix Example

```
              | Core Orders | Payment | Inventory | Fulfillment |

Core Orders  |  (self)    | - | - | - |
Payment      | ← Depends   |  (self)  | - | - |
Inventory    | ← Depends   | ← Depends |  (self)  | - |
Fulfillment  | ← Depends   | ← Depends | ← Depends |  (self)  |

Legend:
  ← Depends on (arrow points to dependency)
  - = No dependency
   = Self (no external dependency)
```

---

## Fan-Out Timeline Example

### Visual Timeline

```
Week 1-2:   [Slice 1: Core Orders] (Team A)
             Unlocks Payment slice

Week 3-4:   [Slice 2: Payment] (Team A)  [Integration tests Slice 1] (Team B)
             Payment unlocks Inventory & Fulfillment

Week 5-6:   [Slice 3: Inventory] (Team A)  [Slice 4: Fulfillment] (Team B)
             Can work in parallel once Payment ships

Week 7-8:   Integration & Cross-Slice Testing
```

### Fan-Out Pattern

```
Slice 1           Slice 2           Slice 3 (Inventory)
(Core Orders) →   (Payment)    →
                                    Slice 4 (Fulfillment)

Benefits:
   Sequential until Payment unlocks the fan-out
   Teams A and B work in parallel from Week 5
   Critical path is clear and enforced by event dependencies
   Risk isolated: Inventory issues don't block Fulfillment work
```

---

## Checklist for Slice Definition

Before implementing a slice, verify:

```
Scope:
[ ] Clear business value statement (one sentence)
[ ] All commands identified
[ ] All events identified
[ ] All read models identified
[ ] No scope creep (staying focused)

Dependencies:
[ ] Upstream dependencies listed (what we need)
[ ] Downstream dependents listed (what depends on us)
[ ] Can we develop in parallel with other slices?
[ ] Do we have all dependencies available?

Boundaries:
[ ] Handler is isolated (own [CommandHandler]State class)
[ ] No shared state classes with other slices
[ ] Events are contract between slices (source of truth)
[ ] Read models owned by one slice, consumed by others

Testability:
[ ] Can this be tested independently?
[ ] Do we have test data without dependent slices?
[ ] Can we mock dependencies?

Deployability:
[ ] Can this be deployed independently?
[ ] Or must we deploy with other slices?
[ ] Database migrations needed? How to coordinate?

Team:
[ ] Right-sized for 1-2 engineers?
[ ] Effort estimated (days)?
[ ] Assigned to team?
[ ] Sprint plan clear?
```
