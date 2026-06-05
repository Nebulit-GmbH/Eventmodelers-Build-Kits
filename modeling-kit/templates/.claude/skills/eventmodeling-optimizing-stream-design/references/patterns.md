# Aggregate Boundary Design Patterns

## Contents
- Aggregate Boundary Design Patterns (5 patterns with examples)
- Stream Size Decision Tree
- Red Flags: Redesign Needed
- Tips for Optimal Stream Design

---

## Aggregate Boundary Design Patterns

### Pattern 1: Single Entity (Most Common)

 CORRECT: One aggregate per entity
```
Aggregate: Order
Root Identity: orderId (e.g., 'order-123')
Entity: The specific order
Lifetime: 1-2 years

Events in stream:
  1. OrderCreated (2024-01-15)
  2. OrderLineAdded (2024-01-15)
  3. OrderLineAdded (2024-01-15)
  4. OrderConfirmed (2024-01-16)
  5. PaymentProcessed (2024-01-16)
  6. OrderShipped (2024-01-20)
  7. OrderDelivered (2024-01-25)

Stream Length: 7 events
Snapshotting: NOT NEEDED 

Identity Principle: orderId is the natural business key
Boundary: Everything about THIS specific order, nothing else
Consistency: Only one order being modified at a time
```

---

### Pattern 2: Composite Entity (Proper Composition)

 CORRECT: Aggregate contains related child entities
```
Aggregate: Order
Root Identity: orderId (e.g., 'order-456')

Contains related children (same lifetime):
  - OrderLines: 3 items
    * Line 1: productId=prod-A, qty=2, price=$50
    * Line 2: productId=prod-B, qty=1, price=$100
    * Line 3: productId=prod-C, qty=5, price=$10

  - ShippingAddress:
    street: 123 Main St, City: Portland, State: OR

  - PaymentInfo:
    method: credit_card, amount: $400

Events in stream:
  1. OrderCreated (customer-789, 3 items)
  2. OrderLineAdded (item 1)
  3. OrderLineAdded (item 2)
  4. OrderLineAdded (item 3)
  5. OrderConfirmed (payment method selected)
  6. PaymentProcessed (authorization complete)
  7. OrderShipped (tracking 123456)

Stream Length: 7 events
Snapshotting: NOT NEEDED (well under 1000) 

Pattern: Small, bounded number of children per parent
Lifetime: Parent and all children created/destroyed together
Consistency: All modified as a unit (can't ship without payment, etc.)
```

---

### Pattern 3: Collection (ANTI-PATTERN - DO NOT USE)

 WRONG: Treating a collection as aggregate
```
Bad Aggregate: AllOrders
Root Identity: "all-orders-collection" (artificial, meaningless)

Contains: Every order ever created
Events:
    1. OrderCreated (customer-001, order-001)
    2. OrderCreated (customer-002, order-002)
    3. OrderCreated (customer-001, order-003)
    4. OrderCreated (customer-003, order-004)
    ... (continues forever, unbounded)

Month 1: 50,000 events
Year 1: 600,000 events
Year 5: 3,000,000 events 

Stream Length: 1,000,000+ events
Snapshotting: Doesn't help - design is fundamentally wrong 

Problems with this approach:
  - No single business identity (it's a collection, not an entity)
  - Stream grows unbounded (can never achieve performance SLA)
  - Snapshotting won't fix it (snapshot is also 1M+ events)
  - Can't split or scale
  - Every write goes to same stream (contention)

Solution: Use a projection/read model query instead, not an aggregate
  - Query: "GetAllOrdersByCustomer(customer-id)"
  - Query: "GetOrdersByStatus(status)"
  - Rebuild from individual Order streams on-demand
```

---

### Pattern 4: Event Log (ANTI-PATTERN - DO NOT USE)

 WRONG: Using aggregate as event log
```
Bad Aggregate: SystemLog
Root Identity: "system-log" (meaningless placeholder)

Contains: Every system event imaginable
Events:
    1. UserLoggedIn (user-123)
    2. OrderCreated (order-456)
    3. PaymentProcessed (payment-789)
    4. InventoryUpdated (sku-101)
    5. UserLoggedOut (user-123)
    6. UserLoggedIn (user-223)
    ... (grows indefinitely, no pattern)

Per Day: 100,000+ events
Per Year: 36,500,000+ events 

Stream Length: 10,000,000+ events
Snapshotting: Impossible - design is fundamentally broken 

Problems with this approach:
  - No business identity (log of everything)
  - Events unrelated to each other (mixing user, order, payment, inventory)
  - No consistency boundary (user login != order creation)
  - Can't answer "what's the state of X?" (too mixed)
  - Contention: every subsystem writing to same stream
  - Can't replay meaningfully (mixed concerns)

Solution: Use separate event logs or time-series database
  - Keep dedicated event streams: Order, Payment, Inventory, User
  - Use time-series DB for metrics/logs: Prometheus, DataDog, ELK
  - Query system logs separately from domain events
```

---

### Pattern 5: Historical Aggregate (GOOD - When Needed)

 CORRECT: Keep historical data for audit/compliance
```
Aggregate: ArchivedOrder
Root Identity: archivedOrderId (e.g., 'archived-order-001')
Purpose: Regulatory compliance (7-year retention)

Contains: Snapshot + audit trail of an order
Events:
    1. OrderArchived (original order-123 on 2023-12-31)
       - reason: compliance_retention
       - originalData: { id, customerId, items, total, dates }

    2. AuditLogAdded (accessed by accounting, 2024-01-15)
       - accessor: accounting@company.com
       - action: viewed for tax audit

    3. AuditLogAdded (accessed by auditor, 2024-02-01)
       - accessor: auditor@firm.com
       - action: reviewed for compliance

  ... (additional audit entries over time)

Lifetime: 7 years (regulatory requirement)
Stream Length: 500-2000 events (audit entries added slowly)
Snapshotting: Not needed (historical, not active) 

Key architectural principles:
  - Completely separate from active Order aggregate
  - Active Order is for current business operations
  - Archived Order is immutable historical record
  - Different access patterns, different SLAs
```

---

## Stream Size Decision Tree

Use this to decide if your streams are properly designed:

```
Does your stream have a natural business identity?
 NO → This is not an aggregate, it's a log/report
    SOLUTION: Use read model/projection, not aggregate

 YES → How many events does it accumulate?
   
    < 100 events
       PERFECT: No optimization needed
   
    100-1000 events
      Is it growing because of high frequency?
        NO →  GOOD: Probably well-designed
        YES →  MONITOR: Watch for growth
     
      Does each event represent a meaningful state change?
         YES →  GOOD: Healthy stream
         NO →  REDESIGN: Too granular events
   
    1000-5000 events
      Can you split this aggregate?
        YES →  REDESIGN: Do it now
          Examples: User → UserProfile + UserSessions
                    Order → Order + OrderLineItems
       
        NO → Is read frequency high (> 10/sec)?
           YES →  Consider snapshotting at 5000
           NO →  ACCEPTABLE: Leave as-is
     
      Is latency critical (< 100ms)?
         YES →  MONITOR: Measure replay time
         NO →  ACCEPTABLE: No snapshotting needed
   
    5000-10000 events
      This is a design problem →  REDESIGN
      OR business justifies complexity → Snapshot at 5000
     
      Questions before snapshotting:
         Can I split aggregate? (usually YES)
         Can I reduce event granularity? (sometimes)
         Am I using a read model for this aggregate? (maybe not)
         If all NO → Then snapshot is justified
   
    > 10000 events
        CRITICAL: Redesign required
           This is NOT a properly designed aggregate
           Snapshotting won't save you
           Root cause: Aggregate boundary is wrong
```

---

## Red Flags: Redesign Needed (Not Snapshotting)

If your stream exhibits ANY of these, snapshotting won't help—you need to redesign:

```
 Red Flag 1: Stream growing > 1000 events/day
   Cause: Events are too granular
   Solution: Batch events or coarsen granularity
   Example: "UserClickedButton" → "UserCompletedTask" (higher level)

 Red Flag 2: Thousands of events but no business meaning
   Cause: Treating log as aggregate
   Solution: Use read model/query instead of aggregate
   Example: "SystemMetricRecorded"  → Use time-series database 

 Red Flag 3: Stream contains unrelated entities
   Cause: Aggregate boundary is wrong
   Solution: Split into separate aggregates
   Example: "AllOrders"  → "Order" per customer 

 Red Flag 4: Snapshot is 80% of the stream size
   Cause: Snapshot isn't helping
   Solution: Re-examine aggregate boundary
   Example: If snapshot is 800 events and deltas 100, redesign

 Red Flag 5: Can't explain what business question the stream answers
   Cause: Not a real aggregate
   Solution: Convert to read model/projection
   Example: "SystemEvents"  → Query specific streams 

 Red Flag 6: Stream length doubles every 6 months
   Cause: Exponential growth pattern
   Solution: Likely aggregate boundary issue
   Example: Split by time period: 2024-Orders vs. 2025-Orders
```

---

## Tips for Optimal Stream Design

### 1. Favor Redesign Over Snapshotting
```
Cost:  Redesign effort < Snapshotting maintenance
Quality: Better design > Better optimization
Future: Smaller streams are easier to scale
```

### 2. Understand Event Granularity
```
 RIGHT: One event per meaningful state change
 WRONG: Multiple events per semantic operation
Example: "UserUpdatedProfile" (1 event)
NOT: "FirstNameChanged", "LastNameChanged", ... (N events)
```

### 3. Split When Possible
```
 AllOrders (growing unbounded)
 Order (per order)
 OrderLine (per line item)

 UserAccount (everything about user)
 UserProfile (personal info)
 UserPreferences (settings)
 UserSessions (login history)
```

### 4. Archive Old Data
```
 Keep everything in active aggregate
 Move completed/closed data to archive aggregate
Example:
  - ActiveSubscription (current state)
  - ArchivedSubscription (after cancelled)
```

### 5. Measure Before Optimizing
```
 Assume snapshotting is needed
 Measure replay latency first
 Only snapshot if measurement justifies it
```
