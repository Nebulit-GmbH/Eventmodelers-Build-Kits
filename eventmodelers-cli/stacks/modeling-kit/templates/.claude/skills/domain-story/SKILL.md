---
name: domain-story
description: >-
  Domain Storytelling on the board — tell the model as a story (actors, the work objects they pass around, numbered sentences "1 Customer places Order to Shop"), written as a small JSON DSL. `/domain-story <chapter>` posts it as a `domainstory` snippet that the person pins as an editable domain story node; `/domain-story refresh` retells the chapter a story node is about into that node; `/domain-story model` turns a story node into an event model chapter (create or update); and any request to extend or change a story node ("add the next step", "rename the actor") edits its DSL with update_domain_story. Never draws an SVG — the app draws the DSL.
---

# Domain story — who does what with which work object

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback, §16 *Chat snippets* for the `domainstory` shape and the element types for `DOMAIN_STORY`.

A domain story is **one JSON document** — the DSL below. The same document is what the `domainstory` snippet carries, what the domain story node stores (`node.data.story`), what the editor saves and what you read and write: there is no picture to draw and no coordinates to place. The app draws it; people edit it on the board.

| The person asks / the app sends | Mode |
|---|---|
| "Tell the ordering chapter as a domain story", `/domain-story Registration` | **Tell** — Steps 1–4 |
| `/domain-story refresh "<title>"` (the node's Refresh button; `context.domainStory = {nodeId, action: "refresh"}`) | **Refresh** — the node is rewritten from the chapter it references |
| `/domain-story model "<title>"` (the node's event-model button; `action: "model"`) | **Model** — the story becomes / updates the event model chapter |
| "add the next step", "the cashier should be a system", "who gets the ticket?" with a story node in context | **Co-write** — edit the node's DSL |

The message text never carries ids: the node comes from `context.domainStory.nodeId`, the chapter it is about from `context.sourceReference` (or the node's `data.reference`). Everything the buttons do, a person can also just ask in words.

---

## The DSL

```json
{
  "version": 1,
  "title": "Ordering",
  "actors":      { "customer": { "name": "Customer", "ref": "<SCREEN id>" },
                   "shop":     { "name": "Shop", "type": "system" } },
  "workObjects": { "order":    { "name": "Order", "icon": "document", "ref": "<EVENT id>" } },
  "sentences": [
    { "who": "customer", "does": "places", "what": "order", "to": "shop", "ref": "<COMMAND id>" },
    { "who": "shop", "does": "confirms", "what": "order", "to": "customer" }
  ],
  "notes": [{ "text": "Payment is covered in the next story" }]
}
```

- **Actors** are roles, not screens: "Customer", "Clerk", "Shop", "Payment Provider". `type`: `person` (default), `group`, `system`, `mobile`, `phone`, `tablet`, `organisation`, `bank`, `factory`, `warehouse`, `school`, `hospital`, `agent`, `bot`, `server`, `database`, `cloud`, `api`, `printer`. One entry per role; ids are short slugs you choose (`customer`).
- **Work objects** are business nouns — "Order", "Invoice" — never `PlaceOrderCommand` or `OrderPlaced`. `icon`: `document` (default), `message`, `data`, `thing`, `conversation`, `info`, `meal`, `furniture`, `money`, `receipt`, `film`, `folder`, `call`, `sms`, `database`, `image`, `calendar`, `cart`, `card`, `delivery`, `key`, `lock`, `checklist`, `contract`, `report`, `form`, `notification`, `qr`, `fax`, `payment`, `badge`.
- **Sentences**: `who` **does** `what` (a work object) `to` someone. `what` and `to` are each optional, one of them is required: `who → what → to` draws two arrows, `who → to` (no object) one. `does` is one verb in the present tense. **Numbers count on by themselves** — leave `n` out; write `n` only to repeat a number (two things told in parallel) or `n: null` (a continuation without number).
- **`ref`** on an actor, work object or sentence is the id of the board element behind it; the picture links to it. Only real ids from the outline — never guessed; a part the board has no element for gets no `ref`.
- **`layout`**, `groups`, `notes`: leave `layout` out when writing a story (the app places the elements); when you change an existing story keep the `layout` the person's edits left in it.

The server (`create_domain_story`, `update_domain_story`) and the app check the DSL; the tools refuse an invalid one and list every problem — fix them all and send it again.

---

## Tell — a chapter as a story

### Step 1 — Which chapters

`get_nodes { boardId, type: "CHAPTER", projection: "line" }`. A chapter named in `$ARGUMENTS` / the message, or a `timelineId` in the turn's `context=`, is the scope; "all" or a bare `/domain-story` on a board with up to 3 chapters means all of them (**one story, one message per chapter**). A bare `/domain-story` on a bigger board: **ask first** with a `poll` of the chapters (at most ~8, the one in view first, each option's `message` a complete `/domain-story <chapter>` request) and end the turn.

### Step 2 — Read each chapter

Cheap reads only:

1. `get_board_outline { boardId, chapterId }` — the columns in order, the lanes (swimlanes name the **actors**: a lane per role or persona; automations and external systems are system actors) and the edges.
2. `get_slice_data { boardId, contextName, projection: "outline", format: "toon" }` — the slices with their elements.
3. The context note (MARKDOWN in the first column's `feedback` lane, `get_node` → `meta.description`) if there is one — it often names the roles.

### Step 3 — Write the sentences

Walk the chapter left to right, **one sentence per thing that happens in the business** — usually one per slice:

| On the board | Sentence |
|---|---|
| SCREEN → COMMAND → EVENT (a state change) | the screen's lane actor *does* (the command's verb) the work object (the business noun the command is about) **to** the system or person that receives it — "Customer places Order to Shop" |
| EVENT → READMODEL → SCREEN (a state view) | the system *shows* / *lists* the work object **to** the actor of the screen — "Shop shows Order Confirmation to Customer" |
| EVENT → AUTOMATION → COMMAND | the automation's system *does* the work object **to** whom it goes — "Billing sends Invoice to Customer" |
| external / translated event | the outside system *reports* the work object **to** the system — "Payment Provider reports Payment to Shop" |

- Reuse the exact same actor id every time — the picture draws one figure per id. Pick a `type` for systems and groups, an `icon` when a work object is not a document (a ticket, a payment, a message …).
- **Set the `ref`s**: the sentence = the step's COMMAND (an EVENT for an external one); the actor = their SCREEN in that step (the AUTOMATION for a system actor); the work object = the EVENT (or READMODEL for a state view) carrying it; the receiver = their SCREEN or AUTOMATION. A figure standing for several elements takes the one of its first step.
- 3–15 sentences per chapter. A step the board does not show is not a sentence — say what is missing in the message `text`, or as a `notes` entry.

### Step 4 — Post it

**One** `post_chat_message` per chapter (in a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`):

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID", "replyTo": "<message_id>",
  "text": "The ordering chapter as a domain story: 4 sentences between Customer, Shop and Payment Provider — pin it to the board to edit it.",
  "snippet": {
    "kind": "domainstory",
    "title": "Domain story — Ordering",
    "caption": "1 Customer places Order to Shop · 2 Shop requests Payment from Payment Provider · …",
    "reference": { "boardId": "$BOARD_ID", "nodeId": "<chapter id>" },
    "story": { …the DSL… }
  }
}
```

`reference` names the chapter the story is about (it is checked: a chapter or context of this organization). The person pins the snippet with its corner button; the node that results holds the DSL and the reference. **This mode never writes to the board.** When the person says "put it on the board" / "add it to the board" instead of pressing the button, create the node yourself with the same DSL:

```
mcp__eventmodelers__create_domain_story { "boardId": "$BOARD_ID", "story": { …the DSL… }, "reference": { "nodeId": "<chapter id>" } }
```

It lands right of the chapter (pass `x`/`y` to choose). No chat (a terminal): print the numbered sentences instead.

---

## Refresh — retell the chapter into the node

1. `nodeId` = `context.domainStory.nodeId`. `get_node { boardId, nodeId }` → the current DSL (`data.story`) and `data.reference` (the chapter). No reference → ask which chapter with a `poll` and end the turn.
2. Re-read the chapter (Steps 2–3) and write the story as the model is now.
3. **Merge, don't replace blindly**: keep the ids, `type`s, `icon`s, `color`s and `layout` of actors and work objects that are still the same; keep `notes` and `groups` the person added; replace the sentences. A part that no longer exists on the board goes; a new one is added without `layout`.
4. `update_domain_story { boardId, nodeId, story }`. Reply in one or two lines: what changed (sentences added / removed / re-worded).

---

## Model — the story becomes the event model

`nodeId` = `context.domainStory.nodeId`; read the DSL and `data.reference` as above. The story says *what happens in the business*; the model is built from it, with the existing skills — do not restate their rules here:

| Sentence | Becomes |
|---|---|
| a person/group actor does something to a system (`who` → `what` → `to`, `to` a system) | SCREEN (the actor's lane) → COMMAND (the verb + noun) → EVENT (the noun as a fact) |
| a system shows / lists a work object to a person | EVENT → READMODEL → SCREEN |
| a system actor does something to another actor | AUTOMATION → COMMAND → EVENT (an outside system: translate its event first) |

- **No reference** — *create*: a new chapter named after the story (`timeline` for the columns, `place-element` for every element, `eventmodeling-orchestrating-event-modeling` for the order of the steps; an outside system → `eventmodeling-translating-external-events`, an automation → `eventmodeling-designing-automation-chains`). Ask with a `questions` snippet only for what the story cannot say (see Co-write); otherwise take the most defensible reading and say so.
- **With a reference** — *update*: read the chapter (`get_board_outline`, `get_slice_data`), compare it sentence by sentence with the story and apply the differences: add what the story has and the chapter lacks, rename what is worded differently. Anything that would **delete** model elements is not done: list it in the reply (or as a `changes` snippet) for the person to confirm.
- Afterwards connect the two: set the `ref`s of the story's actors, work objects and sentences to the elements you built or matched, and set the node's `reference` to the chapter (`update_domain_story { boardId, nodeId, story, reference: { nodeId: <chapter id> } }`).
- Reply with what was created / changed, chapter by chapter, in a few lines.

---

## Co-write — extend or change a story together

The person is writing the story with you ("add the next step", "who prints the ticket?"). Read the node (`get_node` → `data.story`), change the DSL, send the **whole** story back with `update_domain_story` (it replaces the stored one — start from what you read, so the person's layout and edits stay).

- **Ask like a facilitator, one thing at a time**: who does it, what do they do, with which work object, passing it to whom, what happens next. Ask only what the story cannot answer, with a `questions` snippet whose `nodeId` is **the story node's id** (the answer comes back in `context.snippetReply`); never block — when in doubt take the most defensible reading and say so.
- **Propose before a bigger change**: several new sentences or a restructuring → a `changes` snippet (one item per sentence, `changes: [{ field: "sentence", to: "Cashier prints Ticket" }]`, `nodeId` = the story node) and apply after the confirmation. A single obvious step (the person said it) is just done.
- Obvious slips (a typo in a name, the wrong `type` for a system) are fixed directly and mentioned.
- After the change: one line — what was added or changed — not the DSL.
