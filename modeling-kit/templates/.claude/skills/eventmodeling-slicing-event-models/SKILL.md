---
name: eventmodeling-slicing-event-models
description: "Break down complete event models into independently implementable feature slices, identify dependencies, and plan parallel implementation across teams. Use when planning team allocation, identifying MVP scope, or establishing implementation order after completing event modeling. Do not use for: organizational team structure based on Conway's Law (use eventmodeling-applying-conways-law) or planning before the event model is complete (complete the full model first using eventmodeling-orchestrating-event-modeling)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Slicing Event Models

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already specified: available team capacity, sprint duration, MVP scope/timeline, and critical path requirements. Interview when implementation planning details haven't been discussed or when you want to help identify MVP scope.

**Interview Strategy**: Understand team capacity and timeline constraints to create realistic implementation slices. This shapes MVP scope and parallel work planning.

### Critical Questions

When implementation planning is needed:

1. **Available Team Capacity** (Impact: Determines how many slices can be built in parallel)
   - Question: "How many teams/people are available? (A) 1 team (solo), (B) 2-3 teams, (C) 4+ teams"
   - Why it matters: More capacity enables parallel work; small teams need fewer slices to avoid idle time
   - Follow-up triggers: If (A) → plan sequential slices; if (C) → maximize parallel work

2. **Sprint/Timeline Constraints** (Impact: Affects slice size and MVP scope)
   - Question: "What's your sprint duration and MVP deadline? (e.g., 2-week sprints with 8-week deadline, 1-week sprints with 4-week deadline)"
   - Why it matters: Tight timelines mean smaller slices; longer timelines allow more ambitious MVP
   - Follow-up triggers: If very tight → ask what MUST be in MVP; if loose → ask what nice-to-haves exist

3. **Critical Path & Dependencies** (Impact: Determines implementation order and blocking relationships)
   - Question: "Are there features that must be built first? (A) No dependencies (parallel from start), (B) Some core features first, (C) Complex dependency chain"
   - Why it matters: Understanding dependencies reveals optimal build order and which slices can start immediately
   - Follow-up triggers: If (C) → ask what depends on what; map dependency chain

### Interview Flow

**Conditional Entry**:
```text
If user has provided:
  - Team capacity (number of teams/people)
  - AND sprint duration + MVP deadline
  - AND identified critical path / MVP features

Then: Skip interview, proceed directly to slicing

Else: Conduct interview
```

**Phase 1: Capacity Planning** (Questions 1-2)
- Understand team count
- Establish timeline constraints
- Determine slice count target

**Phase 2: Dependency Mapping** (Question 3)
- Identify critical path
- Determine implementation order
- Find parallel work opportunities

### Capturing Interview Findings

Document findings to guide slicing:

```markdown
## Interview Findings: [Domain Name] Implementation Plan

**Team Capacity**: [Number of teams/people]
**Sprint Duration**: [Days/weeks]
**MVP Deadline**: [Date]
**Available Sprints for MVP**: [Number]

**Critical Path Features** (must build first):
- [Feature 1]
- [Feature 2]

**Dependency Chain**:
- [Feature A] blocks [Feature B]
- [Feature B] blocks [Feature C]

**Parallel Work Opportunity**:
- Slice 1 & Slice 2 can start simultaneously
- Slice 3 can start after [dependency]

**Recommended Slices**:
- Slice 1 (Foundation): [features] - [Duration]
- Slice 2 (Features): [features] - [Duration]
- Slice 3 (Extended): [features] - [Duration]
```

Optional: Write to `.trogonai/interviews/[timestamp]-slicing-event-models.interview.internal.trogonai.md`.

---

# Event Modeling Slice Skill

**Purpose**: Break down a complete event model into independently implementable feature slices, identify dependencies, and plan parallel (fan-out) implementation across teams.

**Applies To**: Any domain - e-commerce, banking, SaaS, marketplace, healthcare, etc.

**When to Use**:
- After completing full event model (Steps 1-9)
- Before starting implementation
- When planning team allocation and sprint planning
- To identify MVP scope
- To find what can be built in parallel
- To establish implementation order/phases

**What It Does**:
1. Identifies feature slices from complete event model
2. Maps commands, events, and read models to each slice
3. Identifies slice dependencies
4. Determines which slices can be developed in parallel (fan-out)
5. Suggests optimal implementation order
6. Creates implementation roadmap
7. Shows data flow between slices

---

## Core Concept: Feature Slices

A **Feature Slice** is a thin, vertical slice through the entire system:

```
Feature Slice = Command Handler + [CommandHandler]State + Events + Read Models + Projections
                (complete end-to-end flow for one decision/capability)
```

**Key Characteristics**:
- Can be implemented independently by one team
- Each handler owns its own [CommandHandler]State class
- Can be deployed separately
- Clear business value (represents one decision/command)
- Communicates with other slices via events only
- Small enough for one team to implement in 1-2 sprints
- Zero merge conflicts (isolated folder with isolated state class)

---

## Feature Slice Identification Framework

### Step 1: Group by Business Capability

Start by identifying **what users can do**:

```
User Capabilities:
 "Place and confirm an order" ← One slice
 "Pay for an order" ← One slice
 "Manage inventory" ← One slice
 "Fulfill and ship an order" ← One slice
 "Track shipment status" ← One slice
```

Each capability = One feature slice

### Step 2: Map Commands to Slices

Identify which **commands** belong to each slice:

```
Feature Slice: Core Order Flow
Commands:
     CreateOrder (customer submits)
     ConfirmOrder (customer confirms)
     (CancelOrder belongs to its own slice)

Feature Slice: Payment Processing
Commands:
     AuthorizePayment (payment gateway)
     ProcessRefund (customer or support requests)

Feature Slice: Fulfillment & Shipping
Commands:
     CreateShipment (fulfillment team)
     ConfirmDelivery (carrier webhook)
```

### Step 3: Map Events to Slices

Identify which **events** are produced by each slice:

```
Feature Slice: Core Order Flow
Events Produced:
     OrderCreated
     OrderConfirmed
     OrderCancelled (if cancelled before payment)

Feature Slice: Payment Processing
Events Produced:
     PaymentAuthorized
     PaymentFailed
     RefundInitiated
     RefundCompleted

Feature Slice: Inventory Management
Events Consumed:
     PaymentAuthorized (triggers reservation)
Events Produced:
     InventoryReserved
     InventoryReleased

Feature Slice: Fulfillment & Shipping
Events Consumed:
     InventoryReserved (triggers shipment)
Events Produced:
     ShipmentCreated
     DeliveryConfirmed
```

### Step 4: Map Read Models to Slices

Identify which **read models** serve each slice:

```
Feature Slice: Core Order Flow
Read Models:
     OrderDetailView (show what was ordered)
     OrderListView (customer's order history)

Feature Slice: Payment Processing
Read Models:
     PaymentStatusView (payment and refund state)
     OrderPaymentView (payment details per order)

Feature Slice: Inventory Management
Read Models:
     InventoryLevelView (current stock per product)
     ReservationView (what's reserved for which order)

Feature Slice: Fulfillment & Shipping
Read Models:
     ShipmentStatusView (tracking and delivery state)
     OrderFulfillmentView (fulfillment progress per order)
```

---

## Slice Dependency Analysis

### Identifying Dependencies

**Dependency Types**:

```
Type 1: Event Dependency
  "Slice B needs events from Slice A"
Example: ReserveInventoryHandler needs PaymentAuthorized (from AuthorizePaymentHandler)
Impact: Must implement Slice A first (publish events)

Type 2: Event Stream Dependency (NOT Aggregate Dependency)
  "Slice B's handler reconstructs state from same event stream as Slice A"
Example: ShipOrderHandler uses OrderCreated/OrderConfirmed events to build ShipOrderState
Impact: Can develop in parallel, but must serialize commands at event store level

Type 3: Read Model Dependency
  "Slice B reads projection from Slice A"
Example: Fulfillment slice needs InventoryLevelView (projected from inventory events)
Impact: Can develop in parallel, but A's projections must deploy first

Type 4: No Dependency
  "Slices are completely independent"
Example: AuthorizePaymentHandler and CreateShipmentHandler work separate event streams
Impact: Can develop, test, and deploy in true parallel
```

### Dependency Matrix Example

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

## Fan-Out Implementation Planning

### Parallel Development Strategy

```
CRITICAL PATH (Must do in sequence):
Slice 1: Core Order Flow (foundation)
    ↓ (depends on OrderConfirmed event)
Slice 2: Payment Processing (depends on Slice 1)
    ↓ (depends on PaymentAuthorized event)
Slice 3: Inventory Management (depends on Slice 2)
    ↓ (depends on InventoryReserved event)
Slice 4: Fulfillment & Shipping (depends on Slice 3)

Visual Timeline:
Week 1-2:   [Slice 1: Core Orders] (Team A)
               Unlocks Payment slice

Week 3-4:   [Slice 2: Payment] (Team A)  [Slice 1 integration tests] (Team B)
               Payment unlocks Inventory

Week 5-6:   [Slice 3: Inventory] (Team A)  [Slice 4: Fulfillment] (Team B)
               Can work in parallel once Payment is done

Week 7-8:   Integration & Cross-Slice Testing
```

### Fan-Out Pattern

**Fan-Out** = One slice (foundation) → Multiple slices (parallel)

```
Example: Acme Corp Order Management

Slice 1 → Slice 2 → Slice 3 → Slice 4
(Orders)   (Payment)  (Inventory)  (Fulfillment)

Benefits:
   Teams work in parallel
   Slice 1 done in Week 2, teams start Weeks 3-4
   3 teams productive simultaneously
   Critical path stays short
   Risk distributed (if Slice 2 hits issue, Slice 3 continues)
```

---

## Reference Documentation

For detailed patterns, implementation strategies, and examples:

- **[patterns.md](references/patterns.md)** - Slice templates, implementation strategies, communication patterns, MVP scoping, and best practices
- **[examples.md](references/examples.md)** - Complete slice breakdowns, dependency matrices, fan-out timelines, and checklists

---

## Quality Checklist

- [ ] Each slice contains exactly one complete UI/Processor → Command → Event → Read Model flow
- [ ] Slice dependencies flow in one direction — no circular dependencies between slices
- [ ] Each slice is independently deployable — no slice requires another slice to be running to function
- [ ] Every [CommandHandler]State in a slice is owned exclusively by that slice's handler
- [ ] MVP scope identifies the minimum set of slices that delivers customer value end-to-end
- [ ] Fan-out plan assigns each slice to a team with no overlapping handler ownership

