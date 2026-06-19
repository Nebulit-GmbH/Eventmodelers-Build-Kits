---
name: eventmodeling-identifying-outputs
description: "Step 5 of Event Modeling - Identify Outputs/Read Models from events. Show what data flows back to UI and Processors. Use after defining inputs. Do not use for: identifying commands or inputs (use eventmodeling-identifying-inputs) or verifying field completeness (use eventmodeling-checking-completeness)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Identifying Outputs

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has clearly identified: read model queries needed by UI, processor needs, and refresh patterns. Interview when unclear which data queries are critical or how frequently they're accessed.

**Interview Strategy**: Establish query patterns and identify any calculations before designing read models. The most common architecture error at this step is modeling recalculated state as an event — identifying calculated fields upfront prevents that anti-pattern.

### Critical Questions

1. **Query Patterns** (Impact: Determines which read models are needed and their update frequency)
   - Question: "What data do users/processors need to query? (A) Real-time (sub-second), (B) Near-real-time (seconds), (C) Periodic (minutes/hours)?"
   - Why it matters: Query frequency drives read model design and caching strategy
   - Follow-up triggers: If (A) → ask which specific screens or processors require sub-second reads; these need dedicated, highly optimized read models

2. **Event vs Read Model Clarification** (Impact: Ensures we don't model calculations as events)
   - Question: "Are there calculated/aggregated fields? (e.g., average rating, total sales, inventory count) - These are read models, not events."
   - Why it matters: Common mistake to model calculations as events; identifying them upfront prevents architecture errors
   - Follow-up triggers: For each calculated field mentioned → confirm "This recalculates as source data changes, so it belongs in a read model projection — does that match your expectation?"

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - UI screens with data needs mapped to event sources
  - AND processor query needs documented
  - AND calculated/aggregated fields identified as read models (not events)

Then: Skip interview, proceed directly to read model design

Else: Conduct interview
```

**Phase 1: Query Pattern Mapping** (Question 1)
- Identify which UI screens and processors need which data
- Typically every screen needs some kind of data, same for automations.
- Establish freshness requirements per consumer
- Determine if any queries require real-time consistency

**Phase 2: Calculation Detection** (Question 2)
- Surface any aggregated or computed values
- Confirm they are projections, not events
- Prevent the calculation-as-event anti-pattern before design begins

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## 5. Identifying Outputs (eventmodeling-identifying-outputs)

### Query Patterns
[From Q1: Which consumers need what freshness? Real-time vs. periodic?]

### Calculated Fields Identified
[From Q2: Which fields are aggregated/calculated? Confirmed as read models?]

### Read Model Summary
- Real-time read models: [list]
- Near-real-time read models: [list]
- Calculation-as-event anti-patterns caught: [list or "None"]
```

Update Interview Trail:
```markdown
| 5 | eventmodeling-identifying-outputs | Done | Read model catalog, query patterns, calculation classification |
```

---

## CRITICAL: Events vs Read Models

**This is the most important distinction in event sourcing.** Many architectures fail because this line gets blurred.

### Events = Immutable Domain Facts
Things that actually happened in the domain. Once created, they never change:
- CustomerCreated (a customer actually signed up)
- OrderPlaced (someone actually placed an order)
- PaymentAuthorized (payment gateway actually authorized)
- OrderShipped (fulfillment actually shipped the order)

**Characteristics**:
- Represents an action someone took
- Immutable once recorded
- Can be replayed to rebuild state
- Provides audit trail
- Independent of other events

### Read Models = Derived Projections
Optimized views calculated FROM events. They recalculate multiple times:
- CustomerDashboard (projects current customer data)
- OrderStatusView (projects order state)
- InventoryLevelView (projects available stock from receipt/sale events)
- InventoryLevel (projects available stock)

**Characteristics**:
- Calculated/aggregated state
- Recalculates when source events change
- Derived from other events
- Query optimization
- Can be regenerated from events

### The Test: Is It an Event or Read Model?

Ask these questions in order:

| Question | Answer | Type | Example |
|----------|--------|------|---------|
| Did an actor perform an action? | YES | EVENT | Customer confirmed the order |
| Is this pure calculation? | YES | READ MODEL | Inventory level total |
| Is it immutable once created? | YES | EVENT | PaymentAuthorized |
| Does it recalculate multiple times? | YES | READ MODEL | Total sales (updates as orders change) |
| Is it independent (causes no other events)? | YES | EVENT | OrderFlagged (flagged for manual review) |
| Is it derived FROM other events? | YES | READ MODEL | OrderStatus (derived from multiple events) |

### Common Anti-Patterns 

**DON'T model these as EVENTS**:
- Inventory level totals (calculation from stock events)
- Inventory totals (sum of transactions)
- Account balances (calculation from transactions)
- Search indexes (derived from documents)
- Aggregated metrics (sums, counts, averages)
- Scheduled calculations (processor outputs that are pure calculation)

**DO model them as READ MODELS**:

 WRONG: Modeling as Event
```
InventoryLevelRecalculated
  productId: product-456
  currentStock: 84          (This recalculates!)
  reservedStock: 12         (Derived, not a fact)
```

 CORRECT: Model as Read Model
```
InventoryLevelView
  productId: product-456
  totalReceived: 200
  totalSold: 116
  currentStock: 84
  lastUpdated: 2025-01-24T10:30:00Z
  history:
    - 2024-12-01: stock 150 (200 received)
    - 2024-12-15: stock 110 (40 sold)
    - 2025-01-24: stock 84 (26 sold)
```

**WHY**:
- Events should capture facts (what happened)
- Calculations should be projections (how we view the facts)
- Otherwise you end up with circular dependencies and replay issues

---

## Workflow

Given commands and events, identify all outputs:

### 1. Map Event Data to UI Screens
For each screen, identify source events:

```
Screen: Order Status View
Displays data from events:
  orderId ← OrderCreated event
  customerId ← OrderCreated event
  items ← OrderCreated event
  total ← OrderCreated event
  status ← OrderConfirmed event (or OrderCancelled)
  confirmedAt ← OrderConfirmed event
  paymentId ← PaymentAuthorized event
  shipmentId ← OrderShipped event
  shippedAt ← OrderShipped event

This screen is a projection of these events:
  - OrderCreated
  - OrderConfirmed
  - PaymentAuthorized
  - OrderShipped
```

### 2. Define Read Models
Create optimized views from event data:

```
ReadModel: OrderStatusView
Purpose: UI displays current order status
Events subscribed: OrderCreated, OrderConfirmed, PaymentAuthorized, OrderShipped, OrderCancelled
Data:
{
  orderId: string (from OrderCreated)
  customerId: string (from OrderCreated)
  status: enum (from events: Draft → Confirmed → Authorized → Shipped → Delivered)
  createdAt: Date (from OrderCreated)
  confirmedAt: Date (from OrderConfirmed)
  paymentId: string (from PaymentAuthorized)
  shipmentId: string (from OrderShipped)
  shippedAt: Date (from OrderShipped)
}
```

### 3. Document Event → Data Mapping
Show exactly what data each event provides:

```
Event: OrderCreated
Provides to UI/Processors:
  orderId
  customerId
  items[]
  total
  shippingAddress
  createdAt

Event: OrderConfirmed
Provides to UI/Processors:
  orderId (link to stream)
  paymentMethod (user selected method)
  confirmedAt (timestamp)
  paymentId (payment system reference)

Event: PaymentAuthorized
Provides to UI/Processors:
  orderId (link to stream)
  paymentId
  authCode
  authorizedAt (timestamp)
  amount (verified amount)

Event: OrderShipped
Provides to UI/Processors:
  orderId (link to stream)
  shipmentId
  shippedAt (timestamp)
  carrier (shipping company)
  trackingNumber (for delivery tracking)
```

### 4. Create Output Catalog
List all read models:

```
ReadModel Catalog: Order System

1. OrderStatusReadModel
   Purpose: UI shows current order status
   Events: OrderCreated, OrderConfirmed, PaymentAuthorized, OrderShipped, OrderCancelled
   Data: orderId, status, createdAt, confirmedAt, paymentId, shipmentId
   Consumed by:
     - Order Status screen (UI)
     - Customer Dashboard (UI)
     - Order Processing Processor (decides if can ship)

2. OrderListReadModel
   Purpose: UI lists all orders for a customer
   Events: OrderCreated, OrderConfirmed, OrderCancelled
   Data: orderId, customerId, total, status, createdAt
   Consumed by:
     - Customer Order History (UI)
     - Order Search/Filter (UI)

3. PaymentStatusReadModel
   Purpose: UI shows payment status
   Events: OrderConfirmed, PaymentAuthorized, PaymentFailed
   Data: orderId, paymentId, status, authCode, failureReason, timestamp
   Consumed by:
     - Payment Status screen (UI)
     - Accounting Processor (reconciliation)

4. ShipmentTrackingReadModel
   Purpose: UI shows tracking information
   Events: OrderShipped, DeliveryConfirmed
   Data: orderId, shipmentId, trackingNumber, carrier, shippedAt, estimatedDelivery
   Consumed by:
     - Order Tracking screen (UI)
     - Customer notifications (Processor)
```

### 5. Identify Missing Data
Check if all UI needs are covered:

```
Question: What if UI needs "estimated delivery date"?
Event: OrderShipped has carrier + trackingNumber
Action needed: Add estimatedDelivery to OrderShipped event
  (or compute from carrier info)

Question: What if UI needs to show "payment method" on status?
Event: OrderConfirmed has paymentMethod
Action needed: Include paymentMethod in relevant read models

Question: What if UI needs "item descriptions"?
Event: OrderCreated has items[]
But: items[] only has productId
Action needed: Enrich with product descriptions from catalog
  (via join with product service)
```

### 6. Processor Outputs
Identify what processors consume:

```
Processor: Inventory System
Consumes from read models:
  - Orders in "PaymentAuthorized" status
  - Items and quantities needed
Produces commands:
  - ReserveInventory

Processor: Fulfillment System
Consumes from read models:
  - Orders in "InventoryReserved" status
  - Items and quantities
  - Shipping address
Produces commands:
  - CreateShipment

Processor: Notification System
Consumes from read models:
  - OrderCreated (sends confirmation)
  - OrderConfirmed (sends receipt)
  - OrderShipped (sends tracking)
  - DeliveryConfirmed (sends thank you)
Does not produce commands (info-only)
```

## Output Format

Instead of writing a markdown document, **place each READMODEL (and any missing AUTOMATION) on the board** using the `node:created` API. Screens are typically already placed from Step 3 (storyboarding) — do not re-place them unless one is clearly missing. Automations are placed here when analysis reveals a processor that reads state and issues commands but is not yet on the board.

> **CRITICAL: Every READMODEL node MUST include `meta.fields` with a `mapping` on every field.** A read model without fields — or with fields that lack `mapping` — has no data lineage and cannot be traced back to its source events.

### The typical slice pattern

The standard pattern for a screen in an event model is:

```
READ MODEL → SCREEN → COMMAND → EVENT
```

**Most screens need a read model on their left** — not only view/status screens, but also command/input screens that show current state before the user acts (e.g., a booking form that displays a bike's current availability, a checkout screen that shows the cart). The read model feeds the screen; the screen triggers a command; the command produces an event.

Pure view screens (no outgoing command) follow a shorter pattern:
```
READ MODEL → SCREEN
```

Automations follow:
```
READ MODEL → AUTOMATION → COMMAND → EVENT
```

Treat any screen or automation without an incoming read model as a gap unless it provably needs no prior state at all (e.g., a blank registration form).

### Read models serve existing screens and automations

**Before designing any read model, enumerate every SCREEN and AUTOMATION already placed on the board** (from Step 3 — Storyboarding). Read models exist to serve those elements:

- Every **view screen** (output/read model screen) needs at least one read model to supply its data.
- Every **automation** that makes a decision based on system state needs at least one read model to read from.
- Every **command/input screen** needs a read model unless it is a blank creation form with no prior state to display (this is the rare exception, not the rule).

After the step is done, **every SCREEN and every AUTOMATION on the board must be connected to at least one read model** via a `READMODEL → SCREEN` or `READMODEL → AUTOMATION` connection. If a screen or automation has no incoming read model connection, it is a gap — either a read model is missing or the connection arrow is missing.

> **Placement rule**: A read model must be placed in a column that already contains a SCREEN or AUTOMATION it serves. Do not place read models in columns with no screen or automation — doing so creates orphaned read models that will never have a consumer.

### Field data lineage — the `mapping` attribute on READMODEL fields

Every field on a READMODEL must carry a `mapping` that says exactly which event (or command) field it is projected from. Use one of these forms:

| `mapping` format | Meaning | `generated` | Example |
|---|---|---|---|
| `"<EventTitle>.<fieldName>"` | Projected directly from an event field | `false` | `"BikeReserved.customerId"` |
| `"latest:<EventTitle>.<fieldName>"` | Latest value from the most recent event of this type | `false` | `"latest:BikeStatusChanged.toStatus"` |
| `"aggregate:<EventTitle>.<fieldName>"` | Aggregated across multiple events of this type | `true` | `"aggregate:RentalEnded.durationMinutes"` |
| `"derived:<expression>"` | Calculated from other read model fields | `true` | `"derived:sum(lineItems.amount)"` |

Set the field's `generated` property according to this table. Fields projected directly from events are not generated — they carry a real domain value. Fields that are aggregated or calculated by the system are generated.

**Field traceability rule**: Every field in a read model must trace back to at least one source event. If a field cannot be mapped to any event in the timeline, it is either:
- A calculated/derived field — document the derivation expression, or
- A missing event field — add it to the source event before proceeding.

> **Connected-element rule**: A read model's field `mapping` may only reference EVENTs that are connected to this READMODEL via a board `EVENT → READMODEL` arrow. If a field needs data from an event that is not connected, either add the connection or flag it as a gap. **If a mapping cannot be defined for a field, it signals missing data in the model, a missing event, or a modeling error.** Do not leave unmapped fields without a note.

```json
{
  "type": "READMODEL",
  "title": "ActiveReservationView",
  "fields": [
    {"name": "reservationId",  "type": "String",  "example": "res-001",               "mapping": "BikeReserved.reservationId",          "generated": false},
    {"name": "customerId",     "type": "String",  "example": "cust-42",               "mapping": "BikeReserved.customerId",              "generated": false},
    {"name": "bikeId",         "type": "String",  "example": "bike-17",               "mapping": "BikeReserved.bikeId",                  "generated": false},
    {"name": "stationId",      "type": "String",  "example": "stn-03",                "mapping": "BikeReserved.stationId",               "generated": false},
    {"name": "expiresAt",      "type": "Date",    "example": "2026-06-01T09:30:00Z",  "mapping": "ReservationConfirmed.expiresAt",       "generated": false},
    {"name": "status",         "type": "String",  "example": "confirmed",             "mapping": "latest:ReservationConfirmed.status",   "generated": false}
  ]
}
```

Read models go in the `interaction` lane — **in the same column as the SCREEN or AUTOMATION they serve** (READMODEL in interaction row, SCREEN in actor row of the same column).

> **Timeline alignment rule**: Place the read model in the same column as its consumer screen/automation. If that column already holds a COMMAND (state-change slice occupies the interaction row), insert a new column immediately after (`{"index": N+1}`) and place both the READMODEL and any new SCREEN there. Do not append read model columns to the end of the timeline — doing so severs the visual left→right flow from data projection to UI consumption.

### Placing READMODEL and AUTOMATION nodes with `cellId` (Mandatory)

**Every `node:created` call MUST include `cellId`.** Without it the node has no cell reference and will appear stranded at position 0,0 — not in any timeline column.

**For a READMODEL** (interaction lane):

1. Find the column where the consumer SCREEN or AUTOMATION lives. Fetch the timeline to get the interaction row ID:
   ```bash
   curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
     "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
   # → timelineData.rows — find the row where type === "interaction"
   ```
2. Check if the interaction cell is already occupied (existing COMMAND):
   ```bash
   curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<interactionRowId>-<columnId>" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
   ```
   If a COMMAND occupies that cell, insert a new column immediately after (`{"index": currentIndex + 1}`) and use that column's ID instead.
3. `cellId = interactionRow.id + "-" + columnId`
4. Create the READMODEL:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '[{
       "id": "<event-uuid>",
       "eventType": "node:created",
       "nodeId": "<node-uuid>",
       "boardId": "<BOARD_ID>",
       "timestamp": 1234567890,
       "chapterId": "<CHAPTER_ID>",
       "cellId": "<interactionRowId>-<columnId>",
       "meta": {"type": "READMODEL", "title": "ActiveReservationView", "fields": [...]}
     }]'
   ```

**For an AUTOMATION** (actor lane, same column as its READMODEL):

1. Get the actor row ID from the same timeline fetch (row where `type === "actor"`).
2. `cellId = actorRow.id + "-" + columnId`
3. Create the AUTOMATION node using the same `node:created` pattern above with `"type": "AUTOMATION"` in `meta`.

> **Never call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first. `node:created + cellId` is the only placement step needed.

### Preventing backward arrows (mandatory pre-placement check)

The timeline must always progress left-to-right. A `READMODEL → SCREEN` connection going right-to-left is a layout error.

The correct layout is: **READMODEL in column N, SCREEN in column N+1** (the screen is always one column to the right of its read model). Before placing each read model, find the view screen it serves and verify the column order:

```
For each view screen S that queries this read model:
  If column(S) <= intended column(READMODEL):
    → The screen is not to the right of the read model. Fix before placing.
    Option A: Insert a new column immediately after the read model's column
              and move screen S there.
    Use POST /timelines/:tl/columns {"index": N} to insert,
    then node:changed to update the screen node's cell.
  If column(S) == intended column(READMODEL) + 1:
    → Screen is already in the correct column directly to the right. No adjustment needed.
  If column(S) > intended column(READMODEL) + 1:
    → Gap between read model and screen. Move the read model to column(S) - 1, or move the screen to column(READMODEL) + 1.
```

**View screens go in the column immediately to the right of the read model they display** — either because they were placed there in Step 3, or because you move them here now.

### Wire connections after placing each READMODEL (and its SCREEN)

After `place-element` returns the READMODEL node ID, create the arrows that complete the slice:

1. **EVENT → READMODEL** — find the primary source EVENT node in the swimlane row of the same column:
   ```bash
   curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<swimlaneRowId>-<columnId>" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs"
   ```
   Connect it:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<eventNodeId>","target":"<readmodelNodeId>"}'
   ```

2. **READMODEL → SCREEN** — connect to the existing SCREEN node in the actor row of the next column (screens are typically already placed from Step 3):
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<readmodelNodeId>","target":"<screenNodeId>"}'
   ```

3. **READMODEL → AUTOMATION** — if the read model is consumed by an automatic process (scheduler, background job, external trigger), place the AUTOMATION node and connect it:
   - Place the AUTOMATION in the automation lane, in the column immediately to the right of its read model (same rule as screens).
   - Then connect:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<readmodelNodeId>","target":"<automationNodeId>"}'
   ```

Skip a connection silently if the target cell is empty. Log each created arrow: `→ connected EVENT→READMODEL "OrderPlaced"→"OrderStatusView"`, `→ connected READMODEL→SCREEN "OrderStatusView"→"Order Status Screen"`, or `→ connected READMODEL→AUTOMATION "OrderStatusView"→"Fulfillment Processor"`.

After all read models, screens, automations, and connections are in place, present the Read Model Catalog summary as text to the user.

---

For reference, the full markdown structure is:

```markdown
# Outputs: [Domain Name]

## Read Models Summary

| ReadModel | Purpose | Events | Consumed By |
|-----------|---------|--------|-------------|
| OrderStatus | Show order state | OrderCreated, OrderConfirmed | UI, Processor |
| OrderList | List orders | OrderCreated, OrderCancelled | UI |
| PaymentStatus | Payment info | OrderConfirmed, PaymentAuthorized | UI, Accounting |
| Shipment Tracking | Track delivery | OrderShipped, DeliveryConfirmed | UI, Notifications |

---

## Detailed Read Models

### ReadModel: OrderStatusView

**Purpose**: Order Status screen displays current order state

**Events subscribed**:
- OrderCreated
- OrderConfirmed
- PaymentAuthorized
- OrderShipped
- OrderCancelled
- DeliveryConfirmed

**Data**:
```
{
  orderId: string
  customerId: string
  status: 'Draft' | 'Confirmed' | 'Authorized' | 'Shipped' | 'Delivered' | 'Cancelled'
  items: Array<{productId, quantity, unitPrice}>
  total: number
  shippingAddress: Address

  createdAt: Date
  confirmedAt: Date
  paymentId: string
  paymentMethod: 'card' | 'transfer'
  authorizedAt: Date

  shipmentId: string
  carrier: string
  trackingNumber: string
  shippedAt: Date
  estimatedDelivery: Date
}
```

**Update Logic**:
- OrderCreated: Insert with status='Draft'
- OrderConfirmed: Update status='Confirmed'
- PaymentAuthorized: Update status='Authorized', set paymentId
- OrderShipped: Update status='Shipped', set shipmentId, carrier, trackingNumber
- DeliveryConfirmed: Update status='Delivered'
- OrderCancelled: Update status='Cancelled'

**Consumed By**:
- Order Status Screen (displays)
- Order Processing Processor (checks status)
- Notification System (sends updates)

--- [Repeat for each read model]

---

## Data Completeness Check

### Events → UI Needs

Verify all UI needs have event sources:

| UI Need | Event Source | Status |
|---------|-------------|--------|
| Order status | OrderConfirmed, OrderShipped |  |
| Tracking number | OrderShipped |  |
| Order items | OrderCreated |  |
| Estimated delivery | OrderShipped |  |
| Cancellation reason | OrderCancelled |  |

### Missing Data

Identify UI needs without event sources:
- None identified 

---

## Processor Consumption

### Processors and their reads:

| Processor | Reads From | Writes Commands |
|-----------|-----------|-----------------|
| Inventory | OrderStatusView (Authorized) | ReserveInventory |
| Fulfillment | OrderStatusView (InventoryReserved) | CreateShipment |
| Notification | OrderStatusView (all) | None (info-only) |
| Accounting | PaymentStatusView | None (reporting) |
```

## Quality Checklist

### Read Model Design
- [ ] **Typical pattern applied**: most screens follow `READ MODEL → SCREEN → COMMAND → EVENT`
- [ ] **Every SCREEN from storyboarding is connected to at least one read model** (via `READMODEL → SCREEN`); only blank creation forms may be exempt
- [ ] **Every AUTOMATION from storyboarding is connected to at least one read model** (via `READMODEL → AUTOMATION`)
- [ ] **No read model is placed without a connected SCREEN or AUTOMATION consumer**
- [ ] Every read model has clear purpose
- [ ] Every data field has event source
- [ ] Update logic for each event is explicit
- [ ] All UI needs are covered
- [ ] Processor reads are identified
- [ ] Read model access patterns clear
- [ ] No undocumented data sources
- [ ] Compensation/cancellation handled
- [ ] Error states shown

### CRITICAL: Event vs Read Model Validation
- [ ] **Reviewed each read model**: "Is this pure calculation or an actual domain fact?"
- [ ] **No aggregations modeled as events**: (totals, averages, counts are read models)
- [ ] **No recalculated state modeled as events**: (if value changes multiple times, it's a read model)
- [ ] **Processor outputs are categorized**:
  - [ ] Produces NEW EVENT = actual domain fact (e.g., PaymentAuthorized)
  - [ ] Updates READ MODEL = calculation (e.g., SellerRatingCalculated)
  - [ ] Sends NOTIFICATION = info-only (no event or model)
- [ ] **History tracking is clear**: Derived state keeps history in read model `history[]`, not as separate events

## Key Principles

1. **Event-Driven**: All data comes from events
2. **Projection-Based**: Read models are projections, not persistent
3. **UI-Focused**: Optimized for UI display needs
4. **Processor-Friendly**: Enough data for processor decisions
5. **Completeness**: All needed data available

## Common Patterns

### Status View Pattern
```
Events: Create, Confirm, Process, Ship
ReadModel: Accumulates data from all events
Displayed: Current state reflecting all events
```

### List View Pattern
```
Events: Create, Update, Delete (Cancel)
ReadModel: Summary of each item
Used for: Filtering, sorting, searching
```

### Timeline View Pattern
```
Events: Any event with timestamp
ReadModel: Chronological list
Used for: History, audit trail
```

### Processor Decision Pattern
```
Events: State-changing events
ReadModel: Current state only
Processor reads to decide next action
```
