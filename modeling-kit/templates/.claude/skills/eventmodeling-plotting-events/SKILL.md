---
name: eventmodeling-plotting-events
description: "Step 2 of Event Modeling - Arrange events chronologically in logical narrative sequence. Create timeline showing event flow and dependencies. Use after brainstorming events. Do not use for: brainstorming new events (use eventmodeling-brainstorming-events) or designing command/read model architecture (use eventmodeling-designing-event-models)."
allowed-tools:
  - Write
  - Bash
---

# Plotting Events

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

Arrange all brainstormed events chronologically to create a logical sequence that makes sense as a narrative timeline. Show how events flow and depend on each other.

## Workflow

Given a list of brainstormed events, create the chronological plot:

### 1. Sequence Events Chronologically
Order events in time-based narrative:
- What happens first?
- What depends on what?
- What's the causal chain?

Format:
```
Timeline: Order Processing

1. Customer initiates → OrderCreated
   (Event: OrderCreated)

2. Order confirmed → OrderConfirmed
   Depends on: OrderCreated happened
   (Event: OrderConfirmed)

3. Payment processed → PaymentAuthorized
   Depends on: OrderConfirmed happened
   (Event: PaymentAuthorized)

4. Inventory reserved → InventoryReserved
   Depends on: PaymentAuthorized happened
   (Event: InventoryReserved)

5. Order shipped → OrderShipped
   Depends on: InventoryReserved happened
   (Event: OrderShipped)

6. Delivery confirmed → DeliveryConfirmed
   Depends on: OrderShipped happened
   (Event: DeliveryConfirmed)
```

### 2. Show Dependencies and Causality
Document what triggers each event:
```
Event: OrderConfirmed
Can only happen after: OrderCreated
Triggered by: Customer confirms order
Precondition: Order in Draft state

Event: PaymentAuthorized
Can only happen after: OrderConfirmed
Triggered by: Payment gateway authorizes
Precondition: Order confirmed and payment submitted
```

### 3. Identify Alternative Paths
Show events that can diverge:
```
After OrderCreated:
Path A: Customer confirms → OrderConfirmed
Path B: Customer cancels → OrderCancelled

After PaymentAuthorized:
Path A: Payment succeeds → PaymentProcessed
Path B: Payment fails → PaymentFailed → OrderCancelled
```

### 4. Create Timeline Diagram
Visual representation of event flow:

```

 Time →                                           

 OrderCreated                                     
    ↓                                             
 OrderConfirmed                                   
    → PaymentAuthorized                          
        → InventoryReserved                     
            → OrderShipped                     
                 → DeliveryConfirmed           
        → PaymentFailed → OrderCancelled        
    → OrderCancelled (rejected before payment)   

```

## Chapters and Timelines

Timelines (chapters) are **created and assigned during Step 1 (Brainstorming)**. This step does not create new chapters. Each plotting pass operates on a **single timeline** — the one the user is currently focusing on.

Before placing events, resolve the target timeline:

```bash
curl -s -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER"
```

If multiple timelines exist, ask the user which one to work on now. Never reorder events across timelines in a single pass.

## Output Format

Instead of writing a markdown document, **place every event on the board** using the `place-element` skill.

Work within the chosen timeline only. For each event in the final chronological order, invoke `place-element` with:

| Parameter | Value |
|-----------|-------|
| `elementType` | `EVENT` |
| `title` | `<EventName>` |
| `boardId` | `BOARD_ID` |
| `timelineId` | the chapter this event belongs to |

Reuse existing empty columns, do not blindly create new ones.

Process events in order, one at a time. Do not skip any event.

After all events are placed, summarise to the user:
- Chapter(s)/timeline ID(s) with their titles
- Numbered list of events placed per chapter
- Key insights: critical path, decision points, terminal events
- Any errors

## Quality Checklist

- [ ] **Working on a single named timeline** — not mixing events from different chapters
- [ ] **No new chapters created here** — chapter structure was fixed in Step 1 (Brainstorming)
- [ ] Every event has clear predecessor
- [ ] Dependencies are explicitly documented
- [ ] Alternative paths are shown
- [ ] Flow forms a coherent narrative
- [ ] No events without trigger
- [ ] Terminal states are clear
- [ ] Compensation/cancellation flows are complete
- [ ] Timeline makes business sense

## Principles

1. **Narrative Coherence**: Events tell a story
2. **Dependency Clarity**: What must come before what
3. **Alternative Paths**: Show all possible flows (happy path + errors)
4. **Natural Sequence**: Order matches business domain logic
5. **Completeness**: Every brainstormed event appears
