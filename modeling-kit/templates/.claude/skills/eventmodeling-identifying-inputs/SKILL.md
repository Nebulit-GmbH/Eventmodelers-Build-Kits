---
name: eventmodeling-identifying-inputs
description: "Step 4 of Event Modeling - Identify Commands/Inputs from UI and Processor actions. Map user actions to commands and data. Use after storyboarding UI. Do not use for: identifying read models or outputs (use eventmodeling-identifying-outputs) or elaborating behavior specifications (use eventmodeling-elaborating-scenarios)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Identifying Inputs

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already identified UI actions/commands and processor triggers. Interview when it's unclear which actions are user-initiated vs. processor-automated.

**Interview Strategy**: Separate UI-driven commands from processor-driven commands before cataloging inputs. Mixing them leads to incorrect role attribution, which breaks the Role Catalog traceability that downstream steps depend on.

### Critical Questions

1. **Automation Level** (Impact: Determines which commands are UI-triggered vs. processor-triggered)
   - Question: "Are there actions that should be: (A) User-initiated only, (B) Processor-automated, (C) Mix of both?"
   - Why it matters: Knowing automation vs. manual separates command types
   - Follow-up triggers: If (C) → ask "Which specific user actions trigger automation? What does the processor decide on its own?"

2. **External System Triggers** (Impact: Determines if there are processor commands from webhooks/integrations)
   - Question: "Will commands be triggered by: (A) UI only, (B) External webhooks (payments, notifications, etc.), (C) Scheduled processors, (D) All of above?"
   - Why it matters: External triggers are processor commands, not UI commands
   - Follow-up triggers: If (B) or (D) → ask which external systems send webhooks and what data they include

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - UI actions already listed per storyboard screen
  - AND processor triggers identified with source systems named
  - AND it's clear which role/actor initiates each action

Then: Skip interview, proceed directly to command identification

Else: Conduct interview
```

**Phase 1: Trigger Classification** (Question 1)
- Establish which commands come from human actors vs. automated processors
- Confirm Role Catalog from Step 1 is available for attribution

**Phase 2: External Triggers** (Question 2)
- Identify all external system integrations that issue commands
- Confirm whether scheduled jobs or event-driven processors exist

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## 4. Identifying Inputs (eventmodeling-identifying-inputs)

### Automation Classification
[From Q1: Which actions are user-initiated vs. processor-automated?]

### External System Triggers
[From Q2: Which external systems trigger commands? Webhook formats?]

### Command Attribution Summary
- UI-issued commands: [list with role from Role Catalog]
- Processor-issued commands: [list with source system]
```

Update Interview Trail:
```markdown
| 4 | eventmodeling-identifying-inputs | Done | UI commands, processor commands, role attribution |
```

---

## Workflow

Given UI storyboards and event timeline, identify all inputs.

**PREREQUISITE**: The **Role Catalog** from Step 1 (eventmodeling-brainstorming-events) must exist. Every command identified below MUST be attributed to a specific role or system actor from that catalog.

### 1. Extract Commands from UI Actions
For each user action in storyboard, create a command attributed to a specific role:

```
Storyboard: Order Creation Screen
User action: Click "Create Order" button
  ↓
Command: CreateOrder
Input data from form:
    - customerId
    - items[] (product selections + quantities)
    - shippingAddress
Validation:
    - customerId must exist
    - items must not be empty
    - quantities must be > 0
Produces event: OrderCreated
```

### 2. Identify Processor Triggers
Identify automation-triggered commands:

```
Processor trigger: Payment gateway webhook received
  ↓
Command: AuthorizePayment (from Processor, not UI)
Input data from webhook:
    - orderId
    - paymentId
    - authorizationCode
Validation:
    - orderId must exist and be in Confirmed state
    - authorizationCode must be valid
Produces event: PaymentAuthorized
```

### 2b. Understand the Processor "Todo List" Pattern
Processors don't directly process events—they maintain a todo list driven by events:

```
Event Stream (Domain events):
PaymentAuthorized → triggers Inventory system

Processor: InventoryReserver

Todo List:
When PaymentAuthorized event arrives:
    1. Add item to todo: "Reserve inventory for order-123"

Processor Logic (continuously):
FOR EACH todo item IN todo_list:
    - Check if inventory available
    - If yes: Reserve inventory, produce InventoryReserved event, mark done
    - If no: Produce InventoryFailed event, mark failed
    - If error: Keep in todo for retry

Example:
Event: PaymentAuthorized(orderId=order-123, items=[{prodId: P1, qty: 2}])
    ↓
Todo added: Reserve P1 qty 2
    ↓
Processor checks: P1 has 5 available, need 2 
    ↓
Action: Reserve 2 units
    ↓
Event produced: InventoryReserved(orderId=order-123, reserved=[...])
    ↓
Todo marked done
```

**Key insight**: Processors are reactive. They listen for events and create todo items, then execute those todos by issuing commands that produce new events.

### 2c. Document Processor Automation (Gears Symbol)
Show which commands come from automation vs. user actions:

```
Command Catalog with Role Attribution (from Role Catalog):

UI-Issued Commands (attributed to specific human roles):
  1. CreateOrder (Order Entry screen) [ Customer]
  2. ConfirmOrder (Confirmation screen) [ Customer]
  3. CancelOrder (Status screen) [ Customer]
  4. RequestReturn (Order page) [ Customer]
  5. OverrideOrderStatus (Admin panel) [ Support Agent]

Processor-Issued Commands (attributed to system actors):
  6. AuthorizePayment (Payment gateway webhook) [ Payment Gateway]
  7. ReserveInventory (Triggered by PaymentAuthorized) [ Inventory System]
  8. CreateShipment (Triggered by InventoryReserved) [ Fulfillment System]
  9. NotifyCustomer (Triggered by multiple events) [ Notification Service]
```

**Validation**: Every command MUST have a role/actor attribution. If a command says `[ User]` instead of a specific role name, it's incomplete — go back to the Role Catalog and assign the correct role.

### 3. Document Command Specifics
For each command, define structure:

```
Command: ConfirmOrder
Source: UI (user clicks button)
Input:
    orderId: string (from URL/context)
    paymentMethod: enum ('card' | 'transfer')
    [paymentDetails]: depends on method

Validation rules:
    - Order must exist
    - Order must be in Draft state
    - Payment method must be supported
    - Funds must be available (pre-check)

Preconditions (from stream state):
    - OrderCreated event exists
    - No ConfirmOrder previously processed

Success result: OrderConfirmed event

Failure results:
    - "Order not found" → Command rejected, no event
    - "Order already confirmed" → Command rejected, no event
    - "Payment method not supported" → Command rejected, no event
```

### 4. Create Command Catalog
List all commands the system accepts:

```
Command Catalog: Order System

### UI-Issued Commands

1. CreateOrder
   Source: User (Order Entry screen)
   Input: customerId, items[], shippingAddress
   Produces: OrderCreated event

2. ConfirmOrder
   Source: User (Confirmation screen)
   Input: orderId, paymentMethod
   Produces: OrderConfirmed event

3. CancelOrder
   Source: User (Status screen)
   Input: orderId, reason
   Produces: OrderCancelled event

### Processor-Issued Commands

4. AuthorizePayment
   Source: Payment Processor (webhook)
   Input: orderId, paymentId, authCode
   Produces: PaymentAuthorized event

5. FailPayment
   Source: Payment Processor (webhook)
   Input: orderId, paymentId, reason
   Produces: PaymentFailed event

6. ReserveInventory
   Source: Inventory Processor (triggered by PaymentAuthorized)
   Input: orderId, items[]
   Produces: InventoryReserved event

7. CreateShipment
   Source: Fulfillment Processor (triggered by InventoryReserved)
   Input: orderId, items[]
   Produces: OrderShipped event
```

### 5. Map Data Sources
Document where each command input comes from:

```
Command: ConfirmOrder

Data origin matrix:
  orderId
    ↑ Source: UI context (from OrderCreated, displayed to user)
    ↑ Captured: Hidden in URL or session
    ↑ Validation: Must match Order from stream

  paymentMethod
    ↑ Source: UI form selection
    ↑ Captured: User selects checkbox/radio
    ↑ Validation: Must be in allowed list

[paymentDetails] (conditional)
    ↑ Source: Depends on paymentMethod
    ↑ For 'card': Card number, CVV, expiry (from payment form)
    ↑ For 'transfer': Bank account, routing number (from form)
    ↑ Validation: Format and validity checks
```

### 6. Identify Implicit Context
Document what comes from stream state:

```
Command: ShipOrder
Explicit input (from UI/Processor):
    orderId
    shipmentId (from fulfillment system)

Implicit context (from stream state):
    Order must exist
    Order must be in InventoryReserved state
    Payment must be authorized (from PaymentAuthorized event)
    Inventory must be reserved (from InventoryReserved event)

These implicit checks use stream state:
    currentState.orderId === orderId 
    currentState.status === 'InventoryReserved' 
    currentState.paymentId exists 
    currentState.shipmentId can be set 
```

## Output Format

Instead of writing a markdown document, **place each COMMAND on the board** using the `node:created` API.

> **CRITICAL: Every COMMAND node MUST include `meta.fields` with a `mapping` on every field.** A command without fields — or with fields that lack `mapping` — is an incomplete model that cannot be traced, validated, or turned into code.

### Field data lineage — the `mapping` attribute

Every field on a COMMAND must carry a `mapping` that says exactly where its value comes from. Use one of these forms:

 | `mapping` format | Meaning | `generated` | Example |
|---|---|---|---|
| `"user-input"` | User types or selects this value directly | `false` | `startTime` picked from a date picker |
| `"session:<fieldName>"` | Read from the authenticated session | `false` | `session:customerId` |
| `"<EventTitle>.<fieldName>"` | Taken from a previously emitted event | `false` | `BikeReserved.bikeId` |
| `"derived:<expression>"` | Computed by the system | `true` | `derived:uuid4()`, `derived:now()` |
| `"webhook:<payloadField>"` | Comes from an external webhook payload | `false` | `webhook:gateway_transaction_id` |

Set the field's `generated` property according to this table. Fields typed by the user (typically from a screen form) are never generated — the user supplies the value. Fields with a `derived:` mapping are always generated — the system produces the value automatically.

The `mapping` traces the value all the way back to its origin. **If you cannot write a mapping for a field, that field has an unknown origin — treat it as a gap and resolve it.**

### Field traceability rule for events

Every field in the resulting EVENT must either:
- Appear in the command's `fields` (direct mapping — same name or documented rename), or
- Be derivable from command fields + system state

Example: `BikeReserved.reservedAt` is not in `ReserveBike` but derives from `derived:now()`. That is acceptable — document it. `BikeReserved.reservationId` is not in `ReserveBike` but derives from `derived:uuid4()`. Also acceptable.

If an event field has **no** corresponding command field and **no** derivation rule, that is a gap — add it to the command or note it as a system-generated field.

> **Connected-element rule**: A field `mapping` may only reference elements that are connected to this COMMAND via board arrows (`SCREEN → COMMAND`). If a field's value would come from something not yet connected, flag it as a gap. **If a mapping cannot be defined at all, it hints at missing data in the model or a modeling error** — a missing event field, a missing screen field, or a broken connection. Investigate before proceeding.

```json
{
  "type": "COMMAND",
  "title": "ReserveBike",
  "fields": [
    {"name": "customerId",  "type": "String",  "example": "cust-42",               "mapping": "session:customerId", "generated": false},
    {"name": "bikeId",      "type": "String",  "example": "bike-17",               "mapping": "user-input",         "generated": false},
    {"name": "stationId",   "type": "String",  "example": "stn-03",                "mapping": "user-input",         "generated": false},
    {"name": "startTime",   "type": "Date",    "example": "2026-06-01T09:00:00Z",  "mapping": "user-input",         "generated": false},
    {"name": "endTime",     "type": "Date",    "example": "2026-06-01T17:00:00Z",  "mapping": "user-input",         "generated": false}
  ]
}
```

Event fields produced by this command:
- `reservationId` → `derived:uuid4()` → `generated: true`
- `customerId` → `ReserveBike.customerId` → `generated: false`
- `bikeId` → `ReserveBike.bikeId` → `generated: false`
- `stationId` → `ReserveBike.stationId` → `generated: false`
- `startTime` → `ReserveBike.startTime` → `generated: false`
- `endTime` → `ReserveBike.endTime` → `generated: false`
- `reservedAt` → `derived:now()` → `generated: true`

Commands go in the `interaction` lane — same column as their resulting event.

### Creating a COMMAND node with fields

**Every `node:created` call MUST include `cellId`.** Without it the node has no cell reference and will appear stranded at position 0,0 — not in any timeline column.

Commands go in the **interaction lane**, same column as the event they produce. Before creating each command:

**Step A — Find the event's column ID.** Query the event node to read its current cell:
```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$EVENT_NODE_ID"
# → node.meta.cellId is "<someRowId>-<columnId>" — extract the columnId part
```

**Step B — Fetch the chapter to find the interaction row ID:**
```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID"
# → timelineData.rows — find the row where type === "interaction"
```
Save `interactionRow.id`.

**Step C — Compute the cell ID:**
```
cellId = interactionRow.id + "-" + columnId
```

**Step D — Create the command with `cellId`:**

```bash
curl -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: identifying-inputs" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<boardId>",
    "timestamp": 1234567890,
    "chapterId": "<chapterId>",
    "cellId": "<interactionRowId>-<columnId>",
    "meta": {
      "type": "COMMAND",
      "title": "ReserveBike",
      "fields": [
        {"name": "customerId", "type": "String", "example": "cust-42",             "mapping": "session:customerId"},
        {"name": "bikeId",     "type": "String", "example": "bike-17",             "mapping": "user-input"},
        {"name": "startTime",  "type": "Date",   "example": "2026-06-01T09:00:00Z","mapping": "user-input"}
      ]
    }
  }]'
```

> **Never call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first. `node:created + cellId` is the only placement step needed.

### Preventing backward arrows (mandatory pre-placement check)

A `SCREEN → COMMAND` connection must always go downward within the same column (actor row → interaction row). A `COMMAND → EVENT` connection must also be within the same column. Both are inherently forward because they share a column.

However, if a screen placed in Step 3 (Storyboarding) is in a column that is **different** from the event column, the connection will span columns and may go backwards. Before placing a command:

1. Confirm the screen for this command is in the **same column** as the event it produces.
2. If the screen is in an earlier column, move it to the event's column before wiring.
3. If the screen is in a later column, move the event's column (by inserting a new column at the correct index) or move the screen to match.

The timeline must always read left-to-right: SCREEN and COMMAND belong in the same column as the EVENT they produce.

### Wire connections after placing each COMMAND

After `place-element` returns the COMMAND node ID, create the arrows that complete the slice:

1. **SCREEN → COMMAND** — find the SCREEN node in the actor row of the same column:
   ```bash
   curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<actorRowId>-<columnId>" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs"
   ```
   If a SCREEN node exists, connect it:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<screenNodeId>","target":"<commandNodeId>"}'
   ```

2. **COMMAND → EVENT** — find the EVENT node in the swimlane row of the same column:
   ```bash
   curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?cellId=<swimlaneRowId>-<columnId>" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs"
   ```
   Connect command to its resulting event:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: eventmodeling-identifying-inputs" \
     -H "Content-Type: application/json" \
     -d '{"source":"<commandNodeId>","target":"<eventNodeId>"}'
   ```

Skip a connection silently if the target cell is empty (the element may be placed in a later step). Log each created arrow: `→ connected SCREEN→COMMAND "PlaceOrder"` or `→ connected COMMAND→EVENT "PlaceOrder"→"OrderPlaced"`.

After all commands are placed and wired, present the Command Catalog summary as text to the user.

---

For reference, the full markdown structure is:

```markdown
# Inputs: [Domain Name]

## Commands Summary

| Command | Role/Actor | Source | Trigger | Input | Event |
|---------|------------|--------|---------|-------|-------|
| CreateOrder | Customer | UI | User action | customerId, items, address | OrderCreated |
| ConfirmOrder | Customer | UI | User action | orderId, paymentMethod | OrderConfirmed |
| CancelOrder | Customer | UI | User action | orderId, reason | OrderCancelled |
| AuthorizePayment | Payment Gateway | Processor | Webhook | orderId, paymentId | PaymentAuthorized |
| ReserveInventory | Inventory System | Processor | PaymentAuthorized event | orderId, items | InventoryReserved |
| ShipOrder | Fulfillment System | Processor | InventoryReserved event | orderId, shipmentId | OrderShipped |

---

## Detailed Commands

### Command: CreateOrder

**Source**: User (Order Entry screen)

**Input Data**:
- customerId: string
- items: Array<{productId: string, quantity: number}>
- shippingAddress: {street, city, state, zip}

**Validation**:
- customerId must exist in system
- items array must not be empty
- quantities must be > 0
- address fields must be non-empty

**Preconditions** (from stream state):
- Stream Order:X does not exist yet

**Success**: Produces OrderCreated event

**Failure**: Command rejected, no event
- "Customer not found"
- "Items invalid"
- "Address incomplete"

--- [Repeat for each command]

---

## Data Completeness Check

### Data Input → Event

Verify every command input becomes event data:

| Command Input | Event Data | Status |
|---------------|-----------|--------|
| customerId | orderId |  Stored in OrderCreated |
| items | items |  Stored in OrderCreated |
| shippingAddress | shippingAddress |  Stored in OrderCreated |

### Missing Data

Document any input that doesn't make it to events:
- None identified 

---

## Processor Commands

Document all processor-triggered commands:
[List each with source system and trigger condition]
```

## Quality Checklist

- [ ] Every UI action maps to a command
- [ ] Every processor action maps to a command
- [ ] **Every command is attributed to a specific role/actor from the Role Catalog**
- [ ] **No command uses generic "User" — must name the specific role (Customer, Seller, Admin, etc.)**
- [ ] Every command input is documented
- [ ] Every input validates against rules
- [ ] Preconditions from stream state are explicit
- [ ] Success and failure outcomes documented
- [ ] Implicit context from stream state is identified
- [ ] No undocumented commands exist
- [ ] Command naming is consistent and clear
- [ ] Processor triggers are explicit
- [ ] **Processor todo list pattern explained for each automation**
- [ ] **Event-to-todo triggering mechanism documented**
- [ ] **Automation marked with [AUTO] to distinguish from user actions [USER]**
- [ ] **Processor failure/retry handling specified**

## Key Principles

1. **Source Clarity**: Every command comes from UI or Processor
2. **Input Completeness**: All needed data captured
3. **Validation Explicit**: All rules documented
4. **State Awareness**: Preconditions from stream state clear
5. **Event Mapping**: Every input becomes event data

## Common Patterns

### User Command Pattern
```
User action on UI screen
  ↓
Captures form/selection data
  ↓
Validation checks
  ↓
Command issued
  ↓
Event created or rejection
```

### Processor Command Pattern
```
External event/webhook received
  ↓
Triggers processor logic
  ↓
Processor validates and decides
  ↓
Command issued (if valid)
  ↓
Event created or decision recorded
```

### Conditional Input Pattern
```
Command: PaymentConfirm
Input:
  - paymentMethod (user selected)
  - paymentDetails (conditional on method)
    If method='card': cardNumber, CVV, expiry
    If method='transfer': bankAccount, routingNumber
```
