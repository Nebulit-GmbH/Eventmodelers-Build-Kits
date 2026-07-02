# Event Modeling Slice Patterns

## Table of Contents
- [Slice Definition Template](#slice-definition-template)
- [Cross-Slice Communication Patterns](#cross-slice-communication-patterns)
- [Tips for Effective Slicing](#tips-for-effective-slicing)

---

## Slice Definition Template

Use this template for each slice:

```
Slice: [CommandName | ReadModelName | AutomationName]
Type: state-change | state-view | automation

COMMAND (state-change/automation only): [name] — what it does
READMODEL (state-view only): [name] — what it shows

EVENTS PRODUCED:
  - [Event]: when it occurs

EVENTS CONSUMED:
  - [Event from another slice]: why needed

UPSTREAM DEPENDENCIES:
  - [Slice X]: needed because it produces [Event]

DOWNSTREAM DEPENDENTS:
  - [Slice Y]: consumes [Event] we produce
```

---

## Cross-Slice Communication Patterns

### Pattern 1: Command Slice → Event → Command Slice

```
Slice: PlaceOrder (state-change)
  produces OrderPlaced
       ↓
Slice: ConfirmOrder (state-change)
  its command validates against OrderPlaced (via its own state projection)
```

Advantages: loose coupling, asynchronous, each slice owns its own state — no shared state class between them.

### Pattern 2: Command Slice → Event → Read Model Slice

```
Slice: PlaceOrder (state-change)
  produces OrderPlaced
       ↓
Slice: OrderDetailView (state-view)
  projects OrderPlaced into its read model
```

This is the most common dependency: nearly every state-view slice depends on the events produced by one or more state-change slices. The state-view slice can be developed in parallel, but its projections only produce data once the upstream events exist.

---

## Tips for Effective Slicing

### 1. One Element Per Slice

```
CORRECT:
Slice: PlaceOrder (state-change) — just the PlaceOrder command
Slice: OrderDetailView (state-view) — just the OrderDetailView read model

WRONG:
Slice: "Order Management" containing the PlaceOrder command AND the OrderDetailView read model
Problem: mixes a state-change and a state-view in one slice — the API models
these as different slice types for a reason.
```

### 2. Name the Slice After Its Element

Use the exact command, read model, or automation title as the slice title — don't invent a broader "feature" name that spans multiple elements.

### 3. Express Dependencies as Events, Never as Shared State

Slices never call each other directly and never share a state class. If slice B needs something from slice A, it's because slice B's command or read model projects an event that slice A produces — not because they're coupled at the code level.