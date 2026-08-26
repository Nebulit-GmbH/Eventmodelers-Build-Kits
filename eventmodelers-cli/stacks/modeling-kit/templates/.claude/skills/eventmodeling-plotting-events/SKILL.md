---
name: eventmodeling-plotting-events
description: "Step 2 of Event Modeling - Arrange events chronologically in logical narrative sequence. Create timeline showing event flow and dependencies. Use after brainstorming events. Do not use for: brainstorming new events (use eventmodeling-brainstorming-events) or designing command/read model architecture (use eventmodeling-designing-event-models)."
allowed-tools:
  - Write
  - Bash
---

# Plotting Events

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

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

Prefer MCP:
```
mcp__eventmodelers__get_nodes { "boardId": "$BOARD_ID", "type": "CHAPTER" }
```

**Fallback (no MCP):**
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

Reuse existing empty columns, do not blindly create new ones. "Empty" means no EVENT anywhere in that column — **never place two EVENT nodes in the same column, even across different swimlanes**; each column is a single moment in the timeline. If the column already holds an EVENT in another swimlane, place this one in a new column instead (see `place-element`'s one-EVENT-per-column rule).

**Do not resolve that conflict by checkerboarding.** When a chapter has more than one swimlane (e.g. a second system's events, see `eventmodeling-brainstorming-events`'s Swimlane Rules), the chapter's own swimlane carries the continuous story throughout — do not alternate "our event, their event, our event, their event" column by column just because each needs its own column, and do not give the other swimlane a multi-column run of its own either. An event in the other swimlane is a single-column handover: it marks one moment where control passes to the other system, and the very next column returns to this chapter's own swimlane to continue the story. Two swimlanes trading events every column with no genuine trigger behind each handover is a sign of forcing visual symmetry rather than following the actual causal order — re-sequence instead. If the other swimlane ends up needing a long run of its own consecutive events, that's a sign those events belong in a chapter of their own, not this one.

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
