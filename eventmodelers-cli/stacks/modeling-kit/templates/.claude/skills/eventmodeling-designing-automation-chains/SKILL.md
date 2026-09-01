---
name: eventmodeling-designing-automation-chains
description: "Step 4b of Event Modeling - design every automation's todo-list read model and, for externally-triggered automations, its two-stage translation chain (external EVENT to internal EVENT). Runs immediately after eventmodeling-identifying-inputs places an AUTOMATION+COMMAND pair, before eventmodeling-identifying-outputs. Use right after Step 4 places any AUTOMATION. Do not use for: screen-facing read models (use eventmodeling-identifying-outputs), placing the automation's own COMMAND (use eventmodeling-identifying-inputs), or system/team boundary swimlanes (use eventmodeling-applying-conways-law)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Designing Automation Chains

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

This is **Step 4b**. It runs immediately after `eventmodeling-identifying-inputs` (Step 4) places an AUTOMATION and its COMMAND, and before `eventmodeling-identifying-outputs` (Step 5) designs any screen-facing read model. Designing an automation's todo list — and, when it applies, its translation chain — while the automation is still fresh from Step 4 is what prevents the alternative: discovering the gap only once Step 5's own verification pass runs, after commands and connections already built on top of the incomplete shape.

**Input**: Every AUTOMATION placed in Step 4, each already paired with its own COMMAND in the actor/interaction rows of one column (per `eventmodeling-orchestrating-event-modeling`'s Timeline Alignment Rules).
**Output to carry forward**: Every automation's todo-list READMODEL, placed and wired; every externally-triggered automation resolved into a two-stage translation chain (external EVENT → todo-list READMODEL → translation AUTOMATION+COMMAND+internal EVENT → worker automation's own todo list).
**Gate**: No AUTOMATION on the board lacks an incoming `READMODEL → AUTOMATION` connection to a todo-list read model, and no automation's todo list is opened directly by another system's (second-swimlane) event.

---

## Every automation needs a todo-list read model — no exemption

**Every AUTOMATION needs a todo-list read model — this is not optional, and there is no "pure relay" exemption.** An automation is a processor: it reacts to events, decides what work is outstanding, and issues commands to get that work done. The read model that tells it what's outstanding is its **todo list** — a queue of pending work items, not a snapshot of current entity state.

**The pattern**: one or more events *open* an item on the todo list (something now needs doing); one or more events *close* it (the work is done — remove the item). A todo list can be opened and closed by more than one event type on either side, and the set of opening events doesn't need to match the set of closing events in count or shape — whatever the domain calls for.

**Worked example**: an automation that reacts to `CustomerRegistered` by sending a welcome notification.
- Todo list: **NotificationsToSend** — one row per pending notification.
- `CustomerRegistered` **opens** a row (a notification now needs sending).
- `NotificationSent` (the event this automation's own resulting command produces) **closes** that row (removes it — the list only ever shows outstanding work).
- The automation (`Send Welcome Notification`) reads `NotificationsToSend`, and for every open row issues `SendNotification`.

Even an automation that looks like a "pure signal relay" still has a todo list — model it anyway: it documents that the automation is idempotent/complete once its own event fires, and keeps every automation consistent with the same `READMODEL → AUTOMATION → COMMAND → EVENT` pattern instead of silently exempting some as "too simple to need one."

## The translation-chain rule for external triggers

**There is no such thing as an invisible or informal "signal" — a trigger is always a real EVENT node**, placed in a second swimlane when it belongs to another system (see `eventmodeling-brainstorming-events`'s swimlane rule).

**An automation can only ever be directly triggered by an internal event — never by another system's event.** A "trigger" arriving from a second swimlane is not itself the thing that drives your domain's work; it first has to be *translated* into an internal event. Do not model this as one automation whose todo list is opened by the external EVENT and that also does the real work (e.g. an automation reading a todo list opened by `ReservationRequested` from another system's swimlane and directly issuing `ReserveCopy`) — that lets an external system trigger domain work with no translation step, which this model doesn't allow. **Apply this now, in Step 4b** — Conway's Law (Step 6) only confirms the boundary, it doesn't introduce the chain. Every integration trigger from another team's system needs a **translation automation** — that part is never optional:

1. **Translation automation** — converts the external fact into an internal one; the other system's own decision logic is out of scope. Its todo list is opened by the external EVENT — the one and only place an external EVENT may open a todo list. **It is not closed by the internal EVENT its own command produces, and gets no backward arrow.** A translation automation's job is an instantaneous, always-succeeding relay: there is no real work-in-progress window between "signal arrived" and "internal fact recorded" worth modeling as an open/close lifecycle, unlike a worker automation that can genuinely have pending items. This read model exists only to satisfy "every automation reads from a todo list," not to accumulate and drain a queue — so it stays open-ended: fed by the external EVENT, read by the automation, never closed.
   - **Three separate columns**, left to right: `[external EVENT] → [todo-list READMODEL] → [AUTOMATION + COMMAND + internal EVENT]`. Never crammed into one or two — the "one EVENT per column" rule applies here too.
   - **Name the internal EVENT for its business meaning, not the transport** — usually the same name as the external EVENT (e.g. external `CopyReserved` → internal `CopyReserved`; the swimlane already shows which is which), never a mechanical `<X>SignalReceived`/`<X>RequestReceived` suffix. Same for the automation/command: `Record Reservation`/`RecordReservation`, not `Record Reservation Signal`/`RecordReservationSignal`.
   - Its command and event carry no business decision — they only exist to produce the internal fact a worker automation would need, *if one is even needed* (see below).

### Does a worker automation come after it, or does the chain stop there?

The translation automation never decides anything — it only records a fact. Whether something needs to happen *after* that fact depends on whether there is still a decision left to make:

- **Build a worker automation only when reacting to the internal EVENT requires a genuinely new decision on this side** — an invariant to check, a choice to make, data to compute that the internal EVENT doesn't already carry. That decision is what earns its own COMMAND, which is what earns the automation that issues it (see item 2 below for its shape).
- **Do not build one when the internal EVENT already *is* the business-relevant fact.** If the external system already made every decision involved, and the "next" EVENT you were about to model would just restate data the internal EVENT already carries under a different name (same identity, no new field, no invariant checked, no choice made) — stop after the translation automation. That is not a second stage of the same chain; it is no chain at all, just a fact recorded once. Anything else that needs this fact reads the internal EVENT directly through a state-view READMODEL projection — it does not get an automated command reaction bolted on solely to keep a fixed "two automations" shape.

  *Example*: an external `ReservationPlaced` opens a translation chain and already carries `reservationId`, `copyId`, and `memberId` — the copy to reserve was chosen upstream, by the other system. Translating it into an internal `ReservationPlaced` is still required (per the rule above — an automation may never react to the external event directly). But adding a second `ReservationsToApply` todo list + `Reserve Copy` automation + `CopyReserved` event on top of it is redundant: `CopyReserved` doesn't decide anything `ReservationPlaced` didn't already decide, it's the same fact under a different name. A read model showing "reserved copies" should project directly off the internal `ReservationPlaced` event, not off a manufactured second automation stage.

2. **Worker automation** (only when the check above says one is needed) — the one that does the actual work (a real domain decision the process is about, e.g. checking copy availability before issuing `ReserveCopy`). Its todo list is opened **only** by the internal EVENT the translation automation produced (this chapter's own swimlane) — never by the external EVENT directly — and closed by whatever event marks that work done. Unlike the translation stage, the worker's todo list keeps its normal open/close accumulator shape, because real pending work can sit there (it's the point where actual domain decisions happen).

**Two chained automations only when there genuinely are two decisions** — the translation (none, by definition) and the worker (a real one). Whether a worker stage exists at all is a judgment call driven by whether that second decision actually exists, not a fixed shape to stamp onto every cross-swimlane trigger.

When a worker automation *is* warranted, wire the todo lists differently for each automation in the chain: for the translation automation, the external EVENT (second swimlane) **opens** the row and nothing closes it; for the worker automation, the internal EVENT **opens** its row and its own resulting EVENT **closes** it (backward arrow, per the exemption below). `EVENT → READMODEL` connections from both swimlanes are unaffected by which swimlane the event sits in.

## Fields on a todo-list read model

A todo-list read model's fields describe the pending item — the identity it's about (e.g. `customerId`) plus enough context to act on it (e.g. `email`, `notificationType`). Do not add a `status` field to mark items done — a todo list's "open" state is *membership in the list itself* (the row exists at all), not a status flag on a row that never leaves. If the same underlying data is also useful with an explicit status column for a different consumer, that is a different read model, not this one.

Every field must set a `mapping` per `eventmodeling-identifying-outputs`'s field data lineage rules (`"<EventTitle>.<fieldName>"`, `"latest:..."`, `"aggregate:..."`, `"derived:..."`), and `"cardinality"` (`"Single"` unless the field genuinely holds a list).

A todo-list read model is always list-shaped — it's a queue of pending items, never a single record — so it always gets **`meta.listElement: true`** on the node itself (see `eventmodeling-core-rules`'s READMODEL section). This is a node-level flag separate from any field's own `cardinality`.

## Placement — todo-list READMODEL, one column before its automation

The todo-list read model goes in the interaction lane, **one column before** its automation (actor lane) — the automation's own column already holds the COMMAND it issues, so the read model can never share that column.

**Every `node:created` call MUST include `cellId`.** Without it the node has no cell reference and will appear stranded at position 0,0 — not in any timeline column.

**Prefer MCP** — `place_element` finds/creates the empty interaction cell one column before the automation and creates the node in one call:
```
mcp__eventmodelers__place_element {
  "boardId": "<BOARD_ID>",
  "timelineId": "<CHAPTER_ID>",
  "elementType": "READMODEL",
  "title": "NotificationsToSend",
  "columnIndex": <automationColumnIndex - 1>
}
```
Then set `meta.fields` and `meta.listElement: true` on the returned node id:
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<returned-node-id>",
    "boardId": "<BOARD_ID>", "timestamp": 1234567890,
    "meta": {"type": "READMODEL", "title": "NotificationsToSend", "fields": [...], "listElement": true}
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Placement — todo-list READMODEL, one column before its automation".

**Place every node in a translation chain with `autoConnect: false`** (`place_element` / `create_screen` / `submit_node_events` all take the flag). A chain's columns are inserted into the middle of an existing timeline, so the default nearest-left auto-connect will wire the new todo-list READMODEL or internal EVENT to whatever unrelated event sits in the column before it — the recurring "spurious auto-connect edge near an automation chain" cleanup. Suppress it and build the chain's edges yourself in the `set_connections` batch below, then confirm with `validate_model`.

> **Never call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first.

For a **translation-chain automation**, place its three columns left to right in the same pass: `[external EVENT]`, `[todo-list READMODEL]`, `[AUTOMATION + COMMAND + internal EVENT]` — the external EVENT normally already exists (placed in Step 1/brainstorming, second swimlane); if it doesn't, place it there first.

## Wiring connections

1. **READMODEL → AUTOMATION first** — the automation reads its own todo list. The closing connection below is only accepted once this edge exists.
   ```
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<readmodelNodeId>", "target": "<automationNodeId>", "action": "connect" }
   ```
2. **Every opening EVENT → READMODEL.**
   ```
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<openingEventNodeId>", "target": "<readmodelNodeId>", "action": "connect" }
   ```
3. **Every closing EVENT → READMODEL — worker-stage todo lists only.** Including the automation's own resulting event, even though that event is produced by the command this same automation issues. This is not a backward arrow: `EVENT → READMODEL` connections are exempt from column ordering when the read model already has a `READMODEL → AUTOMATION` edge (see `learn-eventmodelers-api` §3) — this todo-list read model qualifies because of the edge from step 1 above. A read model in this shape is a live projection, not a frozen snapshot — a later event closing an earlier-opened item is the normal case, not an exception to reach for only when convenient. **Do not add this edge for a translation automation's todo list** — it has no closing event at all (see the translation-chain rule above); wiring one back is a modeling error, not a convenience.

**Fallback (no MCP)** — same three edges via `POST /connections` with `{"source":"...","target":"..."}`, in the same order.

Skip a connection silently if the target cell is empty (the element may not exist yet). Log each created arrow, e.g. `→ connected READMODEL→AUTOMATION "NotificationsToSend"→"Send Welcome Notification"`.

If this step is designing more than one automation's chain in the same pass, batch every connection from every automation into one `set_connections` call (with `compact: true`) instead of one `set_connection` per edge — `set_connections` still applies its entries **in order**, so keep each automation's own three-edge sequence intact (READMODEL→AUTOMATION before its closing EVENT→READMODEL) within the combined array; different automations' triples can be interleaved or concatenated freely since they don't depend on each other.

## Verification (run before moving to Step 5)

Run `validate_model` (`{boardId, chapterId}`) first — with the chain placed `autoConnect: false`, its `backward-arrows` finding confirms no stray nearest-left edge was created and every real edge points the right way, and `command-issuers` confirms each chain's COMMAND is issued only by its own AUTOMATION. Then re-fetch every AUTOMATION on the board (`get_nodes`, `type: "AUTOMATION"`) and check each one:

1. Does it have an incoming `READMODEL → AUTOMATION` connection to a todo-list read model? An AUTOMATION is **never** exempt — if not, design and wire it now.
2. Is its todo list opened by an internal event only, **unless it is itself a translation automation** (which is the one case a second-swimlane event may open a todo list)? If a worker automation's todo list is opened directly by another system's event, that automation is missing its translation chain — split it into translation + worker automations per the rule above.
3. If it's a **translation** automation, does its todo list have no closing edge — i.e. no connection from its own resulting internal EVENT back to its own todo-list read model? If one exists, remove it: a translation automation's todo list is never closed.
4. If it's a **worker** automation sitting right after a translation automation, does its own COMMAND make a genuinely new decision the internal EVENT didn't already carry? If its fields and logic just restate the internal EVENT's own data under a new name, it's a redundant stage — remove the worker automation, its todo list, and its resulting event, and have downstream consumers project a state-view READMODEL directly off the internal EVENT instead.
5. If it's a real worker automation, does its todo list have a proper closing edge from its own resulting event? If not, add it.
6. Does the todo-list read model's field set avoid a `status` flag (membership in the list is the state)?

List the result (connected / chain-resolved) for every automation checked — this is the evidence that `eventmodeling-identifying-outputs`'s later per-node verification pass (which re-checks automations defensively) finds nothing left to do here.

## Quality Checklist

- [ ] Every AUTOMATION has an incoming `READMODEL → AUTOMATION` connection to a todo-list read model — no exemption, even for a simple relay
- [ ] No automation's todo list is opened directly by another system's (second-swimlane) EVENT unless that automation is itself the translation automation
- [ ] Every externally-triggered automation has a translation automation ahead of it — never triggered by the external EVENT directly
- [ ] A worker automation exists after the translation stage only when it makes a genuinely new decision — not merely to keep a fixed "two automations" shape when the internal EVENT already is the business-relevant fact
- [ ] Every **worker**-stage todo-list read model's opening and closing events are identified, including the automation's own resulting event as a closing event
- [ ] Every **translation**-stage todo-list read model has an opening event (the external EVENT) and **no closing event at all** — no backward arrow from its own internal EVENT back to its own todo list
- [ ] No todo-list read model uses a `status` field instead of list membership
- [ ] Every todo-list read model has `meta.listElement: true` set on the node
- [ ] Every todo-list read model sits one column before its automation, never sharing its column
