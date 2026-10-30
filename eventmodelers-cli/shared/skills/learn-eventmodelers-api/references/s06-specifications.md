## 6. Specifications (GWT Scenarios)

**File**: `src/slices/change/api-specs/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/columns/:columnId/scenarios`
Append Given-When-Then scenario(s) to a column's spec node — the node is created automatically if the spec cell is empty. Accepts a single scenario object or an array.

**Request body**:
```typescript
{
  id?: string       // generated when omitted
  title: string
  vertical?: boolean
  examples?: unknown[]
  context?: SpecStep[]  // READMODELs the command decides against
  contextNote?: string  // markdown background — ONLY what events, commands and read models can't express
  given?: SpecStep[]  // EVENTs from this timeline
  when?: SpecStep[]   // at most one COMMAND, or one inline QUERY object; empty if then has a READMODEL
  then?: SpecStep[]   // EVENTs only OR exactly one READMODEL (not mixed)
  expectError?: boolean, errorDescription?: string   // error case: leave `then` empty
}

// A step is addressed either way:
{ id: 'node-uuid' }                          // a board node
{ title: 'OrderPlaced', type: 'EVENT' }      // resolved against this timeline's own elements

// Either form also carries the step's values for this scenario — the fields essential to it, each with its example:
{ title: 'OrderPlaced', type: 'EVENT', fields: [{ name: 'orderId', example: 'o-42' }, { name: 'placedAt', example: '2026-10-12' }] }
```

`fields` is what the board shows on the step and what generated tests use as the scenario's data. Fill the values the scenario depends on (what the rule decides on, linking ids, the asserted outcome) and leave the rest out, so it is clear which data is relevant — a value that only appears in `contextNote` is not part of the specification.

A step given as `{title, type}` is resolved server-side, so the names you already know need **no `get_spec_info`/`get_nodes` call first**. A title matching more than one element is rejected (`SCENARIO_ITEM_AMBIGUOUS`) with the candidates rather than guessed at, and resolution runs before anything is written — a bad name leaves no empty spec node behind.

**Validation rules**:
- `context`: only READMODELs (the state the command decides against)
- `contextNote`: free markdown, last resort. State belongs in `given` events (or `context` read models), inputs in the `when` command's fields, outcomes in `then` — a note never replaces or repeats any of them. Use it only for background no element can carry: an external condition ("the payment provider is in maintenance"), a business assumption, the reason a case matters. Blank notes are dropped. Exported as `contextNote` on the scenario in slice data
- `given`: only EVENTs from same timeline
- `when`: max one COMMAND; must be empty when `then` contains a READMODEL (use an inline QUERY item for a state-view)
- `then`: all EVENTs OR exactly one READMODEL — never mixed
- All referenced nodes must belong to the same chapter/timeline
- Each section is checked against the node's real type: a COMMAND lives only in `when`, a READMODEL only in `then`/`context`, an EVENT only in `given`/`then`. A step's `type`, when sent, must match the node (`SCENARIO_ITEM_TYPE_MISMATCH`); when omitted, the node's type is stored on the step

**Response**:
- `201` — `{ specNodeId, scenarios, added, isNewNode: boolean }`
- `400` — validation error
- `404` — timeline, column, or a referenced node not found
- `409` — duplicate scenario title

---

### GET `/api/org/:orgId/boards/:boardId/timelines/:timelineId/spec-info`
Get the elements a scenario's given/when/then steps may legally reference (EVENT, COMMAND, READMODEL of that timeline). Only needed when you want the ids themselves — a scenario step can name its element by title instead.

**Response**: `200` — `{ timelineId: string, elements: ElementRecord[] }`

---

### Storylines

> **Create a storyline whenever `eventmodeling-elaborating-scenarios`'s GWT-vs-storyline decision
> rule calls for one** (e.g. a todo list's open→close lifecycle) — that skill's own per-read-model
> judgment is the trigger, not a specific word in the user's request. GWT scenarios via
> `add_scenario`/`POST .../scenarios` still cover everything the decision rule doesn't.

An ordered, branchable walkthrough of existing board elements ("beats"), stored alongside GWT
scenarios on the same SCENARIO spec node, in a sibling `meta.storylines` collection.

### POST `/api/org/:orgId/boards/:boardId/timelines/:timelineId/columns/:columnId/storylines`
Append one or more storylines to a column's spec node. The spec node is auto-created if missing
(shared with scenarios).

**Request body**: a single storyline object or an array:
```typescript
{
  id?: string            // generated when omitted
  title: string          // must be unique within the spec node
  description?: string
  layout?: 'horizontal' | 'vertical'
  beats: Array<{
    instanceId?: string  // unique per beat, even when the same element repeats — generated when omitted
    refId?: string       // board node id — must belong to the same timeline. Omit it to address by title
    type?: string        // with a title lookup: narrows it to EVENT / COMMAND / READMODEL
    title?: string       // required when refId is omitted
    isError?: boolean    // marks an alternate/error branch off the previous beat
    fields?: unknown[]
    expectEmptyList?: boolean
    exampleMode?: string
    examples?: unknown[]
  }>
}

// A note beat — free markdown anywhere in the sequence, referencing no element:
{ instanceId: 'uuid', refId: '', type: 'STORYLINE_NOTE', title: 'Note', note: 'markdown' }
```

A note beat is the storyline's `contextNote`: only for what the beats themselves can't express (an external condition, an assumption, a time gap like "two weeks later"). Never use one to stand in for an event, command or read model that should be a beat — model the element instead. It is exported as an element `{id: instanceId, type: 'STORYLINE_NOTE', description: note}`; an empty note is rejected (`STORYLINE_NOTE_EMPTY`).

A beat is addressed either way, like a scenario step:
```typescript
{ refId: 'node-uuid' }                           // a board node — always wins, never re-resolved
{ title: 'OrderPlaced', type: 'EVENT' }          // resolved against this timeline's own elements
```

A beat given as `{title, type}` is resolved server-side, so no `get_spec_info`/`get_nodes` call is needed first — and a storyline needs no ids minted by the caller. Only `EVENT`, `COMMAND` and `READMODEL` elements can be named (what `GET .../spec-info` serves); any other element type still needs its `refId`. A title matching more than one element is rejected (`STORYLINE_BEAT_AMBIGUOUS`) with the candidates rather than guessed at, and resolution runs before anything is written — a bad name leaves no empty spec node behind. Payloads that carry `id`, `instanceId` and `refId` behave exactly as before.

**Response**:
- `201` — `{ specNodeId, storylines, added, isNewNode }`
- `400` — validation error (`STORYLINE_BEAT_AMBIGUOUS`: a title matches several elements; `STORYLINE_BEAT_REF_ID_MISSING`: a beat has neither `refId` nor `title`)
- `404` — timeline, column, or referenced node / title not found
- `409` — duplicate storyline title

---
