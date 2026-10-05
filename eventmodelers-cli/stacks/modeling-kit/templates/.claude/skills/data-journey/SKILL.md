---
name: data-journey
description: Follow one piece of information through the model — "where does the customer email come from, and where is it used?" — and show it in the chat as a table. One stop per element it passes through, in flow order — where it originates (a screen, an external event, an import), which events store it, where it is renamed or derived, which read models, screens and automations use it, and where it leaves the system — each with the field name it has there and its slice. Read-only — changes nothing on the board.
---

# Data journey — where a piece of information comes from and where it goes

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback and §16 *Chat snippets* for the `dataJourney` shape.

The result is **one `dataJourney` snippet** in the chat: a table with one row ("stop") per element the information passes through, in the order it flows. Each stop has a **role** — `origin`, `stored`, `transformed`, `used`, `sent` — the **field** it is held in there (names change along the way: `email` on the screen, `customerEmail` in the event), the slice and a few words on what happens to it. A headline above the table counts the roles ("Originates in 1 place, stored in 2 elements and used in 3 places"). Element names are links that zoom the canvas.

Typical questions: *"Where is the customer email used?"*, *"Where does the delivery address come from?"*, *"Which events store the IBAN?"*, *"What happens to the discount code?"*, *"/data-journey customer email"*.

**This skill never writes to the board.**

---

## Step 1 — The subject

The **subject** is one piece of information in the person's words ("customer email", "order total"). From `$ARGUMENTS` / the message, and the turn's `context=`: a selected element with one field selected, or a message like "this field", means that field.

No subject, or several equally likely ("the customer data"): **ask first** and end the turn — a `poll` of the candidates (at most ~8 field names you found, each option's `message` a complete `/data-journey <name>` request), or text only when there is nothing to offer. One piece of information per journey: "name and email" is two journeys — do the first and offer the second in the text.

---

## Step 2 — Find every element that carries it

Cheap reads first, never the whole board in full:

1. **Name search**: `get_nodes { boardId, name: "<term>", projection: "line" }` finds elements whose *title* mentions it; the field names are in `fields`. Search for the obvious variants (`email`, `mail`, `e-mail`; the board's language).
2. **Field search**: per chapter, `get_slice_data { boardId, contextName, projection: "fields", format: "toon" }` — every element's fields with their `mapping`. Collect every field that holds the subject: the same name, a prefixed/renamed one (`customerEmail`, `newEmail`, `recipient`), and — via `mapping` — every field mapped **from** one you already have. Follow `mapping` both ways until nothing new turns up; that is how a rename is traced, not by guessing from names. A field that only *sounds* related (`emailVerified`, `emailCount`) is a different piece of information — leave it out, or mention it in `note` on the stop it sits on.
3. Note `pii: true` on a field — say so in the `summary` if the subject is personal data.

---

## Step 3 — Order and classify the stops

Order the stops the way the information flows — follow the edges (screen → command → event → read model → screen; event → automation → command → …), from where it enters to where it ends. Branches follow their source: after the event that stores it, list the read models fed by it, then the automations.

| `role` | The element … |
|---|---|
| `origin` | is where the information first enters the system: a SCREEN the person types it into, an external/translated event, an import, an API. Usually one; more when it can enter in several ways (registration *and* "change email") |
| `stored` | is an EVENT that records it — the source of truth. Every event carrying the field is a stop |
| `transformed` | changes it: a renamed field via `mapping` (`email` → `recipient`), a derived value, a normalisation stated in the element's description or scenarios ("lower-cased") — say what in `note` |
| `used` | reads it: a COMMAND that only passes it through or checks it, a READMODEL that projects it, a SCREEN that shows it, a scenario that decides on it ("email must be unique") — `note` says how |
| `sent` | hands it outside the system: an automation calling an external service (mail provider, payment, CRM), an outbound integration event |

A command that takes the field from its screen is `used` (it carries it), unless the screen isn't modelled — then the command is the `origin`. Each element appears once; pick the role that says most about it.

Per stop: `title` as on the board, `nodeId` (the element's real id), `field` (the field name on that element), `slice` (the slice title from `list_slices`), `note` in a few business words — no ids, no cell addresses. `elementType` only for a stop that is not a board node.

**Faithfulness.** Only what the board says. If the information is shown on a screen but no read model carries it, or an event stores it but nothing ever reads it, that is a finding — put it in the `summary` ("Stored in Email Changed, but no read model picks the new email up"), not as an invented stop.

---

## Step 4 — Post it

**One** `post_chat_message`: in a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`.

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "replyTo": "<message_id>",
  "text": "The customer email enters at registration and ends up in 5 more places.",
  "snippet": {
    "kind": "dataJourney",
    "subject": "Customer email",
    "summary": "Entered once at registration (personal data), kept in two events and used for login and mails. Nothing shows the changed email after Email Changed.",
    "stops": [
      { "title": "Registration",        "nodeId": "<id>", "role": "origin",      "field": "email",         "slice": "Register Customer", "note": "typed in by the customer" },
      { "title": "Register Customer",   "nodeId": "<id>", "role": "used",        "field": "email",         "slice": "Register Customer", "note": "must be unique" },
      { "title": "Customer Registered", "nodeId": "<id>", "role": "stored",      "field": "customerEmail", "slice": "Register Customer" },
      { "title": "Email Changed",       "nodeId": "<id>", "role": "stored",      "field": "newEmail",      "slice": "Change Email" },
      { "title": "Customer Profile",    "nodeId": "<id>", "role": "used",        "field": "email",         "slice": "Customer Profile",  "note": "shown on the profile page" },
      { "title": "Send Welcome Mail",   "nodeId": "<id>", "role": "sent",        "field": "recipient",     "slice": "Welcome Mail",      "note": "to the mail provider" }
    ]
  }
}
```

- `text` is one line — the subject and where it originates; it is the fallback and must make sense alone.
- Every `nodeId` is an id you read in Step 2 — never a guessed one.
- Long journeys page themselves (5 rows per page); keep every stop in the one snippet.
- If the person then asks to change something (add the field to a read model, mark it as `pii`), that is ordinary work — prompts per the kit's CLAUDE.md.

**No chat** (run from a terminal): print the summary and the stops as a table (role, element, field, slice, note) instead of posting.
