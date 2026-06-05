---
name: eventmodeling-applying-conways-law
description: "Step 6 of Event Modeling - Apply Conway's Law with swimlanes. Organize events into autonomous system parts that different teams can independently own. Use after defining inputs/outputs. Do not use for: planning feature slice implementation order (use eventmodeling-slicing-event-models) or defining command/read model boundaries (use eventmodeling-designing-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Applying Conway's Law

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already specified: existing team structure, team responsibilities, and autonomous boundary preferences. Interview when team structure is unclear or organizational alignment hasn't been discussed.

**Interview Strategy**: Understand team organization and decision-making to design system boundaries that teams can own independently. Misalignment here creates bottlenecks and tight coupling later.

### Critical Questions

When team structure or boundaries are unclear:

1. **Team Structure & Ownership** (Impact: Determines how many swimlanes/systems to create)
   - Question: "How is your organization structured? (A) Single team owns everything, (B) Separate teams by domain (payments, inventory, etc.), (C) Separate teams by function (backend, frontend, etc.)"
   - Why it matters: Team structure directly shapes system boundaries; aligning them reduces coordination overhead
   - Follow-up triggers: If (B) → ask what each team owns; if (C) → discuss how to organize by domain instead

2. **Boundary Autonomy Level** (Impact: Determines coupling and inter-team communication patterns)
   - Question: "How much autonomy should each team have? (A) Very high (minimal cross-team communication), (B) Moderate (coordinate via events), (C) Low (frequent coupling acceptable)"
   - Why it matters: Highly autonomous teams need clean event-based boundaries; low autonomy might accept more coupling
   - Follow-up triggers: If (A) → strict event-driven design; if (C) → discuss why coupling is needed

3. **External System Integrations** (Impact: Determines if integrations become separate swimlanes or embedded in existing ones)
   - Question: "Do you need to integrate with external systems? (A) Payment processor, (B) Shipping provider, (C) Multiple external systems, (D) No external integrations?"
   - Why it matters: External systems often become separate swimlanes; knowing which ones matters for boundary design
   - Follow-up triggers: For each integration → ask "Who owns the integration—existing team or new team?"

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Clear team structure (who owns what)
  - AND specified desired level of autonomy
  - AND identified external integrations

Then: Skip interview, proceed directly to swimlanes

Else: Conduct interview
```

**Phase 1: Organization Assessment** (Questions 1-2)
- Understand team structure
- Determine autonomy expectations
- Establish boundary philosophy

**Phase 2: Integration Mapping** (Question 3)
- Identify external systems
- Plan integration boundaries
- Finalize swimlane count

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## 6. Conway's Law (eventmodeling-applying-conways-law)

### Team Structure
- Team 1: [Name] - Owns [domain]
- Team 2: [Name] - Owns [domain]
- Team 3: [Name] - Owns [domain]

### Autonomy Goals
[High / Moderate / Low]

### Swimlanes
- [Swimlane 1]: [Team] owns [events]
- [Swimlane 2]: [Team] owns [events]
- [Swimlane 3]: [Team] owns [events]

### Cross-Team Communication
- [Team A] → [Team B] via [event]
- [Team B] → [Team C] via [event]
```

Update Interview Trail:
```markdown
| 6 | eventmodeling-applying-conways-law | [today] | Swimlanes defined, team boundaries confirmed |
```

---

## Workflow

Given all events, inputs, and outputs, organize by ownership:

### 1. Identify System Boundaries
Determine what constitutes a separate system/bounded context:

```
System Boundaries:


 Order Management System                             
  - Owns: Order entity and its lifecycle             
  - Events: OrderCreated, OrderConfirmed, Cancelled  
  - Owns: Order state machine                        



 Payment Processing System                           
  - Owns: Payment authorization and processing       
  - Events: PaymentAuthorized, PaymentFailed         
  - Owns: Payment state machine                      



 Inventory System                                    
  - Owns: Stock levels and reservations              
  - Events: InventoryReserved, InventoryAllocated    
  - Owns: Inventory state machine                    



 Fulfillment System                                  
  - Owns: Shipments and delivery                     
  - Events: OrderShipped, DeliveryConfirmed          
  - Owns: Shipment state machine                     

```

### 2. Create Swimlane Diagram
Visual representation of system boundaries:

```
                Event Stream Timeline
                →

Order Team      OrderCreated   OrderConfirmed   OrderCancelled
                                                   
Payment Team                 PaymentAuthorized    PaymentFailed
                                    
Inventory Team                InventoryReserved
                                    
Fulfillment Team              OrderShipped    DeliveryConfirmed

Each team owns their swimlane events
Coordination via events crossing swimlanes
```

### 3. Map Team Responsibilities
Define what each team owns:

```
Order Management Team
 Commands they handle:
   - CreateOrder
   - ConfirmOrder
   - CancelOrder
 Events they produce:
   - OrderCreated
   - OrderConfirmed
   - OrderCancelled
 Read Models they maintain:
   - OrderStatusView
   - OrderListView
 Systems they call:
    - Payment System (to confirm payment)
    - Inventory System (to check stock)

Payment Processing Team
 Commands they handle:
   - AuthorizePayment
   - ProcessPayment
   - RefundPayment
 Events they produce:
   - PaymentAuthorized
   - PaymentFailed
   - PaymentRefunded
 Read Models they maintain:
   - PaymentStatusView
   - TransactionHistory
 Systems they depend on:
    - Payment Gateway (external)
    - Order System (for context)

Inventory Team
 Commands they handle:
   - ReserveInventory
   - ReleaseReservation
   - AllocateStock
 Events they produce:
   - InventoryReserved
   - ReservationReleased
   - StockAllocated
 Read Models they maintain:
   - InventoryLevelView
   - ReservationView
 Systems they depend on:
    - Order System (triggers)
    - Warehouse System (stock source)

Fulfillment Team
 Commands they handle:
   - CreateShipment
   - MarkShipped
   - ConfirmDelivery
 Events they produce:
   - ShipmentCreated
   - OrderShipped
   - DeliveryConfirmed
 Read Models they maintain:
   - ShipmentTrackingView
   - DeliveryScheduleView
 Systems they depend on:
    - Inventory System (items to ship)
    - Carrier APIs (tracking)
```

### 4. Identify Inter-System Communication
Show how systems talk to each other:

```
Communication Patterns:

Order System  →  Payment System
 Order System produces: OrderConfirmed event
 Payment System consumes: OrderConfirmed
 Payment System reacts: Issues AuthorizePayment command
 Payment System produces: PaymentAuthorized event

Order System  →  Inventory System
 Order System produces: PaymentAuthorized event (indirectly)
 Inventory System consumes: PaymentAuthorized
 Inventory System reacts: Issues ReserveInventory command
 Inventory System produces: InventoryReserved event

Inventory System  →  Fulfillment System
 Inventory System produces: InventoryReserved event
 Fulfillment System consumes: InventoryReserved
 Fulfillment System reacts: Issues CreateShipment command
 Fulfillment System produces: OrderShipped event
```

### 5. Define System Interfaces
What each system exposes:

```
Order System Interface
 Commands it accepts:
   - CreateOrder (from UI)
   - ConfirmOrder (from UI)
   - CancelOrder (from UI or Processors)
 Events it produces:
   - OrderCreated
   - OrderConfirmed
   - OrderCancelled
 Read Models it provides:
    - OrderStatusView
    - OrderListView

Payment System Interface
 Commands it accepts:
   - AuthorizePayment (from Payment Processor/Order System)
   - ProcessPayment (from Order System)
 Events it produces:
    - PaymentAuthorized
    - PaymentFailed
    - PaymentProcessed

Inventory System Interface
 Commands it accepts:
   - ReserveInventory (triggered by PaymentAuthorized event)
 Events it produces:
    - InventoryReserved
    - InventoryFailed
```

### 6. Identify Processors vs Systems
Show where automation lives:

```
Processors (autonomous automation):

1. PaymentProcessor
   Triggered by: OrderConfirmed event
   Logic: Calls external payment gateway
   Produces: AuthorizePayment command
   Lives in: Payment System

2. InventoryProcessor
   Triggered by: PaymentAuthorized event
   Logic: Checks stock, reserves inventory
   Produces: ReserveInventory command
   Lives in: Inventory System

3. FulfillmentProcessor
   Triggered by: InventoryReserved event
   Logic: Creates shipment records
   Produces: CreateShipment command
   Lives in: Fulfillment System

4. NotificationProcessor
   Triggered by: OrderCreated, OrderConfirmed, OrderShipped events
   Logic: Sends emails/SMS
   Produces: No commands (info-only)
   Lives in: Notification System (cross-cutting)
```

## Output Format

Present as:

```markdown
# System Organization: [Domain Name]

## System Boundaries

### System: Order Management
- **Team**: Order Team
- **Responsibilities**: Create, confirm, cancel orders
- **Commands**: CreateOrder, ConfirmOrder, CancelOrder
- **Events Produced**: OrderCreated, OrderConfirmed, OrderCancelled
- **Events Consumed**: PaymentAuthorized, InventoryReserved (for state updates)
- **Read Models**: OrderStatusView, OrderListView
- **Scope**: One stream type (Order)

### System: Payment Processing
- **Team**: Payment Team
- **Responsibilities**: Authorize and process payments
- **Commands**: AuthorizePayment, ProcessPayment, RefundPayment
- **Events Produced**: PaymentAuthorized, PaymentFailed, PaymentRefunded
- **Events Consumed**: OrderConfirmed (from Order System)
- **Read Models**: PaymentStatusView, TransactionHistory
- **Dependencies**: External payment gateway
- **Scope**: One stream type (Payment)

### System: Inventory Management
- **Team**: Inventory Team
- **Responsibilities**: Stock management and reservations
- **Commands**: ReserveInventory, ReleaseReservation, AllocateStock
- **Events Produced**: InventoryReserved, ReservationReleased, StockAllocated
- **Events Consumed**: PaymentAuthorized (from Payment System)
- **Read Models**: InventoryLevelView, ReservationView
- **Dependencies**: Warehouse system
- **Scope**: One stream type (InventoryReservation)

[Continue for each system]

---

## Event Flow Across System Boundaries

### Flow: Order → Payment → Inventory → Fulfillment

```
Time →

Order System
OrderCreated →
OrderConfirmed →
                              (triggers)
Payment System
PaymentAuthorized →
                       (triggers)
Inventory System
InventoryReserved →
                       (triggers)
Fulfillment System
OrderShipped
DeliveryConfirmed
```

---

## Team Responsibilities Matrix

| Team | Creates Commands | Produces Events | Owns Read Models |
|------|-----------------|-----------------|------------------|
| Order | CreateOrder, ConfirmOrder | OrderCreated, OrderConfirmed | OrderStatusView |
| Payment | AuthorizePayment | PaymentAuthorized | PaymentStatusView |
| Inventory | ReserveInventory | InventoryReserved | InventoryLevelView |
| Fulfillment | CreateShipment | OrderShipped | ShipmentTrackingView |

---

## Inter-System Communication

### Order → Payment
- Trigger: OrderConfirmed event
- Action: Payment System listens via Processor
- Result: AuthorizePayment command issued

### Payment → Inventory
- Trigger: PaymentAuthorized event
- Action: Inventory System listens via Processor
- Result: ReserveInventory command issued

[Document all communication patterns]

---

## Dependencies

### External Systems

| System | Owns | Called By | Purpose |
|--------|------|-----------|---------|
| Payment Gateway | Payment provider | Payment System | Authorization |
| Warehouse | Inventory source | Inventory System | Stock info |
| Carrier API | Shipping | Fulfillment System | Tracking |

---

## Independent Development

Each system can:
- Develop independently
- Use different tech stacks
- Scale independently
- Deploy independently
- Own their events
- Maintain their read models

Coordination via:
- Events (async messaging)
- Processors (listen and react)
- Read models (shared views)
```

## Quality Checklist

- [ ] Each system has clear ownership
- [ ] System boundaries are well-defined
- [ ] Events map to systems
- [ ] Commands map to teams
- [ ] Cross-system communication is documented
- [ ] No circular dependencies
- [ ] Each team has independent scope
- [ ] Processors are explicitly assigned
- [ ] External systems identified
- [ ] System interfaces are clear

## Conway's Law Principle

**System architecture mirrors team structure**:
- Separate teams → Separate systems
- Each system owns events
- Communication through events
- Independent development possible
- Aligns with org chart

## Key Benefits

1. **Team Independence**: Each team owns their domain
2. **Clear Ownership**: No confusion about responsibility
3. **Scalable Architecture**: Systems can evolve independently
4. **Event-Driven**: Natural communication via events
5. **Deployment**: Each team deploys their system
