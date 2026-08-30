---
name: eventmodeling-identifying-outputs
description: "Step 5 of Event Modeling - Identify Outputs/Read Models from events. Show what data flows back to UI and Processors. Use after defining inputs. Do not use for: identifying commands or inputs (use eventmodeling-identifying-inputs) or verifying field completeness (use eventmodeling-checking-completeness)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Identifying Outputs

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

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

Instead of writing a markdown document, **place each READMODEL (and any missing AUTOMATION) on the board** using the `node:created` API. Screens are typically already placed from Step 3 (storyboarding) as one plain screen per screen state — Step 3 does not pre-split anything, so working out how many components a screen actually has is this step's job (Step 5a below), not something to re-derive from storyboarding's output. Do not re-place an existing screen unless one is clearly missing. Automations are placed here only in the rare case where analysis reveals a processor that reads state and issues commands but was missed entirely in Step 4 — if that happens, immediately apply `eventmodeling-designing-automation-chains`'s rules to it (todo-list read model, translation chain if externally triggered) before continuing, rather than leaving it for Step 5i's defensive re-check to catch.

This step proceeds as a sequence of lettered sub-steps: identify each screen's components (5a), break multi-component screens apart into copies (5c), then design and place one read model per component (5d onward). Every automation's todo-list read model and any translation chain is designed in **Step 4b** (`eventmodeling-designing-automation-chains`), immediately after Step 4 — not here. This step only ever designs screen-facing read models; Step 5i below re-checks automations defensively, not as this step's primary job.

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

Treat any screen or automation without an incoming read model as a gap. A screen may be exempt if it provably needs no prior state at all (e.g., a blank registration form) — an **automation is never exempt**: every automation gets a todo-list read model, even a trivial one that opens and closes within the same slice. For automations, that read model was already designed in **Step 4b** (`eventmodeling-designing-automation-chains`); this step's job is limited to the defensive re-check in Step 5i below.

### Step 5a — Enumerate consumers and identify components

**Before designing any read model, enumerate every SCREEN and AUTOMATION already placed on the board** (from Step 3 — Storyboarding). Storyboarding hands off one plain screen per screen state and does not pre-split anything — deciding how many components a screen actually has is this step's decision, because a component is defined by its read model: **one component in a screen resembles one read model.**

Read models exist to serve the elements already on the board:
- Every **view screen** (output/read model screen) needs at least one read model to supply its data.
- Every **automation** needs at least one read model to read from — its todo list. This applies to every automation without exception, not only ones that visibly "decide" something; this was already handled in Step 4b (`eventmodeling-designing-automation-chains`) for every automation placed in Step 4.
- Every **command/input screen** needs a read model unless it is a blank creation form with no prior state to display (this is the rare exception, not the rule).

For each SCREEN node, look at its rendered layout and its `meta.fields` and identify its components — groups of fields/UI elements a user would perceive as one area: a stats tile, a list below it, a summary card, a detail panel, a status column in a table, etc. **Most screens genuinely have exactly one component — do not force a split.** A screen has more than one component only when a user would point at two separate areas and describe them as different things.

A single homogeneous list/table is still one component, even when its rows draw on many different event types (e.g. a catalog whose per-row status is set by many different lifecycle events scattered across the timeline) — don't split a table by row or by source event. **But do not use this as a reason to also fold in other fields that don't share that same wide fan-in.** A book's title/author (set by 1-2 events, updated rarely) and a copy's live availability status (derived across its full lifecycle, many events) are two different kinds of computation even when they render on the same visible page — a user pointing at "the book's info" versus "whether it's available right now" is describing two different things, whatever the layout looks like. If a candidate component mixes a field with irreducible wide fan-in and a field that only needs 1-2 events, that is **always** two components — split it now, at this step, before any read model is built from it, rather than discovering the mismatch after the fact.

Once a component's fields are genuinely homogeneous (every field needs the same wide-lifecycle fan-in, none of them are cheap identity/fact fields riding along), its read model will legitimately need wide fan-in. This is expected, not a modeling error — document it with a MARKDOWN note (per the orchestrating skill's "Documenting decisions inline, at any step") naming *which field(s)* have that irreducible fan-in and why, e.g. "CopyAvailabilityView.copyStatus is one per-copy status derived across that copy's full lifecycle (repair, loss, reservation, return)." That note documents a specific field's fan-in, not a blanket exemption for the node — re-verify every field on the node against the ">3-events heuristic" (`eventmodeling-orchestrating-event-modeling`) at every later step that touches it, including Step 5i's mandatory per-node verification below, rather than treating a prior note as settled once and for all.

After this step is done, **every SCREEN and every AUTOMATION on the board must be connected to at least one read model** via a `READMODEL → SCREEN` or `READMODEL → AUTOMATION` connection, and every screen identified above as having 2+ components must have been broken apart per Step 5c before any read model is placed. If a screen or automation has no incoming read model connection, it is a gap — either a read model is missing or the connection arrow is missing.

> **Placement rule**: A read model must be placed immediately upstream of the SCREEN or AUTOMATION it serves — sharing that column when possible (a SCREEN with a free interaction row), or one column to the left when not (any AUTOMATION; a SCREEN whose column is already occupied). Do not place a read model with no screen or automation in the very next column — doing so creates an orphaned read model that will never have a consumer.

> **Automation todo-list read models are designed in Step 4b, not here.** The full pattern — every automation's todo-list read model, the "no invisible signal" rule, and the two-chained-automation translation requirement for externally-triggered automations — now lives in `eventmodeling-designing-automation-chains` (Step 4b), which runs immediately after Step 4, before this step. If Step 4b ran, every automation already on the board has its todo-list read model wired; Step 5i below only re-checks this defensively. The rare exception is an automation discovered only now, during output analysis (see "Output Format" above) — if that happens, apply `eventmodeling-designing-automation-chains`'s rules to it directly rather than re-deriving them here.

### Step 5c — Break apart multi-component screens into copies

**Do not default to a single monolithic read model that supplies an entire screen.** For every screen identified in Step 5a as having 2+ components, break it apart into one screen copy per component before designing its read models:

- Each copy is the **same page**, so it **keeps the same screen name/title** — do not rename copies after their component (e.g. don't title one copy `"Librarian Dashboard — Statistics"` and another `"Librarian Dashboard — Recently Added"`; both stay `"Librarian Dashboard"`).
- Distinguish copies visually, not by name: **mark/highlight the one component each copy is about**, using the `html-screen` skill's native Marks feature — see that skill's "Marks" section for the full mechanism. In short: the component of interest gets `data-em-mark-id`/`em-mark em-mark-<colorhex>` baked onto it in the page HTML, paired with a matching `meta.marks` entry (`{id, color, pageIndex, blurOutside: true}`) that blurs every other top-level section. Never hand-roll this with inline `filter`/`outline`/`opacity` CSS — that does not match how the app itself renders a mark.
- Use the `html-screen` skill to produce each copy: pass it the original screen's markup, explicitly asking it to mark/highlight the one component to keep crisp and blur the rest (this satisfies `html-screen`'s "only when the user explicitly asks for one" condition for its Marks feature — the ask comes from this step). This is the skill's job — don't hand-roll the markup here.
- Place each copy in its own column, the **same column** as the read model that will feed it (insert a new column immediately before if that copy's column is already occupied) — this is normally a different column per copy, since each component typically has a different natural source event.

Why this matters, beyond tidiness:
- **It prevents backward arrows.** A single screen-wide read model is forced to aggregate from whatever events each of its components needs, which often means reaching back across many columns to events scattered throughout the timeline — and the read model can only sit in one column, so some of those connections end up spanning a wide gap or, worse, pushing the read model's column later than some of its screen's other consumers require. Splitting by component lets each narrower read model sit close to its own natural source event(s), keeping every `EVENT → READMODEL` arrow short and forward.
- **Components evolve independently.** A stats tile and a "recently added" list are driven by different events, change at different rates, and are typically owned by different slices in implementation. Bundling them into one read model couples their release/change cadence for no reason.

Before finalizing any read model, ask: "does this screen contain more than one component?" If yes and it wasn't already broken apart, do it now — don't ask whether it's worth the extra columns, it always is at this scale, since the alternative is a hidden coupling and a higher chance of a backward-arrow layout error.

### Step 5d — Pull field mappings from Step 3 — they are the spec, not a guess

**Do not re-derive read model needs from a screen's title or description alone, and do not rely on the orchestrator's phase-summary handoff for this** — if you arrived here via `eventmodeling-orchestrating-event-modeling`, the handoff after Step 3 is a short hand-written prose summary (`.trogonai/interviews/.../EVENTMODELING.md`), not the actual field data. It will not reliably carry the per-field mappings forward. Go back to the board itself:

For every SCREEN node, fetch it directly (`get_node`/`get_nodes`, never from memory) and read its `meta.fields`. Step 3 already required every field to carry a `mapping`, and for view fields that mapping is already in the exact form `"<ReadModelTitle>.<fieldName>"` — recorded specifically so this step doesn't have to re-guess it.

- **Group the screen's fields by the `<ReadModelTitle>` already named in their `mapping`.** That grouping — not a fresh read of the screen's visuals — is the read model's title and field list. Build the READMODEL node from it directly.
- If a field's `mapping` names a read model that isn't `"<CommandTitle>.<fieldName>"` or `"session:..."` or `"derived:..."`, it is a read-model reference — treat it as a requirement, not a suggestion.
- A screen with no fields, or with fields that carry no read-model-shaped mapping, is **not** evidence that it needs no read model. Re-check it against the three rules above (view screen / automation / command screen showing prior state) before concluding it's the rare blank-form exception — and say explicitly why it qualifies.

### Step 5e — Field data lineage — the `mapping` attribute on READMODEL fields

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

Every field must also set `"cardinality"` — use `"Single"` unless the field genuinely holds a list of values (e.g. line items, a collection projected from multiple events), in which case use `"List"`. Default to `"Single"` when unsure. Include only the fields the consuming SCREEN or AUTOMATION actually displays or needs — do not add speculative fields; enrich later via `/attributes`.

```json
{
  "type": "READMODEL",
  "title": "ActiveReservationView",
  "fields": [
    {"name": "reservationId",  "type": "String",   "example": "res-001",               "mapping": "BikeReserved.reservationId",          "generated": false},
    {"name": "customerId",     "type": "String",   "example": "cust-42",               "mapping": "BikeReserved.customerId",              "generated": false},
    {"name": "bikeId",         "type": "String",   "example": "bike-17",               "mapping": "BikeReserved.bikeId",                  "generated": false},
    {"name": "stationId",      "type": "String",   "example": "stn-03",                "mapping": "BikeReserved.stationId",               "generated": false},
    {"name": "expiresAt",      "type": "DateTime", "example": "2026-06-01T09:30:00Z",  "mapping": "ReservationConfirmed.expiresAt",       "generated": false},
    {"name": "status",         "type": "String",   "example": "confirmed",             "mapping": "latest:ReservationConfirmed.status",   "generated": false}
  ]
}
```

Read models go in the `interaction` lane. For a **SCREEN**, the primary read model shares the SCREEN's column (READMODEL in interaction row, SCREEN in actor row of the same column) — unless that column's interaction row is already occupied (e.g. a command/input screen, where the COMMAND already sits there), in which case the read model goes one column to the left instead. For an **AUTOMATION**, the read model always goes one column to the left, never the same column — an automation's own column already holds the COMMAND it issues. If a consumer needs more than one read model, only the primary one gets this placement; every additional read model goes further left still.

> **Timeline alignment rule**: Place the read model in the same column as its consumer screen when that column is free, or one column before its consumer (screen or automation) when it isn't. Insert the new column immediately **before** the consumer's column (`{"index": consumerColumnIndex}`, shifting the consumer right) rather than after — the read model must sit upstream of (to the left of) the element it feeds. Do not append read model columns to the end of the timeline — doing so severs the visual left→right flow from data projection to UI consumption.

### Step 5f — Placing READMODEL and AUTOMATION nodes with `cellId` (Mandatory)

**Every `node:created` call MUST include `cellId`.** Without it the node has no cell reference and will appear stranded at position 0,0 — not in any timeline column.

**For a READMODEL** (interaction lane):

**Prefer MCP** — `place_element` collapses finding/creating the empty interaction cell (including inserting a new column when the target column is already occupied by a COMMAND) and creating the node into one call. **Target column depends on the consumer type**:
- **SCREEN**: target the screen's own column index — `place_element` inserts a new column before it automatically if that column's interaction row is already occupied (e.g. a command/input screen).
- **AUTOMATION**: target `consumerColumnIndex - 1` (one column to the *left* of the automation) — never the automation's own column index, since it already holds the COMMAND the automation issues.
```
mcp__eventmodelers__place_element {
  "boardId": "<BOARD_ID>",
  "timelineId": "<CHAPTER_ID>",
  "elementType": "READMODEL",
  "title": "ActiveReservationView",
  "columnIndex": <consumerScreenColumnIndex>  // or <automationColumnIndex - 1> for an AUTOMATION consumer
}
```
Then set `meta.fields` (with `mapping`/`generated`/`cardinality`) on the returned node id:
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<returned-node-id>",
    "boardId": "<BOARD_ID>", "timestamp": 1234567890,
    "meta": {"type": "READMODEL", "title": "ActiveReservationView", "fields": [...]}
  }]
}
```
To determine the consumer's column index beforehand, or to check whether a specific interaction cell is already occupied (there is no `cellId` filter on `get_nodes` — see the note under "Wire connections" below), fetch the chapter and read its cell map — `projection: "cells"` returns just `{rows, columns, cells}`, not the whole chapter node:
```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
# → rows (find "interaction"/"actor" rows) and cells (sparse; absent id = empty)
```

**Fallback (no MCP)** — the full manual sequence:

1. Find the column where the consumer SCREEN or AUTOMATION lives. For an AUTOMATION, the read model's target column is always the one immediately **before** it (skip straight to inserting that column — its interaction row is guaranteed occupied by the automation's own COMMAND). For a SCREEN, target the screen's own column. Fetch the timeline to get the interaction row ID:
   ```bash
   curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
     "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
   # → timelineData.rows — find the row where type === "interaction"
   ```
2. Check if the target interaction cell is already occupied (existing COMMAND):
   ```bash
   curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<interactionRowId>-<columnId>" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID"
   ```
   If a COMMAND occupies that cell, insert a new column immediately **before** it (`{"index": currentIndex}` — this shifts the consumer's column, and everything after it, one to the right) and use that new column's ID instead. The read model must end up upstream of (to the left of) its consumer, never downstream of it.
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

**For an AUTOMATION** (actor lane) — its READMODEL always goes **one column to its left**, never the same column: the automation's own column already holds the COMMAND it issues (interaction row), so the read model can't also live there.

**Prefer MCP** — same `place_element` call with `"elementType": "AUTOMATION"`, then `submit_node_events` for fields, as above.

**Fallback (no MCP):**
1. Get the actor row ID from the same timeline fetch (row where `type === "actor"`).
2. `cellId = actorRow.id + "-" + columnId`
3. Create the AUTOMATION node using the same `node:created` pattern above with `"type": "AUTOMATION"` in `meta`.

> **Never call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first. `node:created + cellId` is the only placement step needed.

### Step 5g — Preventing backward arrows (mandatory pre-placement check)

The timeline must always progress left-to-right, or downward within the same column. A `READMODEL → SCREEN` connection going right-to-left is a layout error.

The correct layout is: **READMODEL and its (primary) view SCREEN share the same column** — READMODEL in the interaction row, SCREEN in the actor row, a downward connection. The read model only sits in a separate column, immediately **before** the screen's, when the screen's column is already unavailable to it (its interaction row is occupied by something else, e.g. a COMMAND on a command/input screen). If a screen displays more than one read model, only the primary read model shares the screen's column — every additional read model goes further left, never to the right. Before placing each read model, find the view screen it serves and verify the column order:

```
For each view screen S that queries this read model as its primary read model:
  If column(S)'s interaction row is free:
    → Place the READMODEL in column(S) itself (same column as S). No adjustment needed.
  If column(S)'s interaction row is already occupied:
    → Insert a new column immediately before column(S) and place the READMODEL there instead.
    mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<TL>", "beforeNodeId": "<S's node id>" }
    (fallback, no MCP: POST /timelines/:tl/columns {"index": N} with N computed by hand),
    then node:changed to update any node whose cell needs to move.
  If the read model ends up more than one column away from S with nothing in between:
    → Gap between read model and screen. Close it: move the read model into column(S) (if free) or column(S) - 1.
```

**View screens normally share the column of the (primary) read model they display** — either because they were placed there in Step 3, or because you move them here now. They only sit one column to the right of it when that shared column wasn't available.

**The same rule applies to `EVENT → READMODEL`.** If a later event needs to update data a read model already feeds to a SCREEN, do not connect that later event back into the existing read model — the platform only accepts an `EVENT → READMODEL` backward connection when the read model already has a `READMODEL → AUTOMATION` edge (the todo-list pattern from Step 4b, `eventmodeling-designing-automation-chains`). For any read model feeding a SCREEN, resolve the update the same way Step 5c resolves multi-component screens: place a **new copy of the read model** in (or immediately after) the later event's column, connect the later event forward into that copy, and place a matching copy of the same screen there — same title, updated data, optionally re-marked/highlighted via `html-screen`'s Marks feature. Never link the new copy back to the earlier read model instance.

### Step 5h — Wire connections after placing each READMODEL (and its SCREEN)

After `place-element` returns the READMODEL node ID, create the arrows that complete the slice:

1. **EVENT → READMODEL** — find the primary source EVENT node in the swimlane row of the same column.

   **Prefer MCP** — `get_nodes` has no `cellId` filter (only `type`); look up occupancy via the chapter's cell map instead (`projection: "cells"`), then connect with the type-checked edge tool (auto-corrects direction, skips duplicates):
   ```
   mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
   # → read cells["<swimlaneRowId>-<columnId>"] for the occupying node id
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<eventNodeId>", "target": "<readmodelNodeId>", "action": "connect" }
   ```

   **Fallback (no MCP):**
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

2. **READMODEL → SCREEN** — connect to the existing SCREEN node in the actor row of the same column (or the column immediately after, only when that column wasn't available to the read model — screens are typically already placed from Step 3).

   **Prefer MCP:**
   ```
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<readmodelNodeId>", "target": "<screenNodeId>", "action": "connect" }
   ```

   **Fallback (no MCP):**
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<readmodelNodeId>","target":"<screenNodeId>"}'
   ```

3. **READMODEL → AUTOMATION** — if the read model is consumed by an automatic process (scheduler, background job, external trigger), place the AUTOMATION node and connect it:
   - Place the AUTOMATION in the automation lane, in the column immediately to the right of its read model — unlike a view screen, this is unconditional for automations: the automation's own column always holds the COMMAND it issues, so its read model never shares that column.
   - Then connect:

   **Prefer MCP:**
   ```
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<readmodelNodeId>", "target": "<automationNodeId>", "action": "connect" }
   ```

   **Fallback (no MCP):**
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-outputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<readmodelNodeId>","target":"<automationNodeId>"}'
   ```

Skip a connection silently if the target cell is empty. Log each created arrow: `→ connected EVENT→READMODEL "OrderPlaced"→"OrderStatusView"`, `→ connected READMODEL→SCREEN "OrderStatusView"→"Order Status Screen"`, or `→ connected READMODEL→AUTOMATION "OrderStatusView"→"Fulfillment Processor"`.

If this step is processing more than one read model in the same pass, collect every connection resolved above (across all of them) into one `set_connections` call instead of one `set_connection` per pair — this was the single largest source of individual tool calls in this step.

4. **Document the reasoning for each connected event** — for every EVENT → READMODEL edge wired in step 1 (including any added later, e.g. via Step 5g's backward-connection exemption or a Step 5c/copy pattern), record why that event feeds this read model: which field(s) it sets or updates, and why. Use one MARKDOWN note per read model, in that read model's own column (same feedback-lane + MARKDOWN mechanics as `eventmodeling-orchestrating-event-modeling`'s "Documenting decisions inline, at any step" / Step 11 — add the chapter's feedback lane first if it doesn't already exist, then place the note at `cellId = "<feedbackLaneId>-<readModelColumnId>"`). Extend the existing note (don't create a second one) when the read model later gains another connected event.

   Example body:
   ```markdown
   ## Event → field reasoning — OrderStatusView

   - **OrderPlaced** → sets `orderId`, `status: "placed"`, `items[]` — the read model's creation event; the order doesn't exist before it.
   - **OrderShipped** → updates `status: "shipped"`, `trackingNumber` — the only event carrying a tracking number.
   - **OrderCancelled** → updates `status: "cancelled"` — terminal state, no further events expected after this.
   ```

### Step 5i — Mandatory per-node verification (run before declaring this step done)

Do not declare Step 5 complete on the strength of the read models you happened to design. Instead, **re-fetch every SCREEN and AUTOMATION node on the board** (`get_nodes` per type — don't rely on the list built earlier in this step, the board may have moved on) and check each one individually:

1. Does it now have an incoming `READMODEL → SCREEN` or `READMODEL → AUTOMATION` connection?
2. If it's a SCREEN and not connected — is it a provably blank creation form with no prior state? State the reason in one line (e.g. `"Register Account" screen: blank form, no prior state — exempt`). This exemption applies to screens only.
3. If it's an AUTOMATION and not connected, it is **never** exempt — this should already be resolved by Step 4b (`eventmodeling-designing-automation-chains`); if it isn't, apply that skill's rules now to identify its todo-list read model.
4. If a SCREEN is neither connected nor exempt, it is an **unresolved gap**. Fix it now: design the missing read model (pulling from its `meta.fields`/`mapping` as above) and wire the connection. Do not move to Step 6 with an unresolved gap silently carried forward — either fix it or explicitly flag it to the user as accepted debt.
5. Does any screen still carry more than one component undivided (a Step 5a/5c miss)? If so, break it apart now per Step 5c before counting it as resolved.
6. **Re-fetch every READMODEL too** and run the >3-events heuristic (`eventmodeling-orchestrating-event-modeling`) on each one field by field — including read models a MARKDOWN note already justified as a roll-up. A prior note documents one field's irreducible fan-in; it does not exempt the rest of that node's fields from this check. The failure mode this catches: a wide-fan-in field (e.g. live per-copy availability) bundled together with a cheap, low-fan-in identity/fact field (e.g. a title set by 1-2 events) that has nothing to do with the roll-up — that pairing is always two read models, never one, no matter how the note reads.
7. **Every READMODEL has its event-reasoning MARKDOWN note (Step 5h.4)**, and that note accounts for *every* inbound `EVENT → READMODEL` edge on the node — not just the one from when it was first placed. If a read model gained a connected event later and the note wasn't extended, fix it now rather than carrying the gap forward.

List the result of this pass (connected / exempt / fixed) for every screen and automation checked — this list is the evidence the orchestrator's Step 5 gate ("every screen data need is satisfied by a read model") actually holds, not just an assumption.

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
- [ ] **Every SCREEN from storyboarding is connected to at least one read model** (via `READMODEL → SCREEN`); only blank creation forms may be exempt — verified via the mandatory per-node pass above, not assumed
- [ ] **Every AUTOMATION from storyboarding is connected to at least one todo-list read model** (via `READMODEL → AUTOMATION`, Step 4b) — no exemption for automations, unlike screens; even a simple relay automation gets one
- [ ] **No automation's todo list is opened directly by another system's (second-swimlane) EVENT unless that automation is itself the translation automation** (Step 4b) — an automation doing the actual domain work is only ever opened by an internal event; a second-swimlane EVENT feeding straight into a work automation's todo list is a missing translation automation
- [ ] **No read model is placed without a connected SCREEN or AUTOMATION consumer**
- [ ] **No read model spans more than one component** — a screen with N distinct components gets N read models and N highlighted screen copies (same screen name, one component crisp per copy), not one screen-wide read model
- [ ] **Every multi-component screen was broken apart in Step 5c** — each copy keeps the original screen's name, differs only in which component is marked/highlighted
- [ ] **Every automation's todo-list read model identifies its opening and closing events** (Step 4b) — including the automation's own resulting event as a closing event where applicable, not just the triggering event
- [ ] **A field's genuinely irreducible wide fan-in is documented per-field** (inline MARKDOWN note, per "Documenting decisions inline") — and that note is never treated as clearing every other field on the same read model from the >3-events check; a cheap identity/fact field bundled alongside a wide roll-up field is always split out, never excused by the roll-up's own note
- [ ] **Every read model has an event-reasoning MARKDOWN note** (Step 5h.4) covering every connected event and which field(s) it sets or updates
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
