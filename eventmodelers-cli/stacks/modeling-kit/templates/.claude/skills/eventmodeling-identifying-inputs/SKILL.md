---
name: eventmodeling-identifying-inputs
description: "Step 4 of Event Modeling - Identify Commands/Inputs from UI and Processor actions. Map user actions to commands and data. Use after storyboarding UI. Do not use for: identifying read models or outputs (use eventmodeling-identifying-outputs) or elaborating behavior specifications (use eventmodeling-elaborating-scenarios)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Identifying Inputs

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already identified UI actions/commands and processor triggers. Interview when it's unclear which actions are user-initiated vs. processor-automated.

### Critical Questions

1. **Automation Level** (Impact: Determines which commands are UI-triggered vs. processor-triggered)
   - Question: "Are there actions that should be: (A) User-initiated only, (B) Processor-automated, (C) Mix of both?"
   - Why it matters: Knowing automation vs. manual separates command types
   - Follow-up triggers: If (C) → ask "Which specific user actions trigger automation? What does the processor decide on its own?"

2. **External System Triggers** (Impact: Determines if there are processor commands from webhooks/integrations)
   - Question: "Will commands be triggered by: (A) UI only, (B) External webhooks (payments, notifications, etc.), (C) Scheduled processors, (D) All of above?"
   - Why it matters: External triggers are processor commands, not UI commands
   - Follow-up triggers: If (B) or (D) → ask which external systems send webhooks and what data they include

Follow **`eventmodeling-interview-protocol`** to run this interview and record its findings — label this step "**4. Identifying Inputs** (`eventmodeling-identifying-inputs`)". Findings should cover: automation classification (user-initiated vs. processor-automated), external system triggers, and a command attribution summary (UI-issued vs. processor-issued, each with its role/source).

---

## Workflow

Given UI storyboards and event timeline, identify all inputs.

**PREREQUISITE**: The **Role Catalog** from Step 1 (eventmodeling-brainstorming-events) must exist. Every command identified below MUST be attributed to a specific role or system actor from that catalog.

> **Scope note**: This step only places the AUTOMATION actor and its COMMAND (per the Timeline Alignment Rules in `eventmodeling-orchestrating-event-modeling`). Do not attempt to design an automation's todo-list READMODEL here, and do not resolve an externally-triggered automation into a translation chain here — that is Step 4b (`eventmodeling-designing-automation-chains`), which runs immediately after this step completes, before Step 5. **Do not place anything at all** for a command whose only trigger is an EVENT node already sitting in another swimlane (see "Identify Processor Triggers" below) — leave that entire case, node placement included, to Step 4b.

### 1. Extract Commands from UI Actions
For each user action in storyboard, create a command attributed to a specific role: name the command, list the input fields the form captures, state the validation rules that apply, and record the event it produces. A full worked example (Order Creation → CreateOrder) is in `references/examples.md`.

### 2. Identify Processor Triggers
Identify automation-triggered commands: for each processor-triggered action (a webhook, a scheduled job), create a command attributed to the source system, documenting its input data, validation rules, and the event it produces. A full worked example (a payment webhook → AuthorizePayment) is in `references/examples.md`.

**Stop and check before placing any of these**: is the "processor trigger" already a placed EVENT node in a second (external) swimlane — e.g. a `CopyReserved (ext)` event from Step 1's brainstorming — rather than an unmodeled webhook with no board node? The two cases are handled completely differently:

- **No pre-existing EVENT node** (a genuine webhook/API call, like `AuthorizePayment` above): proceed as written below — place the AUTOMATION+COMMAND in one column, wire `COMMAND → EVENT` normally.
- **A pre-existing EVENT node in another swimlane**: do **not** place the AUTOMATION/COMMAND in that event's column, and do **not** wire `COMMAND → EVENT` to it — that event already happened in another system; this chapter's command cannot be the thing that produces it. List the command in the Command Catalog as *deferred to Step 4b* and stop there. `eventmodeling-designing-automation-chains` places the correct multi-column translation-chain-plus-worker shape from scratch; anything placed here for this case would only have to be deleted and redone there.

### 2b. Understand the Processor "Todo List" Pattern
Processors don't directly process events—they maintain a todo list driven by events: a triggering event adds an item to the processor's todo list, and the processor continuously walks that list, checking a condition for each item and either succeeding (producing a success event, marking the item done) or failing (producing a failure event or leaving it for retry). A full worked example (PaymentAuthorized → InventoryReserver's todo list) is in `references/examples.md`.

**Key insight**: Processors are reactive. They listen for events and create todo items, then execute those todos by issuing commands that produce new events.

### 2c. Document Processor Automation (Gears Symbol)
Show which commands come from automation vs. user actions: catalog every command with its role/actor attribution, separating UI-issued commands (attributed to specific human roles) from processor-issued commands (attributed to system actors/services). A full worked example is in `references/examples.md`.

**Validation**: Every command MUST have a role/actor attribution. If a command says `[ User]` instead of a specific role name, it's incomplete — go back to the Role Catalog and assign the correct role.

### 3. Document Command Specifics
For each command, define structure: its source, its typed input fields, the validation rules it enforces, the preconditions it checks against stream state, the success event it produces, and each distinct failure outcome. A full worked example (ConfirmOrder) is in `references/examples.md`.

### 4. Create Command Catalog
List all commands the system accepts, grouped into UI-issued and processor-issued sections, each with its source, input fields, and the event it produces. A full worked example is in `references/examples.md`.

### 5. Map Data Sources
Document where each command input comes from — UI context, a form selection, a conditional field that depends on another field's value — and how it's validated. A full worked example is in `references/examples.md`.

### 6. Identify Implicit Context
Document what comes from stream state beyond the command's explicit input: the preconditions the command implicitly relies on (e.g. prior events that must already exist, a required prior status) that its validation logic checks against. A full worked example is in `references/examples.md`.

## Output Format

Instead of writing a markdown document, **place each COMMAND on the board** using the `node:created` API.

> **CRITICAL: Every COMMAND node MUST include `meta.fields` with a `mapping` on every field.** A command without fields — or with fields that lack `mapping` — is an incomplete model that cannot be traced, validated, or turned into code.

### Field data lineage — the `mapping` attribute

Every field on a COMMAND must carry a `mapping` that says exactly where its value comes from. Use one of these forms:

 | `mapping` format | Meaning | `generated` | Example |
|---|---|---|---|
| `"user-input"` | User types or selects this value directly | `false` | `startTime` picked from a date picker |
| `"session:<fieldName>"` | Read from the authenticated session | `false` | `session:customerId` |
| `"<EventTitle>.<fieldName>"` | Taken from a previously emitted event | `false` | `BikeReserved.bikeId` |
| `"derived:<expression>"` | Computed by the system | `true` | `derived:uuid4()`, `derived:now()` |
| `"webhook:<payloadField>"` | Comes from an external webhook payload | `false` | `webhook:gateway_transaction_id` |

Set the field's `generated` property according to this table. Fields typed by the user (typically from a screen form) are never generated — the user supplies the value. Fields with a `derived:` mapping are always generated — the system produces the value automatically.

The `mapping` traces the value all the way back to its origin. **If you cannot write a mapping for a field, that field has an unknown origin — treat it as a gap and resolve it.**

Every field must also set `"cardinality"` — use `"Single"` unless the field genuinely holds a list of values (e.g. multi-select), in which case use `"List"`. Default to `"Single"` when unsure. Only add fields the command actually needs to do its job — do not add speculative fields; enrich later via `/attributes`.

### Field traceability rule for events

Every field in the resulting EVENT must either:
- Appear in the command's `fields` (direct mapping — same name or documented rename), or
- Be derivable from command fields + system state

Example: `BikeReserved.reservedAt` is not in `ReserveBike` but derives from `derived:now()`. That is acceptable — document it. `BikeReserved.reservationId` is not in `ReserveBike` but derives from `derived:uuid4()`. Also acceptable.

If an event field has **no** corresponding command field and **no** derivation rule, that is a gap — add it to the command or note it as a system-generated field.

> **Connected-element rule**: A field `mapping` may only reference elements that are connected to this COMMAND via board arrows (`SCREEN → COMMAND`). If a field's value would come from something not yet connected, flag it as a gap. **If a mapping cannot be defined at all, it hints at missing data in the model or a modeling error** — a missing event field, a missing screen field, or a broken connection. Investigate before proceeding.

```json
{
  "type": "COMMAND",
  "title": "ReserveBike",
  "fields": [
    {"name": "customerId",  "type": "String",   "example": "cust-42",               "mapping": "session:customerId", "generated": false},
    {"name": "bikeId",      "type": "String",   "example": "bike-17",               "mapping": "user-input",         "generated": false},
    {"name": "stationId",   "type": "String",   "example": "stn-03",                "mapping": "user-input",         "generated": false},
    {"name": "startTime",   "type": "DateTime", "example": "2026-06-01T09:00:00Z",  "mapping": "user-input",         "generated": false},
    {"name": "endTime",     "type": "DateTime", "example": "2026-06-01T17:00:00Z",  "mapping": "user-input",         "generated": false}
  ]
}
```

Event fields produced by this command:
- `reservationId` → `derived:uuid4()` → `generated: true`
- `customerId` → `ReserveBike.customerId` → `generated: false`
- `bikeId` → `ReserveBike.bikeId` → `generated: false`
- `stationId` → `ReserveBike.stationId` → `generated: false`
- `startTime` → `ReserveBike.startTime` → `generated: false`
- `endTime` → `ReserveBike.endTime` → `generated: false`
- `reservedAt` → `derived:now()` → `generated: true`

Commands go in the `interaction` lane — same column as their resulting event.

### Creating a COMMAND node with fields

**Every `node:created` call MUST include `cellId`.** Without it the node has no cell reference and will appear stranded at position 0,0 — not in any timeline column.

Commands go in the **interaction lane**, same column as the event they produce.

**Prefer MCP** — `place_element` collapses the entire find-row → find/append-column → compute-cellId → create-node → auto-connect sequence (Steps A–D below) into one call:
```
mcp__eventmodelers__place_element {
  "boardId": "<BOARD_ID>",
  "timelineId": "<CHAPTER_ID>",
  "elementType": "COMMAND",
  "title": "ReserveBike"
}
```
`place_element` finds/creates the empty cell in the interaction lane in the correct column and places the node — but it does not accept `fields`. Immediately follow up with `submit_node_events` (`node:changed`) to set `meta.fields` (with `mapping`/`generated`/`cardinality` per the rules above) on the node it returned:
```
mcp__eventmodelers__submit_node_events {
  "boardId": "<BOARD_ID>",
  "events": [{
    "id": "<event-uuid>",
    "eventType": "node:changed",
    "nodeId": "<returned-node-id>",
    "boardId": "<BOARD_ID>",
    "timestamp": 1234567890,
    "meta": {
      "type": "COMMAND",
      "title": "ReserveBike",
      "fields": [
        {"name": "customerId", "type": "String",   "example": "cust-42",             "mapping": "session:customerId"},
        {"name": "bikeId",     "type": "String",   "example": "bike-17",             "mapping": "user-input"},
        {"name": "startTime",  "type": "DateTime", "example": "2026-06-01T09:00:00Z","mapping": "user-input"}
      ]
    }
  }]
}
```

**Fallback (no MCP):** see `references/api-fallback.md` — "Creating a COMMAND node — full manual sequence (Steps A–D)".

> **Never call `drop` after using `cellId` in `node:created`.** The drop endpoint adds a second cell reference without removing the first. `node:created + cellId` is the only placement step needed.

### Preventing backward arrows (mandatory pre-placement check)

A `SCREEN → COMMAND` connection must always go downward within the same column (actor row → interaction row). A `COMMAND → EVENT` connection must also be within the same column. Both are inherently forward because they share a column.

However, if a screen placed in Step 3 (Storyboarding) is in a column that is **different** from the event column, the connection will span columns and may go backwards. Before placing a command:

1. Confirm the screen for this command is in the **same column** as the event it produces.
2. If the screen is in an earlier column, move it to the event's column before wiring.
3. If the screen is in a later column, move the event's column (by inserting a new column at the correct index) or move the screen to match.

The timeline must always read left-to-right: SCREEN and COMMAND belong in the same column as the EVENT they produce.

### Wire connections after placing each COMMAND

After `place-element` returns the COMMAND node ID, create the arrows that complete the slice:

1. **SCREEN → COMMAND** — find the SCREEN node in the actor row of the same column.

   **Prefer MCP** — there is no `cellId` filter on `get_nodes` (see note below), so read the chapter's cell map instead — `projection: "cells"` returns just `{rows, columns, cells}`, not the whole chapter node:
   ```
   mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
   ```
   Read `cells["<actorRowId>-<columnId>"]` for the occupying node id (a cell id absent from that sparse array is empty — no SCREEN placed yet). Then connect with the type-checked edge tool, which auto-corrects direction and skips duplicates:
   ```
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<screenNodeId>", "target": "<commandNodeId>", "action": "connect" }
   ```
   If wiring more than one COMMAND in the same pass, prefer batching every SCREEN→COMMAND and COMMAND→EVENT pair across all of them into one `set_connections` call (see step 2 below) instead of one `set_connection` per pair.

   **Fallback (no MCP):** see `references/api-fallback.md` — "Wire connections — Step 1: SCREEN → COMMAND".

2. **COMMAND → EVENT** — find the EVENT node in the swimlane row of the same column.

   **Guard**: if the occupying EVENT node belongs to a different (external) swimlane than this chapter's own default swimlane, stop — do not create this connection. An external system's own event cannot be the thing this chapter's command produces; that case belongs entirely to Step 4b's translation chain. (This should not arise if the "Identify Processor Triggers" check above was followed, but re-check here before connecting, since it's the point of no return for a wrong edge.)

   **Prefer MCP** — same cell-map lookup, then connect:
   ```
   mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
   ```
   Read `cells["<swimlaneRowId>-<columnId>"]` for the occupying node id, then:
   ```
   mcp__eventmodelers__set_connection { "boardId": "<BOARD_ID>", "source": "<commandNodeId>", "target": "<eventNodeId>", "action": "connect" }
   ```

   **Fallback (no MCP):** see `references/api-fallback.md` — "Wire connections — Step 2: COMMAND → EVENT".

   *Note:* `get_nodes` has no `cellId` filter (only `type`) — the `get_node`-on-CHAPTER (`projection: "cells"`) + `cells` lookup above is the only way to check single-cell occupancy via MCP.

Skip a connection silently if the target cell is empty (the element may be placed in a later step). Log each created arrow: `→ connected SCREEN→COMMAND "PlaceOrder"` or `→ connected COMMAND→EVENT "PlaceOrder"→"OrderPlaced"`.

If wiring more than one COMMAND in this pass, send all the SCREEN→COMMAND and COMMAND→EVENT edges in one `set_connections` call with `compact: true` — you author every edge here deliberately, so the `{connected, existed, removed, notFound, failed, errors}` tally is enough.

**After wiring, run `validate_model` (`{boardId, chapterId}`).** Its `command-issuers` finding flags any COMMAND that ended up with two issuers — the classic symptom of the platform's auto-connect cross-wiring a previous-column SCREEN into a command that an AUTOMATION already drives (or vice versa). Fix each by removing the wrong edge. If you already know a placement sits next to an unrelated column whose SCREEN/AUTOMATION would be mis-wired, place that COMMAND with `autoConnect: false` and wire its single real issuer yourself.

After all commands are placed and wired, present the Command Catalog summary as text to the user.

---

Older versions of this skill wrote the command catalog as a markdown document rather than placing nodes on the board — that legacy template is kept in `references/examples.md` for reference only; it is not the actual output mechanism.

## Quality Checklist

- [ ] Every UI action maps to a command
- [ ] Every processor action maps to a command
- [ ] **Every command is attributed to a specific role/actor from the Role Catalog**
- [ ] **No command uses generic "User" — must name the specific role (Customer, Seller, Admin, etc.)**
- [ ] Every command input is documented
- [ ] Every input validates against rules
- [ ] Preconditions from stream state are explicit
- [ ] Success and failure outcomes documented
- [ ] Implicit context from stream state is identified
- [ ] No undocumented commands exist
- [ ] Command naming is consistent and clear
- [ ] Processor triggers are explicit
- [ ] **Processor todo list pattern explained for each automation**
- [ ] **Event-to-todo triggering mechanism documented**
- [ ] **Automation marked with [AUTO] to distinguish from user actions [USER]**
- [ ] **Processor failure/retry handling specified**

## Key Principles

1. **Source Clarity**: Every command comes from UI or Processor
2. **Input Completeness**: All needed data captured
3. **Validation Explicit**: All rules documented
4. **State Awareness**: Preconditions from stream state clear
5. **Event Mapping**: Every input becomes event data

## Common Patterns

### User Command Pattern
```
User action on UI screen
  ↓
Captures form/selection data
  ↓
Validation checks
  ↓
Command issued
  ↓
Event created or rejection
```

### Processor Command Pattern
```
External event/webhook received
  ↓
Triggers processor logic
  ↓
Processor validates and decides
  ↓
Command issued (if valid)
  ↓
Event created or decision recorded
```

### Conditional Input Pattern
```
Command: PaymentConfirm
Input:
  - paymentMethod (user selected)
  - paymentDetails (conditional on method)
    If method='card': cardNumber, CVV, expiry
    If method='transfer': bankAccount, routingNumber
```
