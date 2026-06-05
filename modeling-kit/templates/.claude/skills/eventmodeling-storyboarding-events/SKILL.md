---
name: eventmodeling-storyboarding-events
description: "Step 3 of Event Modeling - Create UI storyboards/mockups showing what users see at each step. Capture all data fields needed from user perspective. Use after sequencing events. Do not use for: identifying commands or processor actions (use eventmodeling-identifying-inputs) or designing read models (use eventmodeling-identifying-outputs)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Storyboarding Events

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already specified: existing UI patterns or mockups to reference, critical data fields, and UI/UX preferences. Interview when these details haven't been discussed or when the user wants guidance on storyboarding depth.

**Interview Strategy**: Clarify UI needs, data priorities, and existing patterns to guide storyboard design. This ensures mockups capture all necessary fields without over-designing.

### Critical Questions

When UI design guidance is needed:

1. **Current UI State** (Impact: Determines if you're designing from scratch or enhancing existing)
   - Question: "Do you have: (A) Existing UI/wireframes to reference, (B) Rough sketches, (C) Starting from scratch?"
   - Why it matters: Existing UI provides constraints and patterns; starting fresh allows more design freedom
   - Follow-up triggers: If (A) → ask to share; if (C) → ask about platform/technology

2. **Most Critical Data Fields** (Impact: Determines storyboard focus and detail level)
   - Question: "Which data fields are most important for users to see? (e.g., order status, payment confirmation, tracking info)"
   - Why it matters: Knowing priorities helps avoid over-designing; users need to see what matters most first
   - Follow-up triggers: For each critical field → ask "What decisions do users make based on this data?"

3. **UI/UX Preferences & Constraints** (Impact: Shapes storyboard style and interaction patterns)
   - Question: "Any UI preferences? (A) Web, (B) Mobile, (C) Both. And design style: (A) Minimal wireframes, (B) Detailed mockups, (C) Interact prototypes?"
   - Why it matters: Platform and fidelity affect storyboard detail; mobile has different constraints than web
   - Follow-up triggers: If (C) → ask about prototype tool; if minimal → discuss what level of detail is enough

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Existing UI patterns or references
  - AND identified critical data fields
  - AND specified storyboard detail level

Then: Skip interview, proceed directly to storyboarding

Else: Conduct interview
```

**Phase 1: Context Assessment** (Questions 1-2)
- Understand existing UI context
- Identify data priorities
- Establish storyboard scope

**Phase 2: Design Guidance** (Question 3)
- Determine platform and fidelity
- Adjust storyboard detail accordingly

### Capturing Interview Findings

Document findings to guide storyboard creation:

```markdown
## Interview Findings: [Domain Name] UI

**Existing UI Context**: [Starting from scratch / Enhancing / Matching pattern]
**Most Critical Data**: [List fields in priority order]
**Platform**: [Web / Mobile / Both]
**Storyboard Detail**: [Minimal wireframes / Detailed mockups]

**Key UI Interactions**:
- [Action 1]: [What data triggers it]
- [Action 2]: [What data triggers it]

**Storyboard Focus**:
- Prioritize showing [most critical fields]
- Ensure [specific interactions] are clear
- Reference [existing patterns] for consistency
```

Optional: Write to `.trogonai/interviews/[timestamp]-storyboarding-events.interview.internal.trogonai.md`.

---

## Workflow

Given the event timeline, create UI storyboards:

### 1. Identify UI Screens/Views
Create a mockup for each state of the system:

```
Screen 1: Order Creation Form

 Place Your Order                

                                 
 Customer ID: [____________]     
                                 
 Items:                          
Product 1  Qty: [_]  Price: $_
Product 2  Qty: [_]  Price: $_
Product 3  Qty: [_]  Price: $_
                                 
 Total: $___                     
                                 
 Shipping Address:               
 [_____________________]         
 [_____________________]         
                                 
 [ Create Order ]                


Trigger: CreateOrder command
Result Events: OrderCreated
Data captured from UI:
  - customerId
  - items (products + quantities)
  - total
  - shippingAddress
```

### 2. Show State Transitions Between Screens
Document what changes when events occur:

```
Screen 2: Order Confirmation
(After OrderCreated event)


 Order Confirmation              

                                 
 Order ID: #12345                
 Status: Draft                   
                                 
 Items: 3 products               
 Total: $150.00                  
                                 
 Shipping: 123 Main St           
                                 
 Payment Options:                
Credit Card                   
Bank Transfer                 
                                 
 [ Confirm Order ]               


Trigger: ConfirmOrder command
Result Events: OrderConfirmed
Data from UI:
  - orderId (from OrderCreated)
  - paymentMethod
```

### 3. Document All Data Fields
For each screen, list what data is displayed:

```
Screen: Order Status View

 Your Order Status               

 Order ID: #12345                 (from OrderCreated)
 Status: Confirmed               (from OrderConfirmed)
 Confirmed at: 2024-12-31 10:00   (from OrderConfirmed)
                                 
 Payment: Authorized             (from PaymentAuthorized)
 Auth Code: AUTH-789              (from PaymentAuthorized)
                                 
 Inventory: Reserved             (from InventoryReserved)
 Expected Ship: 2025-01-02        (from InventoryReserved)
                                 
 Shipped: Pending                 (awaiting OrderShipped)
 Tracking: -- (waiting for shipment)


Fields and their origins:
  orderId → OrderCreated event
  status → OrderConfirmed event
  confirmedAt → OrderConfirmed event
  paymentStatus → PaymentAuthorized event
  authCode → PaymentAuthorized event
  inventoryStatus → InventoryReserved event
  expectedShip → InventoryReserved event
  tracking → OrderShipped event (when available)
```

### 4. Show Data Flow Through Screens
Map how data enters/exits UI:

```
Order Entry UI
   (user inputs)
   customerId
   items[]
   total
   shippingAddress
      ↓
      Command: CreateOrder
      ↓
      Event: OrderCreated
      ↓
      Order Status UI (displays)
       orderId (from event)
       items (from event)
       total (from event)
       shippingAddress (from event)
```

### 5. Organize Screens by Swimlane (Actor/System)

**MANDATORY**: Use the **Role Catalog** from Step 1 (eventmodeling-brainstorming-events) as the source of swimlanes. Every human role in the catalog MUST have its own swimlane. Every system actor that has a UI or todo-list view gets a swimlane too.

Group screens by who interacts with them:

```
Swimlane: Customer (Human Role)
   Screen 1: Order Entry Form
   Screen 2: Order Confirmation
   Screen 3: Order Status View
   Screen 4: Tracking View

Swimlane: Seller (Human Role)
   Screen 1: Order Fulfillment Dashboard
   Screen 2: Review Response Form
   Screen 3: Product Management

Swimlane: Support Agent (Human Role)
   Screen 1: Escalation Queue
   Screen 2: Manual Override Panel

Swimlane: Payment Processor (System Actor)
   Screen 1: Payment Verification (automated)
   Screen 2: Authorization Confirmation

Swimlane: Inventory System (System Actor)
   Screen 1: Reservation Todo List (internal)
   Screen 2: Availability Check

Swimlane: Fulfillment System (System Actor)
   Screen 1: Shipment Creation Todo
   Screen 2: Shipping Confirmation
```

**Validation**: If a role from the catalog has zero screens, either:
- The role is missing screens (add them), or
- The role doesn't belong in the catalog (remove it in Step 1)

This shows which actors interact with which screens and helps visualize system boundaries.

### 6. Show Processor "Todo List" Pattern
For automated processors, show the todo list metaphor:

```
Processor: InventoryReserver

Internal "Todo List" (based on received events):

 Inventory Reservation Todos     

                                 
Order-123: Reserve 2x Prod-1  (triggered by PaymentAuthorized)
Order-124: Reserve 3x Prod-2  (triggered by PaymentAuthorized)
Order-125: Reserve 1x Prod-3  (triggered by PaymentAuthorized)
                                 
 Processor checks todo items:    
 For each: Check availability    
          If available:  Mark done
          Reserve inventory      
          Produce event          
                                 


This todo list is driven by:
Events received → Items added to todo
Processor logic → Items processed
Success → InventoryReserved event produced + todo marked done
Failure → InventoryFailed event produced + todo marked failed
```

### 7. Identify Missing Data
Highlight where data doesn't have a clear source:

```
Problem: Order Status screen needs "expectedShip" date
Current state: Not in any event
Solution: Add expectedShip to InventoryReserved event

Problem: Order status needs "last updated" timestamp
Current state: No tracking of when last change occurred
Solution: Every event includes timestamp
```

## Board Integration

Before starting the analysis, read existing SCREEN nodes from the board to avoid designing screens that already exist:

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=SCREEN"
```

After completing the screen analysis, use the `handle-comment` skill to post a QUESTION comment on any SCREEN node where data fields are unclear or missing sources are identified.

## Mandatory Field Definitions on SCREEN Nodes

> **CRITICAL: Every SCREEN node MUST include `meta.fields` with a `mapping` on every field.** A screen without fields cannot show data lineage — it becomes impossible to verify that all displayed data has a source event or command.

There are two types of screens, and each type has a different `mapping` source:

### Command screen (input/action screen)

An **input screen** captures data that will be sent as a command. Its fields map to the command they feed into.

| Field type | `mapping` | `generated` | Example |
|---|---|---|---|
| User types a value | `"<CommandTitle>.<fieldName>"` | `false` | `"ReserveBike.bikeId"` |
| Read from session | `"session:<fieldName>"` | `false` | `"session:customerId"` |
| Pre-populated from a previous event | `"<EventTitle>.<fieldName>"` | `false` | `"BikeReserved.stationId"` |
| Calculated for display only (not sent to command) | `"derived:<expression>"` | `true` | `"derived:sum(items.price)"` |

### View screen (output/read model screen)

A **view screen** displays data read from a Read Model. Its fields map to the read model that serves the data. View screens are placed adjacent to their read model in Step 5 (Identifying Outputs) — during storyboarding, record the intended read model name as the source even if the read model hasn't been designed yet.

| Field type | `mapping` | `generated` | Example |
|---|---|---|---|
| Displayed from a read model | `"<ReadModelTitle>.<fieldName>"` | `false` | `"ActiveReservationView.status"` |
| Displayed from a direct event (no read model yet) | `"<EventTitle>.<fieldName>"` | `false` | `"BikeReserved.startTime"` |
| Calculated/formatted on the client | `"derived:<expression>"` | `true` | `"derived:formatDuration(durationMinutes)"` |

### Example: command screen fields

```json
{
  "type": "SCREEN",
  "title": "Reserve a Bike",
  "fields": [
    {"name": "bikeId",      "type": "String", "example": "bike-17",               "mapping": "ReserveBike.bikeId"},
    {"name": "stationId",   "type": "String", "example": "stn-03",                "mapping": "ReserveBike.stationId"},
    {"name": "startTime",   "type": "Date",   "example": "2026-06-01T09:00:00Z",  "mapping": "ReserveBike.startTime"},
    {"name": "endTime",     "type": "Date",   "example": "2026-06-01T17:00:00Z",  "mapping": "ReserveBike.endTime"},
    {"name": "bikeCategory","type": "String", "example": "City Bike",             "mapping": "AvailableBikeView.category"},
    {"name": "dailyRate",   "type": "Number", "example": "0.10",                  "mapping": "AvailableBikeView.ratePerMinute"}
  ]
}
```

### Example: view screen fields (Read Model as source)

```json
{
  "type": "SCREEN",
  "title": "Reservation Confirmed",
  "fields": [
    {"name": "reservationId",  "type": "String", "example": "res-001",               "mapping": "ActiveReservationView.reservationId"},
    {"name": "bikeName",       "type": "String", "example": "City Bike — Gazelle",   "mapping": "ActiveReservationView.bikeName"},
    {"name": "stationName",    "type": "String", "example": "Central Park East",     "mapping": "ActiveReservationView.stationName"},
    {"name": "startTime",      "type": "Date",   "example": "2026-06-01T09:00:00Z",  "mapping": "ActiveReservationView.startTime"},
    {"name": "expiresAt",      "type": "Date",   "example": "2026-06-01T09:30:00Z",  "mapping": "ActiveReservationView.expiresAt"},
    {"name": "estimatedCost",  "type": "Number", "example": "48.00",                 "mapping": "derived:durationHours × AvailableBikeView.ratePerMinute × 60"}
  ]
}
```

### Connected-element rule (critical constraint)

> **A field `mapping` may only reference an element that is connected to this SCREEN via a board connection arrow.**
>
> - A command screen may only map to: the COMMAND it submits, the SCREEN's own input (user-input), or a READ MODEL whose `READMODEL → SCREEN` arrow points to this screen.
> - A view screen may only map to: the READ MODEL connected to it via a `READMODEL → SCREEN` arrow, or derived expressions.
> - If a mapping references an element that is not yet connected — for example, `AvailableBikeView.category` when no such read model exists on the board — that is a **gap**. It signals either:
>   1. A read model is missing and must be created in Step 5 (Identifying Outputs), or
>   2. The connection arrow is missing and must be added.
>
> **When you encounter a mapping that cannot resolve to a connected element, write the mapping as-is but flag it as a gap in the completeness notes.** Do not invent connections that don't exist.

A screen that only has a title and no fields is an empty placeholder — place the fields before moving on.

## Mandatory Sketch Rendering

**The wireframe MUST be rendered BEFORE the SCREEN node is dropped into its cell.** Never place a screen node that has no wireframe — it will appear as a broken placeholder to anyone watching the board. The correct order for every screen is:

1. Create the SCREEN node (`node:created`) — this registers the node and gives you its ID
2. Render the wireframe sketch (`POST /images/$NODE/sketch`) — this attaches the visual before anyone sees the node
3. Drop the node into its cell (`POST /timelines/$TL/cells/$CELL/drop`) — now the node is visible on the board with its wireframe already rendered

> **CRITICAL: NEVER pass `"elements": []`. An empty elements array produces a blank, invisible screen and is always wrong. You MUST design and include actual wireframe elements before calling the sketch API.**

Call the sketch API between node creation and cell placement, with a fully designed elements array:

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$NODE_ID/sketch" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: storyboarding-events" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "<concise description of what this screen shows>",
    "elements": [
      {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"},
      {"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":3,"fill":"violet"},
      {"type":"headline","gridX":2,"gridY":1,"text":"Screen Title","fontSize":16,"fill":"white","gridWidth":46},
      ...more elements...
    ]
  }'
```

Design each wireframe using the grid description language from the `storyboard-screen` skill (50×40 grid, 1 unit = 20 px):

| Element type | Required fields | Optional fields |
|---|---|---|
| `rectangle` | gridX, gridY, gridWidth, gridHeight | fill, stroke |
| `text` | gridX, gridY, text | fontSize (default 12), fill, gridWidth |
| `headline` | gridX, gridY, text | fontSize (default 20), fill, gridWidth |
| `button` | gridX, gridY, gridWidth, gridHeight, text | fill, stroke |
| `input` | gridX, gridY, gridWidth, gridHeight, text (placeholder) | fill, stroke |
| `line` | gridX, gridY, gridX2, gridY2 | stroke |
| `circle` | gridX, gridY, gridRadius | fill, stroke |

Named colors: `black` `grey` `light-violet` `violet` `blue` `light-blue` `yellow` `orange` `green` `light-green` `light-red` `red` `white` `transparent`

Every sketch MUST include at minimum:
- A full white background rectangle: `{"type":"rectangle","gridX":0,"gridY":0,"gridWidth":50,"gridHeight":40,"fill":"white"}`
- A colored header bar with the screen title
- Real UI elements matching the screen's purpose: form inputs with labelled fields, data tables or lists, status badges, action buttons
- Field labels that match the actual event/command fields this screen captures or displays
- At least one primary action (submit button, confirm button, etc.) for command screens

A screen node without a wireframe sketch is an empty placeholder. It must not be left unrendered.

## Timeline Placement Rules

When placing screens on the board, follow these alignment rules:

| Screen type | Where it goes on the board |
|-------------|---------------------------|
| **Input/command screen** (triggers a command) | **Actor row, same column as the COMMAND and EVENT** it produces. The screen and command share a column — the screen sits in the actor row, the command in the interaction row, the event in the swimlane row. |
| **View/output screen** (displays a read model) | **Actor row, one column to the RIGHT of the READ MODEL** it displays. The read model occupies the interaction row of the preceding column; the screen gets its own column immediately after. This column is finalised in Step 5 (Identifying Outputs) — during storyboarding, just document which read model each view screen will query. |

> **Do not create standalone screen columns that are disconnected from commands or read models.** Every screen must either share its column with the command it submits, or be placed one column to the right of the read model it displays.

### Placing Automations

When a processor or system actor reacts to events automatically (no human interaction), place an **AUTOMATION** node in the actor row instead of a SCREEN. Automations go in the same column as the COMMAND they trigger and the READMODEL that feeds them.

A column is an automation column (not a screen column) when:
- The action is triggered by the system, not a user gesture
- No human sees or interacts with the UI at this step
- The pattern is `READMODEL → AUTOMATION → COMMAND` (the processor reads state, decides, issues a command)

Examples:
- Payment gateway webhook arrives → AUTOMATION "Authorize Payment"
- Inventory check fires after payment authorized → AUTOMATION "Reserve Inventory"
- Notification service sends an email → AUTOMATION "Send Confirmation Email"

Human roles get SCREEN nodes. System actors and processors get AUTOMATION nodes. Place both types during storyboarding — do not defer automations to a later step.

### One Screen Per Column (Hard Rule)

**Never place more than one SCREEN node in the same column**, even across different actor lanes. Each column represents a single moment in the timeline. Two screens in the same column means two different interactions at the same moment — that breaks the visual narrative and always signals a design error.

```
✅ Correct: Member "Reserve Book" in col 8  |  Librarian "Confirm Checkout" in col 11
❌ Wrong:   Member "My Loans" AND Librarian "Confirm Checkout" both in col 11
```

If a second role also needs a screen related to the same event, insert a new column immediately after and place the second screen there. Use `POST /timelines/:tl/columns` with `{"index": N}` to insert at the correct position.

---

## Output Format

Present as:

```markdown
# Storyboard: [Domain Name]

## Swimlane Organization (from Role Catalog)

### Human Role Swimlanes

#### Customer Swimlane
- Screen 1: Order Entry Form
- Screen 2: Order Confirmation
- Screen 3: Order Status View

#### [Other Human Role Swimlanes — one per role in the catalog]

### System Actor Swimlanes

#### Payment Processor Swimlane
- Screen 1: Payment Verification (automated)
- [Shows what UI/views the processor interacts with]

#### [Other System Actor Swimlanes]

---

## Screen 1: [Screen Name]

### Mockup
```
[ASCII art mockup or description]
```

### Data Displayed
- Field 1: Description, source event
- Field 2: Description, source event

### User Actions (Commands)
- Action: [Action], produces: [Event]

### Business Rules
- Rule about what can/cannot be done on this screen

---

## Screen 2: [Screen Name]

[Repeat for each screen]

---

## Processor Todo Lists

### Processor: [Processor Name]

Internal "Todo List" pattern:
```
Triggered by: [Event type]
Todo action: [What needs to be done]
Success produces: [Event]
Failure produces: [Event]
```

[Repeat for each processor]

---

## Data Flow Diagram

[Show how data enters from UI and returns via events]

---

## Field Traceability Matrix

| Field | Screen | Source Event | Status |
|-------|--------|-------------|--------|
| orderId | Status View | OrderCreated |  |
| shipmentId | Status View | OrderShipped |  |
| customerId | All | OrderCreated |  |

---

## Missing Data Analysis

[Any fields without clear source or destination]
```

## Quality Checklist

- [ ] **Every screen has a rendered wireframe sketch** (sketch API returned HTTP 204 — no exceptions)
- [ ] **No column contains more than one SCREEN node** across all actor lanes
- [ ] Every screen's wireframe shows real field labels matching the event/command fields
- [ ] Every displayed field has a source event
- [ ] Every user action maps to a command
- [ ] Commands map to events
- [ ] Data flows make sense
- [ ] No missing data sources
- [ ] State transitions are clear
- [ ] Alternative states are shown
- [ ] Error states are shown
- [ ] **Every human role from the Role Catalog has at least one swimlane**
- [ ] **Every swimlane is labeled with the role/actor name from the catalog**
- [ ] **Swimlanes organized by actor/system**
- [ ] **Human role screens clearly separated from processor screens**
- [ ] **Processor todo list pattern shown for automated systems**
- [ ] **System boundaries visible through swimlane organization**

## Key Principles

1. **User-Centric**: Design from what users see and do
2. **Data Traceability**: Every field has origin and destination
3. **Completeness**: All needed data is visible
4. **Clarity**: UI clearly shows system state
5. **Consistency**: Same data presented consistently across screens

## Common Patterns

### Input Screen Pattern
```
User fills form (captures command data)
  ↓
Submit button (issues command)
  ↓
Event created with form data
  ↓
Confirmation screen displayed
```

### Status Screen Pattern
```
System displays current state (from read model)
  ↓
Based on latest events
  ↓
Shows all relevant information
  ↓
Available actions based on state
```

### Error State Pattern
```
User action fails (command rejected)
  ↓
No event created
  ↓
Error message displayed
  ↓
UI allows retry or alternative action
```
