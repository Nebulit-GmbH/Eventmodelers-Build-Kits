---
name: eventmodeling-core-rules
description: Shared, foundational rules for every event-modeling step — what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject. Not a step of its own — referenced upfront by every other eventmodeling-* skill instead of each restating its own copy. Do not use standalone.
---

# Event Modeling — Core Rules

These rules apply to every step of event modeling, regardless of which step's SKILL.md you're currently following. Read this once per session — a step's own file only states what's specific to that step, not these fundamentals.

## Modes

Which step you're in sets the posture — don't mix them.

- **Modeling Mode** — `brainstorming-events`, `plotting-events`, `storyboarding-events`, `identifying-inputs`, `identifying-outputs`, `designing-automation-chains`, `elaborating-scenarios`, `translating-external-events`: explore and build. Capture the process as completely as you can. A naming slip or an incomplete precondition is something to flag and move past, not a reason to stall the whole step — don't over-correct early.
- **Critic Mode** — `validating-event-models`, `validating-event-models-checklist`, `checking-completeness`, `wdyt`, `optimizing-stream-design`: review what's already there. Apply every rule in this file strictly. Surface every violation, gap, and inconsistency — don't soften a finding because the model "mostly works." Post findings as comments (`handle-comment`) rather than silently fixing them, unless the step explicitly says to fix.

Don't mix them in one pass: a modeling step is not the place to run a full rules audit, and a critic step is not the place to quietly add missing structure on the model's behalf instead of flagging it.

## Lanes — What Lives Where

Every column on a timeline has (at most) four rows, and each element type belongs in exactly one:

| Lane type | Elements allowed | What it represents |
|---|---|---|
| `actor` | SCREEN, AUTOMATION | Who or what initiates — a human via a screen, or a system via an automation |
| `interaction` | COMMAND, READMODEL | The business intent going in (COMMAND), or the query result coming out (READMODEL) |
| `swimlane` | EVENT | The business fact recorded — which system/entity's own story this event belongs to |
| `spec` | SCENARIO | The Given/When/Then behavior spec for this column's COMMAND or READMODEL |

An EVENT never shares a column with another EVENT even across different swimlane rows — one column is one moment in time. See `place-element` for the full placement mechanics; this table is only "what belongs where," not "how to place it."

## Slices

A **slice** is the thinnest possible vertical cut through the model — exactly one COMMAND, one READMODEL, or one AUTOMATION's command, never combined:

```
state-change slice = SCREEN/AUTOMATION → COMMAND → EVENT(s)
state-view slice   = EVENT(s) → READMODEL → SCREEN/AUTOMATION
automation slice   = EVENT(s) → AUTOMATION → COMMAND → EVENT(s)
```

A slice never mixes a COMMAND and a READMODEL — those are two different slice types (`state-change` and `state-view`), even when they belong to the same feature. Slices are independently deployable and only communicate with each other via events.

Slices are not placed directly — they're **derived** from a completed model. Every COMMAND on the board implies a `state-change` slice, every READMODEL implies a `state-view` slice, every AUTOMATION implies an `automation` slice — **except** a `linkedTo` copy (see Linked Copies below), which implies no slice of its own: it's the same underlying COMMAND/EVENT/READMODEL reused elsewhere on the board, not a second independently-deployable thing, so only the origin node's column gets a `SLICE_BORDER`. `eventmodeling-slicing-event-models` makes that implicit structure explicit on the board once modeling is done; it never invents a slice that isn't already implied by an element that's there, and skips columns whose only COMMAND/READMODEL is a linked copy.

## Elements

### EVENT
- Represents a business fact that already happened.
- Naming: past tense, business language.
  - Valid: `OrderPlaced`, `PaymentAuthorized`, `UserRegistered`
  - Invalid: `SidebarOpened`, `RequestCompleted`, `ApiCalled` — these describe machinery or UI state, not business facts
- Immutable — never modify or delete an event once created; a correction is a new event, not an edit.
- Contains only captured facts. No computed or derived values — those belong in a READMODEL.

### COMMAND
- Represents business intent — what an actor wants to do.
- Can be rejected; only succeeds if its documented preconditions hold.
- Naming: imperative, business language.
  - Valid: `PlaceOrder`, `ConfirmPayment`, `CancelSubscription`
  - Invalid: `LoadOrders`, `FetchData`, `OpenDialog` — these are queries or UI-only actions, not business intent
- Issued by exactly one SCREEN or AUTOMATION — never two. See `place-element`'s Step 7c for the mechanical check/fix; this rule is stated here, the fix lives there.
- Produces one or more EVENTs on success, or is rejected with no event.

### READMODEL
- A projection built from events, shaped for a specific query.
- Naming: noun phrase, business language, named for the data — not the machinery that produces it.
  - Valid: `OrderSummary`, `InvoiceList`
  - Invalid: `OrderSummaryProjector`, `InvoiceListRepository` — implementation detail leaking into the model
- Optional — nothing requires a READMODEL to exist for a COMMAND or a downstream consumer.
- Never drives COMMAND validation directly — a COMMAND is checked against its own documented preconditions, not a read model.
- **List-shaped read models**: when the whole READMODEL represents multiple rows (each row shaped by its defined fields), not a single projected record, set `meta.listElement: true` on the node itself — this is a node-level flag, distinct from a field's own `cardinality: "List"` (a single field holding multiple values). Every todo-list read model (see `eventmodeling-designing-automation-chains`) is list-shaped and always gets `listElement: true`; the same applies to any other READMODEL whose query naturally returns a set of rows (e.g. `ProductList`, `InvoiceList`). `eventmodeling-elaborating-scenarios` reads this flag to decide whether a scenario needs row-level `examples`/`expectEmptyList` instead of a single accumulated result.

### SCREEN
- Represents what a user sees and can act on.
- Naming: what a user would call it, not its internals.
  - Valid: `Dashboard`, `OrderOverviewPage`
  - Invalid: `OrderOverviewComponent`, `ProjectorView`

### AUTOMATION
- Represents an automated actor — a processor, scheduler, or system reacting to events.
- Naming: what it does, in business language.
  - Valid: `BillingScheduler`, `InventoryReserver`
  - Invalid: `OrderServiceHandler` — implementation-flavored, not a business actor's name

## Causality

- Every EVENT traces to the COMMAND that produced it.
- Every COMMAND traces to the SCREEN or AUTOMATION that issued it — exactly one.
- A process starts with a read (SCREEN + READMODEL) or an AUTOMATION reacting to an existing EVENT — never with an unmotivated COMMAND.

## Role Catalog

Every event model needs one, established before brainstorming events (it's the first mandatory step) — without it, downstream steps have no way to say *who* does what:

- **Human roles** (Customer, Seller, Admin...) and **system actors** (Payment Gateway, Scheduler...), each with: a name in domain language, a one-line description, its key actions, and what it explicitly cannot do.
- No COMMAND may be attributed to a generic "User" — it must name a specific role or actor from the catalog.
- Every COMMAND is issued by exactly one role/actor (this is the same rule as the COMMAND single-issuer rule above, stated from the Role Catalog's side).
- Every human role needs at least one COMMAND and one READMODEL — a role in the catalog that never acts and never sees anything is decorative, not modeled.

See `eventmodeling-brainstorming-events` for how the catalog is built, `eventmodeling-identifying-inputs` for attributing commands to it, and `eventmodeling-validating-event-models` for re-checking it holds once the model is complete.

## Field Lineage

Every field on a COMMAND or READMODEL must carry a `mapping` that traces it back to where its value actually comes from — user input, the session, a prior event's field, a derived/computed value, or an external webhook payload. **A field with no mapping is a gap, not a detail to fill in later.**

See `eventmodeling-identifying-inputs` for the full COMMAND mapping vocabulary and `eventmodeling-identifying-outputs` for the READMODEL equivalent — this rule only states that every field must have one, not the mapping syntax itself.

## Connections Read Forward

A connection either goes **downward within the same column** (actor → interaction → swimlane → spec) or **forward to a later column** — never backward (right-to-left). This is why elements that belong together — a SCREEN and the READMODEL it queries, a SCREEN/AUTOMATION and the COMMAND it issues, a COMMAND and the EVENT it produces — should share a column whenever possible: the moment they don't, a backward arrow becomes a real risk.

When an element's natural column is already occupied by something else, insert a new column immediately before or after (whichever keeps every connection forward) rather than wiring across the gap. See `place-element` for the mechanical insertion rules and each step's own placement section for where "before" vs. "after" applies.

## Updating a Read Model That Already Feeds a Screen

A later EVENT sometimes needs to change data an earlier READMODEL already shows on a SCREEN — e.g. a cancellation affecting an "active items" view placed several columns earlier. Wiring that later EVENT straight back into the existing READMODEL is never the fix: it's a backward connection, and the platform only accepts a backward `EVENT → READMODEL` edge when the READMODEL already has a `READMODEL → AUTOMATION` edge (the todo-list pattern — see Translation Chain below). A READMODEL that only feeds a SCREEN never qualifies for that exemption.

Instead, place a **new READMODEL node** in a new column **immediately after** the later event's column, then link it to the earlier READMODEL instance via the `linkedTo` copy mechanism below (`link_element`) — it *is* the same read model, carried forward to a later state, not an unrelated new one, so it uses the same copy mechanism as any other reused fact. Connect the later event forward into the linked copy, then update whichever field(s) that event actually changes (e.g. `status`) on the copy — the fields it inherited from the link that the new event doesn't touch stay as copied. Give it a matching SCREEN in that same new column — same screen name/title as the earlier one, showing the updated data, optionally re-marked/highlighted via `html-screen`'s Marks feature to call out what changed. A SCREEN can never itself be a `linkedTo` copy (the mechanism only supports COMMAND/EVENT/READMODEL), so the new SCREEN is placed as a plain node matching the earlier one's title, not linked. Leave the earlier READMODEL/SCREEN instance exactly as it is — it's still what that earlier point in the timeline correctly showed. Never delete it.

See `eventmodeling-identifying-outputs` Step 5g for the full placement/wiring mechanics, and `place-element` Step 6 for the column-insertion mechanics.

## Linked Copies

A **linked copy** is a COMMAND/EVENT/READMODEL node that mirrors another node elsewhere on the board — most often needed because `set_connection`/auto-connect only ever pairs nodes on the same timeline, so a node on a different timeline can't be wired to directly. The same marking obligation applies whenever a node is reused rather than newly wired anywhere on the board, same timeline included: never place a node that repeats another swimlane's already-recorded fact under its own unlinked identity — either connect forward to the original, or mark it a linked copy. The one exception is a translation chain's own internal EVENT (`eventmodeling-designing-automation-chains`): it is a genuine new domain fact recorded in this side's own language, not a copy, even when it shares the external EVENT's name.

To make one: place a normal new node of the same type (COMMAND/EVENT/READMODEL only) at the target spot, then link it to the origin (`link_element`, or the REST `.../nodes/:nodeId/link` fallback). This replaces the new node's `meta` with a full copy of the origin's and sets `meta.linkedTo` to the origin's node id — the authoritative pointer (a `data.linkedTo` also exists but is a rendering mirror only, not the source of truth). Wire the resulting copy to its own neighbors normally afterward.

A linked copy is allowed to diverge from its origin afterward in the specific field(s) a newly-connected event actually drives — e.g. the "Updating a Read Model That Already Feeds a Screen" copy above, where `status` is updated post-link to the event's new value. The link establishes "this is the same underlying fact, not a duplicate" at creation time; it doesn't freeze the copy's fields identical to the origin's forever.

Never delete the original (the node with no `linkedTo`) once copies of it exist — copies reference it, and removing it breaks every copy. `eventmodeling-checking-completeness` already treats any `linkedTo`-marked node as an intentional copy, never a duplicate or missing-slice gap to flag.

See `place-element` Step 6a for the mechanical linking steps.

## Translation Chain

An AUTOMATION reacting to an event from another system — external (a webhook/API) or second-swimlane (another team's own timeline) — needs a two-stage shape, never a direct reaction:

```
external EVENT → todo-list READMODEL → translation AUTOMATION + COMMAND → internal EVENT → worker automation's own todo list
```

- The external/second-swimlane EVENT opens only a *translation* automation's todo list — never a *worker* automation's todo list directly.
- A translation automation's own todo list is opened by that external event and is never closed — it doesn't track "done," it only relays.
- Its resulting COMMAND produces the internal EVENT the domain actually works with — that's the moment external data becomes a business fact in this domain's own language, ready for a worker automation (or anything else) to react to.

Every AUTOMATION, translation or worker, needs its own todo-list READMODEL (opened by triggering events, closed by completion events) — no "pure relay" exemption. See `eventmodeling-designing-automation-chains` for the todo-list pattern and board placement mechanics, and `eventmodeling-translating-external-events` for mapping the external payload's raw fields to the internal EVENT's domain fields (correlation, idempotency, duplicate handling).

## Open Questions vs. Decided Failures

Two different things are easy to conflate, and conflating them corrupts completeness checking:

- **Open question** — something genuinely undecided. Post it as a `QUESTION`-type comment (`handle-comment`) on the relevant node. It stays open until someone actually answers it — resolving means answering, not deleting the comment.
- **Decided failure** — a rejection or error case whose behavior is already decided (e.g. "payment fails → reject, no event"). Model it as a SCENARIO with `expectError: true` and an `errorDescription` (see `eventmodeling-elaborating-scenarios`), never as a comment. It's permanent, specified behavior, not something waiting on an answer.

A decided failure left as a lingering `QUESTION` comment looks unresolved when it isn't. When counting completeness (`eventmodeling-checking-completeness`), only a genuinely unanswered `QUESTION` counts as a gap — a decided failure path needs its `expectError` scenario, not a comment standing in for one.

## Offline-First Thinking

Model the business process as it would work without any software first, then translate to elements:

- How would this work manually, with people, on paper?
- Who acts, and what triggers each action?
- What information do they need before they can act?

Question any step that exists only because of the system — a loading spinner, a cache refresh, a session check is not a business step and does not belong on the timeline. This is the discipline behind the Anti-Patterns below; the anti-patterns are what it looks like when this principle is skipped.

## Anti-Patterns

- **Data-loading commands**: `LoadOrders`/`FetchData` are queries, not business intent — model as a READMODEL, not a COMMAND.
- **UI-interaction events**: `SidebarOpened`/`ButtonClicked` are UI state, not business facts — don't model them unless the business genuinely cares.
- **Technical events**: `ApiCalled`/`ResponseReceived` describe machinery, not an outcome — find the business fact underneath.
- **Calculated events**: an event whose value is recomputed as source data changes (a running total, an average) is a READMODEL, not an EVENT.

## Structural Shapes

Beyond the local anti-patterns above, four recurring **connection shapes** are worth checking whenever the model's wiring is visible — a fan-out or fan-in count crossing a rough threshold. Only one is a real anti-pattern regardless of context; the other three are **candidates** — worth checking against the business context, not automatically wrong. Reason about the actual events/fields/scenarios involved before flagging a candidate; if the domain justifies the count, it's not a violation. These are internal shorthand names for spotting the shape — never surface "bed", "left chair", "right chair", or "shelf" in anything shown to a business stakeholder (a board comment, a report); describe the concern in plain terms instead.

- **The bed (real anti-pattern — always flag)** — one SCREEN wired to more than one COMMAND. A screen is where the user has already committed to one decision, so it should trigger exactly one command; wiring several to it means the choice is being made somewhere invisible to the model.
- **The left chair (candidate)** — one COMMAND resulting in more than two EVENTs. May mean the command is doing more than one job, or it may be a single business outcome that legitimately fans out. Check whether the outcomes always happen together or could happen independently before treating it as a concern.
- **The right chair (candidate)** — one READMODEL built from more than three EVENTs. May mean the view is answering more than one question at once, or it may be one coherent picture that genuinely needs that many sources. Check whether the fields shown belong to a single thing the user is checking before treating it as a concern.
- **The shelf (candidate)** — one slice with noticeably more SCENARIOs than the others on the same timeline (a rough outlier, not a fixed threshold — compare against the typical count for that timeline). May mean the step is quietly covering ground that belongs to a separate step, or it may just be genuinely more complex. Check what the extra scenarios actually cover before treating it as a concern.

## Flow & Causality

Model causality, not strict sequence:

- A timeline starts with a **state-view** (READMODEL feeding a SCREEN) or an **automation** reacting to an EVENT already on the board — never with an unmotivated COMMAND.
- Every COMMAND must be traceable to a trigger: a SCREEN (a user decision) or an AUTOMATION (a system reaction).
- A `state-change` slice must not follow another `state-change` slice without a trigger in between (a new SCREEN or AUTOMATION) — two COMMANDs in a row with nothing issuing the second one is a gap, not a shortcut.

Valid transitions between slices:
- state-view → state-change
- state-change → state-view
- state-change → automation
- automation → state-change
- automation → state-view

## Quick Self-Check

Before treating a model as done, verify:

- [ ] Every EVENT is past tense and describes a business fact, not machinery or UI state
- [ ] Every COMMAND is imperative business intent, not a data-loading query
- [ ] Every READMODEL is named for its data, not its implementation
- [ ] No EVENT holds a computed/aggregated value — that belongs in a READMODEL
- [ ] Every COMMAND has exactly one issuer (one inbound SCREEN or AUTOMATION edge)
- [ ] Every COMMAND traces back to a SCREEN (user decision) or AUTOMATION (system reaction)
- [ ] The timeline starts with a state-view or an automation reacting to an event — not a bare COMMAND
- [ ] No two `state-change`/`state-change` slices are chained without a new trigger between them
- [ ] No SCREEN is wired to more than one COMMAND (the bed — see Structural Shapes)

This is the fast pass — the full, deeper check is `eventmodeling-validating-event-models-checklist`.
