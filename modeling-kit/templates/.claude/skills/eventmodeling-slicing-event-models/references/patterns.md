# Event Modeling Slice Patterns

## Table of Contents
- [Slice Definition Template](#slice-definition-template)
- [Implementation Order Strategies](#implementation-order-strategies)
- [Cross-Slice Communication Patterns](#cross-slice-communication-patterns)
- [MVP Scoping with Slices](#mvp-scoping-with-slices)
- [Tips for Effective Slicing](#tips-for-effective-slicing)

---

## Slice Definition Template

Use this template for each feature slice:

```

 Feature Slice: [Name]                                          


BUSINESS VALUE:
What user capability does this enable?
Example: "Buyers can submit reviews and get immediate feedback"

COMMANDS:
  - [Command 1]: What it does
  - [Command 2]: What it does

EVENTS PRODUCED:
  - [Event 1]: When it occurs
  - [Event 2]: When it occurs

EVENTS CONSUMED:
  - [Event from other slice]: Why needed

[COMMANDHANDLER]STATES INVOLVED:
  - [CommandHandler]State class: Which handler owns it, how it's reconstructed

READ MODELS/PROJECTIONS CREATED/UPDATED:
  - [Projection 1]: What events it consumes, what data it produces
  - [Projection 2]: What events it consumes, what data it produces

UPSTREAM DEPENDENCIES:
  "Must complete these slices first:"
  - [Slice X]: Why (what event/aggregate needed)

DOWNSTREAM DEPENDENTS:
  "These slices depend on us:"
  - [Slice Y]: Why (what event/aggregate they need)

CAN RUN PARALLEL WITH:
  - [Slice Z]: Why (no dependencies between us)
  - [Slice W]: Why (independent)

ESTIMATED EFFORT:
  - Development: X days
  - Testing: X days
  - Total: X days

TEAM ASSIGNMENT:
Suggested team size: 1-3 people
Skills needed: [Backend/Frontend/Full-stack]

MVP CRITICAL?
Yes/No (Is this needed for minimum viable product?)

DEPLOYMENT NOTES:
  - Can be deployed independently? [Yes/No]
  - Database migrations? [None/Minor/Major]
  - Configuration changes? [None/Yes]
```

---

## Implementation Order Strategies

### Strategy 1: Bottom-Up (Foundation First)

```
Order:
  1. Core domain slices (most dependencies, fewest dependents)
  2. Mid-layer slices (depend on core, some have dependents)
  3. Presentation slices (few dependencies, most flexible)

Advantage: Stable foundation, reduces rework
Disadvantage: Takes longer to show user value
Best for: Complex systems with many dependencies
```

**Example (Acme Corp Order Management)**:
```
Phase 1: Core Order Flow Handlers (foundation - 2 weeks)
   CreateOrderHandler + CreateOrderState
   ConfirmOrderHandler + ConfirmOrderState
   Establishes Order event stream, OrderCreated/OrderConfirmed events

Phase 2: Payment Handlers (depends on Phase 1 - 2 weeks)
   AuthorizePaymentHandler + AuthorizePaymentState
   ProcessRefundHandler + ProcessRefundState
   Uses OrderConfirmed event, produces PaymentAuthorized

Phase 3: Inventory Handlers (depends on Phase 2 - 2 weeks)
   ReserveInventoryHandler + ReserveInventoryState
   ReleaseInventoryHandler + ReleaseInventoryState
   Depends on PaymentAuthorized event

Phase 4: Fulfillment Handlers (depends on Phase 3 - 2 weeks, parallel with 3)
   CreateShipmentHandler + CreateShipmentState
   ConfirmDeliveryHandler + ConfirmDeliveryState
   Depends on InventoryReserved event, builds ShipmentStatusView
```

### Strategy 2: Top-Down (User Value First)

```
Order:
  1. MVP slices (minimum user value, isolate dependencies)
  2. Core slices (support MVP)
  3. Enhanced slices (nice-to-have features)

Advantage: Show value quickly, get feedback early
Disadvantage: May need refactoring when core changes
Best for: Fast-moving products, MVP validation
```

**Example**:
```
MVP Sprint 1-2: Core Order Flow (minimal, customers can place orders)
   What users need: Create and confirm an order

MVP Sprint 3-4: Payment Processing (enables revenue)
   What the business needs: Authorize and capture payment

Later: Inventory Management (operational feature)
   Prevent overselling, can be manual initially

Later: Fulfillment & Shipping (logistics integration)
   Can be added after payment and inventory are stable
```

### Strategy 3: Risk-Based (De-risk First)

```
Order:
  1. Uncertain slices (highest risk, validate early)
  2. Dependent slices (build on validated foundation)
  3. Straightforward slices (low risk, can be last)

Advantage: Identifies problems early
Disadvantage: May defer high-value features
Best for: Novel architectures, unproven patterns
```

**Example**:
```
Sprint 1-2: Payment Gateway Integration (highest uncertainty)
   Will the payment provider API behave at scale?
   If this fails, the whole order flow is blocked
   Validate this works before building on it

Sprint 3-4: Core Order Flow (depends on payment working)
   Now we know payment authorization is reliable
   Safe to build order submission on top

Sprint 5-6: Inventory & Fulfillment (low risk)
   Foundation solid, now add operational slices
```

---

## Cross-Slice Communication Patterns

### Pattern 1: Event-Driven (Recommended)

```
Slice A produces event
    ↓
Event published to bus
    ↓
Slice B consumes event
    ↓
Slice B updates its read model

Advantages:
   Loose coupling
   Asynchronous
   Slices don't need to know about each other
   Easy to add new slices
```

**Example**:
```
Slice: Review Submission (produces ReviewPublished)
  ↓
Event: ReviewPublished (published to event bus)
  ↓
Slice: Manual Moderation (listens for ReviewPublished)
Slice: Seller Responses (listens for ReviewPublished)
Slice: Seller Ratings (listens for ReviewPublished)

All three can consume the same event independently
```

### Pattern 2: Event Stream with Multiple Handlers (Correct Approach)

```
One event stream, multiple independent command handlers
  ↓
Each handler owns its own [CommandHandler]State class
  ↓
Each handler reconstructs its own state from shared events
  ↓
Handlers coordinate via events (eventual consistency)

Advantages:
   Loose coupling (handlers don't call each other)
   Easy to parallelize (each handler is isolated)
   No shared state classes (zero merge conflicts)
   Each handler can deploy independently

Disadvantages:
   Eventual consistency (not immediate)
```

**Example**:
```
Event Stream: Review (ReviewSubmitted, ReviewPublished, ReviewRejected, etc.)

Handlers (all independent):
  - SubmitReviewHandler owns SubmitReviewState
  - ApproveReviewHandler owns ApproveReviewState
  - RejectReviewHandler owns RejectReviewState
  - DeleteReviewHandler owns DeleteReviewState

All handlers process events from same stream
Each maintains its own state in memory during command processing
No shared state class, no coupling, no merge conflicts
```

### Pattern 3: Read Model Dependency

```
Slice A creates/updates read model
  ↓
Slice B queries read model
  ↓
Slice B shows data to user

Advantages:
   Can develop in parallel
   Slice B independent of Slice A implementation

Disadvantages:
   Eventually consistent
   Slice B deployment depends on Slice A being deployed first
```

**Example**:
```
Slice: Seller Ratings (creates SellerProfileView read model)
  ↓
Slice: Seller Dashboard (queries SellerProfileView)
   Dashboard independent of how ratings are calculated
   But SellerProfileView must be deployed/working
```

---

## MVP Scoping with Slices

### Identifying MVP Slices

```
MVP Principle: Minimum Viable Product
  = Smallest set of slices that provides customer value

Questions to ask:

1. What's the core user problem we're solving?
   Example: "Buyers want feedback on products"

2. What's the minimal slice needed?
   Example: "Review Submission + Display" (not moderation yet)

3. What can we defer?
   Example: "Seller Responses, Ratings, Moderation" (Phase 2+)

4. Which slices must we have for others to work?
   Example: "Submission is foundation, everything depends on it"

MVP Slices:
Priority 1 (Must have): Review Submission
Priority 2 (Nice to have): Seller Responses
Priority 3 (Defer): Manual Moderation, Ratings
```

### MVP Timeline

```
WEEK 1-2: MVP Launch
   Slice 1: Review Submission & Auto-Publish
     - Buyers can submit reviews
     - Auto-moderation (simple checks)
     - Reviews published immediately (if passes check)
     - Basic review display

Result: Users can submit and see reviews
Revenue impact: Reputation system working
Team effort: 1-2 engineers

WEEK 3-4: Phase 2 Additions
   Slice 2: Seller Responses
     - Sellers can respond
     - Responses published immediately

Result: Two-way conversation
Team effort: 1-2 engineers (parallel)

WEEK 5-6: Phase 3 Operations
   Slice 3: Manual Moderation
     - Admin can approve/reject flagged content

Result: Platform governance
Team effort: 1-2 engineers

WEEK 7-8: Phase 4 Analytics
   Slice 4: Seller Ratings & Dashboard
     - Ratings calculated and displayed
     - Seller dashboard

Result: Reputation metrics visible
Team effort: 1-2 engineers
```

---

## Tips for Effective Slicing

### 1. Slice by Business Capability, Not Technical Layer

```
 WRONG (by technical layer):
Slice 1: All command handlers
Slice 2: All event handlers
Slice 3: All read models
Problem: Can't ship anything independently, highly coupled

 CORRECT (by business capability):
Slice 1: Review submission (includes command + event + read model)
Slice 2: Moderation (includes command + event + read model)
Slice 3: Responses (includes command + event + read model)
Benefit: Each slice is shippable independently
```

### 2. Keep Slices Thin and Cohesive

```
 GOOD: One feature per slice
  - Submission slice does submission only
  - Moderation slice does moderation only

 WRONG: Multiple features in one slice
  - "Submission + Moderation" slice
Problem: Harder to parallelize, harder to test
```

### 3. Keep Handler State Classes Isolated

```
If multiple handlers work same event stream:
   SubmitReviewHandler owns SubmitReviewState
     ApproveReviewHandler owns ApproveReviewState
     Both reconstruct from ReviewSubmitted events

Problem (DON'T DO THIS):
     Shared ReviewAggregate class used by both handlers
       Result: Tight coupling, merge conflicts, hard to parallelize

Solution (DO THIS):
     Each handler owns its own [CommandHandler]State class
       Result: Loose coupling, no merge conflicts, easy to parallelize

Read Models:
     Slice 3 & 4 both read SellerProfileView
       Problem: Who creates it?
       Solution: One slice (Rating handler) projects it, others consume
```

### 4. Make Dependencies Explicit

```
For each slice:
[ ] List which handler this slice implements
[ ] List exact events it needs from other handlers
[ ] List exact events it produces
[ ] List exact read models it reads
[ ] List exact read models it creates/updates

Result: Clear contracts between slices
```

### 5. Plan Handler Communication

```
How handlers in different slices connect:
   Event Stream (loosely coupled, asynchronous)
     - Handler A emits event
     - Handler B consumes via event projection
     - No direct dependencies

   Event Stream with Multiple Handlers (loosely coupled, asynchronous)
     - Multiple handlers work same event stream
     - Each owns separate [CommandHandler]State class
     - Coordinated via events (eventual consistency)

   Shared Read Models (loosely coupled, eventually consistent)
     - Slice A projects read model
     - Slice B queries read model
     - Works if A's projections deployed first

   Shared State Classes (tightly coupled, avoid)
     - Both slices share one [CommandHandler]State class
     - Results in merge conflicts and tight coupling
     - Don't do this!
```
