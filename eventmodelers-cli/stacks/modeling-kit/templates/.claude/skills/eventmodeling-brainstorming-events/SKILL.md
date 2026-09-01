---
name: eventmodeling-brainstorming-events
description: "Step 1 of Event Modeling - Brainstorm all domain events from requirements. Extract every state-changing event the system could have. Use when starting event modeling from requirements or a new domain. Do not use for: arranging events in sequence (use eventmodeling-plotting-events), designing commands or read models (use eventmodeling-designing-event-models), or when a complete event list already exists."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Brainstorming Events

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has provided detailed, well-documented requirements (written user stories, feature specs, business rules) and named who understands the domain. Interview when requirements are vague, incomplete, or domain expertise is uncertain.

### Critical Questions

1. **Requirements Completeness** (Impact: Determines if brainstorm is likely to be exhaustive)
   - Question: "How complete are your requirements? Do you have: (A) Written user stories/specs, (B) Documented business rules, (C) Rough list, (D) Just verbal descriptions?"
   - Why it matters: Incomplete requirements cause missed events; complete requirements enable comprehensive brainstorm
   - Follow-up triggers: If (C) or (D) → probe for missing scenarios; if rules aren't documented → ask team to state them explicitly

2. **Domain Expertise & Familiarity** (Impact: Shapes who should participate and what guidance is needed)
   - Question: "Who understands this domain best? (A) Product/Domain expert leading brainstorm, (B) Engineering team figuring it out, (C) Mix of roles"
   - Why it matters: Domain expert participation dramatically improves event completeness; solo engineering leads to gaps
   - Follow-up triggers: If (B) → recommend inviting domain expert; if (C) → ask how decisions will be made

3. **Known Complexity Areas** (Impact: Determines where to focus brainstorming effort and depth)
   - Question: "Are there specific areas known to be complex or error-prone? (e.g., payment processing, state transitions, business rules)"
   - Why it matters: Complex areas often have hidden events; identifying them upfront ensures they're covered
   - Follow-up triggers: For each complex area → ask "What are the edge cases? What can go wrong?"

4. **Explicit Business Rules & Constraints** (Impact: Ensures no implicit assumptions; may reveal missing events)
   - Question: "What are critical business rules that govern this domain? (e.g., 'orders can only be cancelled within 24 hours', 'payments must be authorized before confirmation')"
   - Why it matters: Business rules often generate specific events; documenting them prevents overlooking state changes
   - Follow-up triggers: For each rule → ask "When this rule is violated, what event signals that?"

Follow **`eventmodeling-interview-protocol`** to run this interview and record its findings — label this step "**2. Brainstormed Events** (`eventmodeling-brainstorming-events`)". Findings should cover: requirements completeness, domain expertise available, the Role Catalog, entities/event timelines identified, business rules & constraints, and brainstorming focus areas — this feeds directly into plotting and storyboarding.

---

## Board Context

Before brainstorming, check for EVENT nodes already on the board to avoid duplicating events from a previous session:

**Prefer MCP:**
```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "EVENT" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Board Context — Check existing EVENT nodes".

If events already exist, treat them as the starting list and focus on discovering what might be missing. Also check for existing chapters (timelines) so you can reuse them:

**Prefer MCP:**
```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Board Context — Check existing CHAPTER nodes".

## Timeline Discovery (Mandatory Before Placing Any Event)

Brainstorming is where timelines are discovered. **Every event must be placed into its dedicated timeline — never into a generic or unnamed chapter.** Later steps (storyboarding, commands, scenarios) operate on one timeline at a time; the chapter structure set here drives that entire downstream focus.

### 1. Group events by workflow / bounded context

After completing the analysis, partition the full event list into groups where each group:
- Represents a single, coherent business process (e.g., Catalogue Management, Reservation, Overdue & Payments)
- Can be understood as a standalone narrative on its own
- Would be naturally owned by one team or one domain expert

If all events belong to a single flow, one timeline is correct — do not split artificially.

**Divergent journey vs. a decision point — do not confuse the two.** A group of events sometimes contains a branch, and the branch's nature decides whether it gets its own chapter or stays inside this one:

- **Divergent journey → its own chapter.** The actor makes a different choice *before* the process even starts, and everything downstream differs as a result (e.g. "Checkout with saved card" vs. "Checkout as guest" — different screens, different commands, arguably a different Role Catalog entry). Group these as separate workflows in Step 1, not as one group with a fork in it.
- **Decision point → stays in this one chapter.** A single trigger — one command's outcome, or one automation's rule — resolves to one of several mutually exclusive results, and the rest of the process is otherwise the same story (e.g. `PaymentAuthorized` succeeds or fails, `OrderConfirmed` vs. `OrderCancelled` after the same confirm action). Keep this as one group; `eventmodeling-plotting-events`'s "Identify Alternative Paths" step is exactly where this branch gets shown, as sibling paths within the same timeline — it never means a second chapter.

If unsure which one you're looking at, ask: "does this branch start a genuinely different story, or does it just decide how *this* story ends?" A different story is a new chapter; a different ending is a branch inside this one.

### 2. Create one chapter per group

For each group, create a chapter on the board **before placing any events**. Reuse an existing chapter if one already matches the workflow name.

**Prefer MCP — create a chapter:**
```
mcp__eventmodelers__create_chapter { "boardId": "<BOARD_ID>", "x": 0, "y": 1200, "columns": <numberOfEventsInGroup> }
```
(`x`/`y` are optional — see the vertical-stacking note below. `columns` is optional too — the group's event count is already known at this point, so pass it here to create the chapter with exactly the columns this group needs, instead of the default 3 plus a follow-up `add_column` batch. Response includes the new `timelineId` and `columnIds` — one id per column, left to right, ready to use directly in Step A below.)

**Fallback (no MCP):** see `references/api-fallback.md` — "Timeline Discovery — Step 2: Create one chapter per group — create the chapter".

**Immediately set its title** (use the workflow / bounded-context name):

**Prefer MCP:**
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<uuid>",
    "eventType": "node:changed",
    "nodeId": "<chapterId>",
    "boardId": "<BOARD_ID>",
    "timestamp": 1234567890,
    "meta": {"type": "CHAPTER", "title": "Reservation & Lending"}
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Timeline Discovery — Step 2: Create one chapter per group — set its title".

**Stack timelines vertically so they do not overlap, and in general place new chapters close to existing ones they relate to.**
After creating each chapter, position it below the previous one. Use `y = index * 1200` (0-based creation order), `x = 0`. If existing chapters are already on the board, query their positions first. Prefer placing the new chapter directly below the existing chapter it is most closely related to (e.g. the same bounded context or an adjacent workflow), rather than mechanically appending below the lowest one — this keeps related chapters visually near each other on the canvas. Only fall back to `y = maxExistingY + 1200` when no related chapter exists yet. Pass this directly as `x`/`y` on `create_chapter` above, or reposition an existing chapter with:

**Prefer MCP:**
```
mcp__eventmodelers__move_timeline_position { "boardId": "<BOARD_ID>", "timelineId": "<TL>", "x": 0, "y": 1200 }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Timeline Discovery — Step 2: Reposition an existing chapter".

Record the mapping: `workflow name → chapterId`. Every subsequent event placement will reference this ID.

### 3. Place each event into its chapter

When creating an EVENT node, always set `chapterId` to the matching chapter from step 2. No event may be placed without a `chapterId`.

## Event Fields (Mandatory)

When creating EVENT nodes on the board via `node:created`, you **must** include the event's key fields in `meta.fields`. An event without fields is an opaque label — it cannot be used to validate completeness, write scenarios, or generate code.

Fields use this structure inside `meta`:

```json
{
  "type": "EVENT",
  "title": "OrderPlaced",
  "fields": [
    {"name": "orderId",    "type": "String",   "example": "order-abc123"},
    {"name": "customerId", "type": "String",   "example": "cust-456"},
    {"name": "total",      "type": "Decimal",  "example": "149.99"},
    {"name": "status",     "type": "String",   "example": "Draft"},
    {"name": "placedAt",   "type": "DateTime", "example": "2026-05-29T10:00:00Z"}
  ]
}
```

**Rules for fields:**
- Start with **essential fields only** — the identity key(s) plus the one or two facts that make this event meaningful. Do not try to enumerate every field a consumer might eventually want; that enrichment happens later via `/attributes`.
- Use domain names, not technical names (`memberId` not `userId`, `dueDate` not `due_at`)
- Do **not** include computed or derived values — those belong in read models
- If an event has no meaningful payload beyond its identity (e.g., a simple state transition), it is fine to have no fields or just the identity key
- Do not pad events with fields just to reach a count — only add what the business needs
- Every field must set `"cardinality"` — use `"Single"` unless the field is genuinely a list of values, in which case use `"List"`. Default to `"Single"` when unsure.

## Cell Placement

Brainstorming events has two modes. Choose based on whether the chapter (timeline) already exists.

### Mode A — Brainstorming inside a timeline (chapter exists)

When a chapter is available, place each event directly into it. **Include `cellId` in `node:created`** — without it the node has no cell reference and will appear stranded at position 0,0 on the canvas.

**Step A — Ensure enough columns exist, in a single call** (append at end of the chapter). Skip this step entirely if the chapter was just created above with `columns` already set to this group's event count. Otherwise (an existing/reused chapter, or one created without `columns`) — the number of events to place is already known from the brainstormed list, so pass it as `count` instead of calling `add_column` once per event:

**Prefer MCP:**
```
mcp__eventmodelers__add_column { "boardId": "<BOARD_ID>", "timelineId": "<CHAPTER_ID>", "count": <numberOfEvents> }
# → { "columnId": "<firstColUuid>", "index": <n>, "totalColumns": <n>, "columnIds": ["<col1>", "<col2>", ...] }
```
Use `columnIds[i]` for the i-th event in Step C below. (Omit `count`, or pass `1`, for a single event — `columnIds` is only present when `count > 1`.)

**Fallback (no MCP):** see `references/api-fallback.md` — "Mode A — Step A: Ensure enough columns exist".

**Step B — Fetch the chapter to find the swimlane row ID** (only needed once per chapter):

**Prefer MCP** — `projection: "cells"` returns just `{rows, columns, cells}`, not the whole chapter node:
```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Mode A — Step B: Fetch the chapter to find the swimlane row ID".

**Step C — Compute, for the i-th event:** `cellId = swimlaneRow.id + "-" + columnIds[i]` (or the single `columnId` if only one column was created)

**Step D — Create the event with `cellId`.**

**Prefer MCP** — pass the same shape to `submit_node_events` (`events` is a tool arg, not a `-d` body):
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>",
    "eventType": "node:created",
    "nodeId": "<node-uuid>",
    "boardId": "<BOARD_ID>",
    "timestamp": 1234567890,
    "chapterId": "<chapterId>",
    "cellId": "<swimlaneRowId>-<columnId>",
    "meta": {
      "type": "EVENT",
      "title": "BookReserved",
      "fields": [
        {"name": "reservationId", "type": "String",   "example": "res-789"},
        {"name": "copyId",        "type": "String",   "example": "copy-42"},
        {"name": "memberId",      "type": "String",   "example": "mbr-101"},
        {"name": "expiresAt",     "type": "DateTime", "example": "2026-06-01T00:00:00Z"},
        {"name": "reservedAt",    "type": "DateTime", "example": "2026-05-29T10:00:00Z"}
      ]
    }
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Mode A — Step D: Create the event with cellId".

> **Never call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first. `node:created + cellId` is the only placement step needed.

> **One EVENT per column (hard rule).** A column is a single moment in the timeline — never place two EVENT nodes in the same column, even when they sit in different swimlane rows (e.g. two systems under Conway's Law). Step A above always appends a fresh column per event, which already satisfies this; if you ever reuse an existing column instead of appending, first confirm no swimlane row in that column already holds an EVENT. **Don't resolve this by checkerboarding across swimlanes** — see "Swimlane Rules (Mandatory)" below: this chapter's own swimlane carries the continuous story; the other swimlane only ever gets an isolated single-column handover, then the story resumes back in this swimlane.

### Mode B — Free-form brainstorming (no chapter yet)

When chapters have not been created yet, events may be created without `chapterId` or `cellId`. They appear as free-floating sticky notes on the canvas. This is valid during open discovery.

**After free-form brainstorming completes**, all events MUST be assigned to a named chapter before Step 2 (Plotting) can begin:
- Group events into workflows / bounded contexts (see "Timeline Discovery" above)
- Create one chapter per group
- Move each event into its chapter using `node:changed` to set `chapterId` and `cellId`

An event left without a chapter and cell reference will never appear in any timeline column and cannot be sequenced, storyboarded, or used in scenarios.

## Swimlane Rules (Mandatory)

**Use swimlanes sparingly — a swimlane exists for exactly one purpose: marking where integration with another system happens. Nothing else justifies one.** Not a different actor, not a different role, not visual grouping, not "an explicit business rule" in the abstract. Every chapter starts with, and in the common case keeps, a single default swimlane holding all of this bounded context's own domain events. Before adding a lane, check whether an existing lane already covers the element's type. If yes, place the element in that lane.

**The only valid reason to create a second `swimlane`-type lane: another system's own events cross into this chapter as integration triggers for a translation automation** (see `eventmodeling-designing-automation-chains`, Step 4b). Label it for that system and place its trigger events there — never fold them into this chapter's own event swimlane (they are not this bounded context's domain facts) and never treat them as an informal "signal" with no EVENT node at all. An external EVENT may only ever open the *translation* automation's todo list — never the todo list of the automation that does the actual domain work; that automation is triggered solely by the internal event the translation automation produces, and only exists at all when reacting to that internal event genuinely requires a new decision (Step 4b covers the full translation chain, and when a worker automation belongs after it).

**Never** add a swimlane for any other reason — not a new actor, not a new role, not visual grouping. Human roles get their own **actor** lane during Step 3 (Storyboarding) — a different row type entirely — never a new swimlane here.

**When two swimlanes exist side by side, tell a continuous story from this chapter's own swimlane as much as possible — don't checkerboard between them.** Having a second swimlane for an external system does not mean every other column should alternate between "our event" and "their event." Keep a run of consecutive columns in this chapter's own swimlane while the domain process is unfolding, and only place an event in the external swimlane where a real cross-system trigger occurs (the external system reacting to, or producing, an event that actually drives the next step of this chapter's process). If two adjacent columns each have an event in a different swimlane but neither one triggers or is triggered by the other, that's a sign the events were placed for visual symmetry rather than because the story actually crossed system boundaries there — revisit the plotting instead.

**An event in the other swimlane is a handover, not a relocation.** It marks a single moment where control passes to the other system — it does not mean the narrative now belongs to that swimlane for a run of columns. Immediately after the handover column, the story resumes in *this* chapter's own swimlane (the next column back in this swimlane), not in the other one. The other swimlane should typically show isolated, single-column events at each genuine handover point, never a multi-column stretch of its own — a long run of consecutive events in the external swimlane is a sign the events belong in a chapter of their own, not this one's.

---

## Workshop Facilitation Guide

**Setting**: This is a collaborative brainstorming workshop — the facilitator guides participants to envision the system and extract events rapidly. See `references/facilitating-event-modeling-workshops.md`'s "Step 1: Brainstorming Events" section for the full facilitation flow (goals framing, free brainstorm, gentle filtering, example dialogue) and general facilitation techniques (handling personalities, pacing, disagreement) that apply throughout.

**The core move, in brief**: ask participants for any event they can think of, capture everything without filtering first, then gently introduce the state-changing test ("did this actually change something?") to separate real events from actions/notifications/internal checks — see the reference for the full example dialogue and phrasing tips.

## Workflow

When given domain requirements, perform the following analysis:

### 1. Identify User Roles & Actors (MANDATORY)

Before brainstorming events, define **who** interacts with the system. Every event model needs an explicit role catalog — without it, downstream steps (storyboarding, commands, scenarios) lack clarity on who does what.

Identify all human roles and system actors:
- **Human roles**: Customer, Seller, Admin, Support Agent, Reviewer, etc.
- **System actors**: Payment Gateway, Inventory System, Notification Service, Scheduler, etc.

For each role/actor, document:
- **Name**: Use domain language (e.g., "Seller" not "User Type B")
- **Description**: What this role does in the domain (1-2 sentences)
- **Key actions**: What state changes can this role initiate?
- **Permissions boundary**: What can this role NOT do?

Present as a Role Catalog: for each human role, its name (in domain language), a one-line description, its key actions, and what it explicitly cannot do; for each system actor, its name, whether it's internal or external, what triggers it, and how it communicates (webhooks, event-driven, API). A full worked example (E-commerce domain) is in `references/examples.md`.

This catalog feeds directly into:
- **Step 3 (Storyboarding)**: One actor lane per human role (not a swimlane — see Swimlane Rules above)
- **Step 4 (Inputs)**: Every command attributed to a specific role/actor
- **Step 7 (Scenarios)**: Scenarios reference roles by name
- **Step 8 (Completeness)**: Verify every role has at least one command path

### 2. Identify Entities (Event Timelines)
Identify the main entities whose story will be told as a timeline of events:
- User/Account
- Order
- Payment
- Shipment
- etc.

For each entity, note:
- Name (use domain language, not technical terms)
- Identity key (what uniquely identifies instances: orderId, paymentId, customerId, etc.)
- What commands will affect it

### 3. Identify Business Processes
Map out critical workflows:
- What steps does a user go through?
- What are the decision points?
- Where do systems integrate?

### 4. Extract State Changes
For each process, identify what state changes occur:
- Customer places order → Order created
- Payment processed → Order confirmed
- Item shipped → Order status changed

These become your domain events.

### 5. Document Business Rules & Constraints
- What rules govern state transitions?
- What validations must pass?
- What are the invariants?

Examples:
- "Order can only be shipped if payment is confirmed"
- "Inventory must be reserved before order confirmation"
- "Customer can only cancel within 24 hours"

### 6. Create Analysis Document

Present findings in this structure (include facilitation notes for future workshops):

```markdown
## Workshop Notes

**Participants**: [List roles: PO, Dev, QA, Domain Expert]
**Duration**: [Time spent]
**Key facilitation moments**: [What helped clarify understanding?]

---

# Domain Analysis: [Domain Name]

## Role Catalog

### Human Roles
1. **[Role Name]**: [Description]
   - Key actions: [What this role can do]
   - Cannot: [Permission boundaries]

### System Actors
1. **[Actor Name]** ([internal/external]): [Description]
   - Triggers: [What events/commands it initiates]
   - Communication: [Webhooks / Event-driven / API]

## Entities (Event Timelines)
List each entity and its identity:
- **Entity**: Review (Identity: reviewId)
- **Entity**: SellerResponse (Identity: responseId)
- **Entity**: Seller (Identity: sellerId)

Note: These are just the logical groupings of events — the story each entity's timeline tells.

## Business Processes
1. **Process Name**: Description
   - Actor: Who initiates?
   - Steps: 1. → 2. → 3.
   - Outcomes: What changes?

## Identified State Changes (Potential Events)
- [Stream] [Verb]: When? Why? (Use past tense: "ReviewPublished", "SellerResponseAdded")

## Business Rules & Constraints
- Rule 1: Condition and consequence
- Rule 2: Constraint description

## Questions for Domain Expert
- Any gaps in understanding?
- Unclear processes?
```

## Output Format
Present analysis in a clear markdown structure that can be directly used by the eventmodeling-designing-event-models skill.

## Key Principles
- Use **domain language**, not technical terms
- Focus on **what** happens, not **how** it's implemented
- Identify **state changes** as events, not actions (gently!)
- Document **constraints** and **rules**
- Be **specific** with examples from the requirements
- **Collaborative Process**: This is a group brainstorm, not a solo analysis
- **Rapid Iteration**: Capture quickly, refine later
- **Gentle Filtering**: Introduce "state-changing events" concept conversationally, not as rigid rule
- **Event Sourcing Mindset**: Think in terms of immutable events grouped by entity, not upfront attribute lists
- **Defer Detail**: Don't list all entity attributes upfront — commands, preconditions, and read models get worked out in the design step

## Best Practices for Requirements Analysis

### 1. Be Specific with Requirements
Provide concrete examples and clear scope:
- "Handle orders"
- "Orders have items, pricing, delivery address, and can be cancelled within 24 hours"

### 2. Use Domain Language
Use terms your business understands, not technical jargon:
- "obj1 references obj2"
- "Customer places Order with Products"

### 3. Document Constraints Explicitly
Make implicit rules explicit:
- "Process payments"
- "Authorize payment before marking order confirmed; refund if shipment fails"

### 4. Verify Role Catalog Completeness
Cross-check that the Role Catalog (from Step 1) covers all actors referenced in events and processes:
- "Orders can be created" (by whom?)
- "Customers can create orders; sellers can confirm stock; system can cancel if payment fails"

### 5. Cover Edge Cases
Include error and boundary conditions:
- "What happens if payment is declined?"
- "Can an order be modified after shipping starts?"
- "What triggers order cancellation?"

## Quality Checklist

- [ ] Every event is past tense and names a completed state change (e.g., `OrderPlaced`, not `PlaceOrder`)
- [ ] **Every event node includes `meta.fields` for all fields that are meaningful from a business perspective** — fields that consumers of this event will use
- [ ] Fields are only included when they add business value (an event with no payload fields is acceptable if the event title alone carries the meaning)
- [ ] Role Catalog lists every actor (human roles and system processors) with distinct responsibilities
- [ ] Each event can be traced back to a specific actor in the Role Catalog
- [ ] No CRUD events (`UserUpdated`, `RecordDeleted`) — events describe business moments, not database operations
- [ ] All known error and boundary conditions have corresponding events
- [ ] No empty columns left in the timeline
- [ ] Events group into at least one recognizable business process flow
- [ ] No overlapping event semantics — two events don't mean the same thing
- [ ] Every event is placed into a **named chapter** — no event left in an untitled or default timeline
- [ ] **Multiple chapters are stacked vertically** (y offset of 1200 per chapter) — no two chapters overlap on the canvas
- [ ] No unnecessary swimlanes created — a swimlane exists only to mark integration with another system; never added for a new actor, a new role, or visual grouping
- [ ] **When a second (external-system) swimlane exists, events follow one continuous story from this chapter's own swimlane throughout** — the external swimlane only ever holds isolated single-column handovers, never a run of its own, and the story resumes in this chapter's swimlane immediately after each one
