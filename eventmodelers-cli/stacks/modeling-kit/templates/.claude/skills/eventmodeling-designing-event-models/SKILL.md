---
name: eventmodeling-designing-event-models
description: "Designs the event model for a business process — maps Commands, Events, and Read Models with clear causality. Events are business facts; Read Models are projections built from them. Use when designing the Command/Event/Read-Model structure from domain analysis. Do not use for: brainstorming events from scratch (use eventmodeling-brainstorming-events), or checking whether an event belongs to the right entity/timeline (use eventmodeling-optimizing-stream-design)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Designing Event Models

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

## Purpose

Converts domain analysis into the event modeling structure:

**UI/Processor** → **Command** → **Event** → **Read Model** → **UI/Processor**

- **UI/Processor**: entry points that trigger intent
- **Command**: business intent, expressed in business language, can be rejected
- **Event**: a business fact — the result of a successful command
- **Read Model**: a projection of events, shaped for a specific query need

## Workflow

Given a domain analysis, design the event model:

### 1. Design Events

Events are business facts, not technical occurrences:
- **Event Type**: what changed, in past tense business language (Created, Confirmed, Shipped)
- **Event Data**: the business fields, noting which came directly from the triggering command versus which are implicit context (e.g. a calculated total, or the entity's identity)
- **Causality**: which command triggered it

Document each entity's events as a chronological list, giving each event's triggering command and its data. A full worked example (an Order) is in `references/examples.md`.

**Key Rules**:
- Events are immutable business facts
- Events use past tense, business language
- Event order matters — it tells the story
- Never modify or delete an event once it exists
- Events only exist if the triggering command succeeded

### 2. Design Commands

Commands are business intent from a UI or Processor:
- Represent what a user or system wants to do
- Can be rejected (validation failure)
- Only a UI or Processor can issue a command
- Produce events if valid, or reject if invalid

Document each command's source, its input fields, the preconditions it's checked against, the event(s) it produces on success (noting which data comes from the command versus implicit context), and its rejection outcomes. A full worked example (ConfirmOrder) is in `references/examples.md`.

**Key Rules**:
- Only a UI or Processor can issue commands (entry points)
- One command per UI/Processor action
- Successful command → Event(s) created
- Failed validation → Command rejected, no event

### 3. Design Read Models

Read models are projections of events, built for UI/Processor queries:
- Built from events (their only source)
- Optimized for a specific query pattern
- Consumed by UI (for display) or Processor (for a decision)
- Can be regenerated from events at any time

Document each read model's purpose, which events it subscribes to, its query-shaped data, how each subscribed event updates that data, and who consumes it. A full worked example (OrderSummaryView) is in `references/examples.md`.

### 4. Document Event Causality

Trace the causal chain from the first command through the events and downstream commands it can trigger, showing how a later command's decision depends on events produced earlier. A full worked example (an Order create→confirm→ship chain) is in `references/examples.md`.

### 5. Document State Transitions

Map the valid states a process can be in, which command causes which transition, and which transitions are invalid from a given state (e.g. cancelling an already-shipped order), ending at any terminal states. A full worked example (Order transitions) is in `references/examples.md`.

### Output Format

Present the complete model as a markdown document with sections for Events (per entity, chronological, each with its triggering command), Commands (input, preconditions, events produced, rejection outcomes), and Read Models (purpose, subscribed events, consumers). A full worked example of this document structure is in `references/examples.md`.

## Key Principles

See `eventmodeling-core-rules` for the element definitions and causality rules this design must follow (events are immutable facts, commands are checked against documented preconditions, read models never drive command validation).

## Quality Checklist

- [ ] All events are immutable business facts (past tense)
- [ ] Events contain only captured business data, no computed fields
- [ ] Each command's preconditions are documented explicitly
- [ ] Commands either produce events or are rejected — no silent failures
- [ ] Event causality is clear and traceable end to end
- [ ] State transitions are documented, including which ones are invalid and why
- [ ] Read models are optional — nothing requires one to exist
