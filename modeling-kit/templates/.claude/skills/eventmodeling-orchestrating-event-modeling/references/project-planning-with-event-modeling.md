# Project Planning with Event Modeling

## Overview

One of the most significant benefits of Event Modeling is the **flat cost curve** for features. Unlike traditional development where each new feature becomes increasingly complex and expensive, Event Modeling enables teams to deliver features at a consistent cost.

## The Flat Cost Curve

### Traditional Development Cost Pattern

```
Feature Cost
  ^
       Feature 3 (hardest, most expensive)
          /\
         /  \
        /    \
       /      Feature 2 (harder, expensive)
      /        /\
     /        /  \
    /        /    \
   /  Feature 1   /
   /____/\______/_____ Time

Problem: Cost increases with each feature
  - Feature 1: 2 weeks, 2 people
  - Feature 2: 4 weeks, 3 people
  - Feature 3: 8 weeks, 5 people

Reason: Increasing technical debt and coupling
```

### Event Modeling Cost Pattern

```
Feature Cost
  ^
    Feature 1  Feature 2  Feature 3  Feature 4
      /\        /\        /\        /\
     /  \      /  \      /  \      /  \
    /    \    /    \    /    \    /    \
   /______\  /______\  /______\  /______\___ Time
  
Consistent: Each feature = ~2 weeks, ~2 people

Reason: Clear contracts between steps enable parallel work
```

### Why the Flat Curve?

The article explains:

> "The biggest impact of using Event Modeling is the flat cost curve of the average feature cost. This is due to the fact that the effort of building each workflow step is not impacted by the development of other workflows."

**Key Insight**: When you have explicit contracts, teams can work independently.

```
Team A builds Step 1 (Create Order)
  - Produces: OrderCreated event with specific fields
  - Contract: "If OrderCreated exists, these fields are guaranteed"

Team B builds Step 2 (Confirm Order)
  - Precondition: OrderCreated event exists
  - Can start IMMEDIATELY while Team A finishes
  - Mocks OrderCreated event in tests
  - When Step 1 ready, tests pass immediately

Team C builds Step 3 (Authorize Payment)
  - Precondition: OrderConfirmed event exists
  - Can start immediately
  - Works independently

Result: 3 features in parallel instead of sequential!
Cost per feature: Constant
Delivery speed: 3x faster
```

## Velocity-Based Estimation

Instead of story points, estimate using workflow steps.

### Measuring Velocity

```
Definition: Velocity = Number of workflow steps completed per sprint

Example Sprint:
Week 1:
    Team A: Completed CreateOrder command (1 step)
    Team B: Completed ConfirmOrder command (1 step)
    Team C: Completed AuthorizePayment processor (1 step)

Velocity: 3 workflow steps per sprint

Historical data:
Sprint 1: 3 steps
Sprint 2: 3 steps
Sprint 3: 2 steps (one complex step slowed us down)
Sprint 4: 3 steps

Average velocity: ~3 steps per sprint
```

### Estimating Projects

```
New Feature: E-Commerce with Reviews

Event Model:
Workflow steps identified:
    Step 1: Create Order
    Step 2: Confirm Order
    Step 3: Authorize Payment
    Step 4: Reserve Inventory
    Step 5: Create Shipment
    Step 6: Deliver Package
    Step 7: Submit Review
    Step 8: Moderate Review
    Step 9: Calculate Ratings (read model)

Total: 9 workflow steps

Team velocity: 3 steps per sprint

Estimate: 9 ÷ 3 = 3 sprints = ~12 weeks

Without Event Modeling:
    - Estimate: 4-6 months (guess)
    - Actual: Often 6-9 months due to coupling issues

With Event Modeling:
    - Estimate: 3 sprints (confident)
    - Actual: Usually matches or beats estimate
```

### Benefits of Velocity-Based Estimation

1. **Empirical**: Based on actual history, not guesses
2. **Objective**: Not influenced by opinion
3. **Consistent**: Same factors each time
4. **Scalable**: Works for teams and organizations
5. **Improvable**: You can identify and fix bottlenecks

## Project Planning Spreadsheet

```
Project: Order Management System
Team Velocity: 3 steps per sprint

Feature Planning:

 Feature                              Steps  Sprints   Timeline 

 Core Order Flow                        3    1 sprint  Week 1-4 
 Payment Processing                     2    1 sprint  Week 5-8 
 Inventory Management                   2    1 sprint  Week 9-12
 Fulfillment & Shipping                 2    1 sprint  Week 13-16
 Order Tracking (read model)            1    0.3 spr   Week 17  
 Customer Reviews                       2    1 sprint  Week 18-21
 Analytics Dashboard                    1    0.3 spr   Week 22  

 TOTAL                                 13    4 sprints ~22 weeks


With parallel teams:
  - Team A: Weeks 1-4 (Orders)
  - Team B: Weeks 1-4 (Payments) ← Parallel!
  - Team C: Weeks 1-4 (Inventory) ← Parallel!
  - Team D: Weeks 5-8 (Fulfillment) ← After steps 1-3

Result: All work done in ~8 weeks with proper parallelization
Without parallelization: ~22 weeks (1 team, sequential delivery)
```

## Scaling to Organization Level

### Velocity per Team

```
Organization has 3 teams:

Team A (Order Processing): 3 steps/sprint
Team B (Payment): 2 steps/sprint
Team C (Fulfillment): 3 steps/sprint

Organization velocity: 8 steps/sprint

Can deliver projects worth 8 workflow steps in parallel per sprint!
```

### Multi-Team Project Planning

```
Large Project: Complete E-Commerce Platform

Identify all workflow steps:
Phase 1 (must complete first):
    - Create Order (Step 1)
    - Confirm Order (Step 2)
    - Authorize Payment (Step 3)
    → 3 steps, 1 sprint with 3 teams

Phase 2 (depends on Phase 1):
    - Reserve Inventory (Step 4)
    - Create Shipment (Step 5)
    - Deliver Package (Step 6)
    → 3 steps, 1 sprint with 3 teams

Phase 3 (independent from 1-2):
    - Customer Reviews (Step 7-8)
    - Rating Calculations (Step 9)
    → 3 steps, 1 sprint with 3 teams

Total: 9 steps, 3 sprints, 3 teams working in parallel = 3 sprints total

Without parallelization: 9 steps × 1 team = 9 sprints sequential
With proper contracts: 3 sprints with 3 teams
Speedup: 3x faster!
```

## Handling Variable Complexity

Some workflow steps are more complex:

```
Typical workflow step: 1 week, 1 developer
Complex workflow step: 2 weeks, 1-2 developers
Simple workflow step (read model): 0.5 weeks, 1 developer

Velocity calculation (realistic):
Sprint 1:
    - CreateOrder (typical): 1 step
    - ComplexPaymentValidation (complex): 0.5 steps
    - Notifications (simple): 1 step
    → Velocity: 2.5 steps/sprint

Using this more accurate velocity:
  9-step project = 9 ÷ 2.5 = 3.6 sprints
More realistic estimate!
```

## Capacity Planning

```
Team has 1 developer available
Velocity: ~2.5 steps/sprint

Project needs 13 workflow steps delivered
Timeline: 13 ÷ 2.5 = 5.2 sprints = ~5.5 months

Add another developer:
Team velocity: ~5 steps/sprint
Timeline: 13 ÷ 5 = 2.6 sprints = ~2.5 months
Cost reduction: 50% reduction in calendar time

Add processes/tools:
Better test infrastructure: +0.5 steps/sprint
Better CI/CD: +0.5 steps/sprint
New velocity: ~6 steps/sprint
Timeline: 13 ÷ 6 = 2.2 sprints = ~2 months
```

## Common Estimation Mistakes

###  Mistake 1: Counting All Features as Equal Weight

```
Wrong: "Feature A = 8 points, Feature B = 8 points" (same complexity?)
Right: "Feature A = 3 workflow steps, Feature B = 5 workflow steps"
       (Different complexity reflected)
```

###  Mistake 2: Including Non-Workflow-Step Work

```
Wrong: "8 points for order system" (includes meetings, planning, docs)
Right: "5 workflow steps for order system" (measure implementation only)
       Add separate budget for: Planning (1 week), Testing (1 week), Deployment (0.5 week)
```

###  Mistake 3: Ignoring Workflow Step Dependencies

```
Wrong: "Project = 10 steps, 2 teams, 5 sprints"
Right: Identify dependencies:
       - Steps 1-3 can run in parallel (3 sprints)
       - Steps 4-5 depend on 1-3 (sequential after)
       - Steps 6-10 can run in parallel with 4-5
       → 5-6 sprints with proper dependency management
```

## Retrospectives & Velocity Improvement

Use completed projects to improve estimation:

```
Sprint Retrospective:

Planned: 3 workflow steps
Completed: 2.5 workflow steps
Blocking issue: "Couldn't start step C until step B was fully integrated"

Action: Better integration earlier → Next sprint, improve parallelization

Track over time:
Sprint 1 velocity: 2.5
Sprint 2 velocity: 2.8 (better parallelization)
Sprint 3 velocity: 3.2 (developers more comfortable with patterns)
Sprint 4 velocity: 3.0 (added new junior developer, slower)

Trend: Improving as team gets comfortable (minus new hires)
```

## Key Metrics

| Metric | Calculation | What It Tells You |
|--------|-----------|-------------------|
| **Velocity** | Workflow steps completed / sprint | Team throughput |
| **Step Complexity** | Actual time / 1 week | Which steps take longer |
| **Parallelization Rate** | Teams working on independent steps / total teams | How well we're using resources |
| **Estimation Accuracy** | Planned steps / completed steps | How good our estimates are |

## Summary: From Estimates to Reality

```
Traditional Approach:
Project scope → [Guess complexity] → Estimate → [Often wrong]

Event Modeling Approach:
Project scope → [Count workflow steps] → [Use historical velocity] →
Estimate → [Usually accurate] → Deliver on time

Traditional accuracy: ±50% (at best)
Event Modeling accuracy: ±10% (with historical data)
```

## Further Reading

- Article section: "Flat Cost Curve"
- Article section: "Estimates without Estimating"
- Article section: "Strong Contracts"
