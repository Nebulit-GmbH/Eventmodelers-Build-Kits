---
name: walkthrough
description: Walk a person through a feature slice by slice, as a player in the chat. It opens with a summary page (how many slices, how the feature works in 1–3 sentences), then one step per slice, each shown in its lanes like Slice View (screen, command / read model, events). Two modes — explain ("how does registration work?") follows the feature's slices in the order they run; impact ("we need to add an email — walk me through the changes") lists every slice a planned feature needs, marked as existing, needing adjustment or new, with new slices sketched. Each step carries a description, the business rules that apply, what changes there and a link that zooms the canvas to the slice. Read-only — changes nothing on the board.
---

# Walkthrough — slice by slice through a feature

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback and §16 *Chat snippets* for the `walkthrough` shape.

The result is **one `walkthrough` snippet** in the chat. **Its unit is the slice**: one step per slice, never per element. The player always opens with a **summary page** — "This feature consists of 6 slices" (for a planned feature: "…: 2 of them exist, 1 existing one needs adjustment and 3 have to be implemented from scratch"), worked out from the steps, plus your 1–3 sentence `summary` of how it works. Each step after that shows its slice the way Slice View does — the screen on top, command / read model in the next lane, events at the bottom — and a slice that doesn't exist yet is drawn as a sketch from the elements you give it. Selecting a step zooms the canvas to the slice; **Play** opens everything full-screen with the description, the changes and the rules underneath. The walkthrough is only as good as its links: every existing slice points at its real `SLICE_BORDER` on this board.

**This skill never writes to the board.** In impact mode it shows what would change; making those changes is separate work the person asks for afterwards.

---

## Step 1 — Mode and subject

From `$ARGUMENTS` / the message, and the turn's `context=` (selected nodes, `timelineId`, `focusArea` — resolved as in the kit's CLAUDE.md):

| Mode | Typical message | The steps are |
|---|---|---|
| `explain` | "How does registration work?", "walk me through checkout", "/walkthrough Registration" | the feature's slices in the order they run, as a person experiences them |
| `impact` | "We need to add an email — walk me through the changes", "what does it take to support refunds?" | every slice the planned feature needs — existing ones it uses, existing ones to adjust, new ones to build — in the order they run |

The **subject** is the process or the change, in the person's words. "This"/"here" means what they have selected or zoomed to.

**Which mode** — decide by whether the subject is on the board yet, not by the phrasing. Anything the person calls *new*, *planned*, *a feature we want/need*, *support for X*, or that the board doesn't model yet (a new license type, a new field, a new flow) is **impact**, even when they say "walk me through the X feature". Only a flow that is fully modelled as it should work is **explain**. In doubt, impact — an impact walkthrough of an unchanged flow just marks every slice `existing`, while an explain walkthrough of a planned feature hides which slices are new.

### No subject yet — ask first

Called without one (a bare `/walkthrough`, the chat menu's entry sent as is, "walk me through" with nothing named), **ask before reading anything in detail** — the selection or the chapter in view is not enough on its own to guess which flow or which feature they mean. One cheap read for the options: `get_nodes { boardId, type: "CHAPTER", projection: "line" }` (and, for a single chapter, `list_slices`). Then reply once and **end the turn**:

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "replyTo": "<message_id>",
  "text": "Which flow should I walk you through? Or tell me the new feature you're planning, and I'll walk you through what it changes.",
  "snippet": {
    "kind": "poll",
    "question": "Walk through which flow?",
    "options": [
      { "label": "Registration", "message": "/walkthrough How does Registration work?" },
      { "label": "Checkout",     "message": "/walkthrough How does Checkout work?" }
    ]
  }
}
```

- The options are the board's flows — chapters, or the main slices when the board has one chapter — at most ~8, the one in the person's view first. Each option's `message` is a complete `/walkthrough …` request, so the pick comes back as a new message that runs this skill with its subject.
- The text always offers the **impact** mode in words ("tell me the new feature you're planning") — a planned change can't be picked from a list; the person types it, and their reply is the subject.
- Fewer than two flows on the board: ask in the text only, no snippet. An empty board: say there is nothing to walk through yet.

The same goes for a subject that is still too vague with the context (several chapters equally likely): ask with a `poll` of those candidates — don't guess between them.

---

## Step 2 — Outline first: where on the board is it?

Orient cheaply before reading anything in detail — the board can be large, and only a handful of nodes matter.

1. **Chapters**: `get_nodes { boardId, type: "CHAPTER", projection: "line" }` — pick the chapter(s) the subject belongs to by title. With a `timelineId` in context, start there.
2. **Context notes**: for each candidate chapter, `get_board_outline { boardId, chapterId }`, then read the MARKDOWN note in the first column's `feedback` lane (`get_node`, `meta.description`) if there is one. It says what the chapter is for and often names the decisions behind it — use it in the descriptions.
3. **Slices**: `list_slices { boardId, contextName }` and `get_slice_data { boardId, contextName, projection: "outline", format: "toon" }` — every slice with its elements as `{id, title, type}`. This trimmed outline is your overview of the feature: pick the slices from it, and read nothing else board-wide.
4. **Find the slices that matter.** With the outline in hand, decide which **slices** belong to the subject — elements only tell you which slice to pick:
   - **explain**: the slices whose commands, events, read models or screens are about the subject; follow the edges in the outline (screen → command → event → read model → next screen, events → automations) from the slice where the feature starts to the one where it ends. Other chapters only when the flow crosses into them (an external or translated event).
   - **impact**: start from the slice the change lands on first (where the new data enters, or whose event changes meaning), then follow the flow **downstream** — every slice whose events would carry it, every state view and automation fed by those events, every screen that shows them — and **upstream** where the data has to come from. A name search helps: `get_nodes { boardId, name: "<term>", projection: "line" }` for the field or concept ("email") finds the slices that mention it already. Then work out the slices the feature needs that **don't exist yet** (a new command, a new state view, a new automation) — each is one new slice.

Stop widening when a further slice adds nothing the person asked about. A walkthrough of 3–12 slices is typical; 20+ means the subject is really several features — say so in the text and walk the first one.

---

## Step 3 — Read only those

Now read the chosen slices in detail — never the whole board:

- `get_slice_data { boardId, contextName, sliceId, projection: "fields", format: "toon" }` per chosen slice — fields and dependencies, compact. Not the `textual` format: it repeats the slice's specs under every element.
- `get_slice_data { boardId, contextName, sliceId, projection: "specs", format: "toon" }` — the **scenarios**: these are the business rules. A scenario's title in business words ("Email must be unique") is a rule; its Given/When/Then says when it applies.
- Full `get_nodes { boardId, nodeIds: [...] }` only for the few nodes whose `description` you need.

---

## Step 4 — Build the summary and the steps

**One step per slice**, in the order the feature runs. Never split a slice into element steps (no separate "command" and "event" steps) — the player already draws the slice's screen, commands, read models and events in its lanes. Scenarios are not steps either: their rules go into the slice's `rules`, new or changed cases into its `changes`.

**explain** — the slices as the person living the feature experiences them: *what they see and do → what is recorded → what that makes visible or triggers*.

**impact** — every slice the feature needs, existing or not, in the order the feature runs (not grouped by status). **Every step carries a `status`** — it is what the summary page counts ("8 slices: 3 exist, 2 need adjustment, 3 are new") and what each slice's chip shows; a step without one leaves the person guessing what is new:

| `status` | When |
|---|---|
| `existing` | the slice is used as it is — the person should see it to understand the feature, but nothing changes |
| `changed` | the slice exists and needs adjustment — say what in `changes` |
| `new` | the slice doesn't exist yet and is built from scratch — sketch it with `elements`, say what it does in `description` |

Leave out existing slices that are neither changed nor needed to follow the feature. Say what is *not* affected only if the person would reasonably expect it to be.

**Summary** (snippet level) — always. 1–3 sentences on how the feature works (explain) or what it adds and how (impact), in the board's language. Don't count the slices in it — the player puts the count above it ("This feature consists of 6 slices: 2 of them exist, …"), computed from the steps and their `status`.

Per step:

| Field | What goes in |
|---|---|
| `title` | the slice's name as on the board; for a new slice a name in the board's style ("Confirm Email") |
| `description` | 1–3 sentences: what happens in this slice and why it matters, in the board's language. No ids, no cell addresses. |
| `nodeId` | the slice's `SLICE_BORDER` id from `list_slices` — the player draws the slice from it and zooms the canvas to it. Left out for a `new` slice |
| `status` | **impact mode: required on every step** — `existing`, `changed` or `new` (table above). Omitted in explain mode |
| `elements` | **`new` slices only**: the sketch — `[{ "type": "SCREEN" \| "COMMAND" \| "EVENT" \| "READMODEL" \| "AUTOMATION", "title": "…", "fields": ["…"] }]`, the elements the slice will have (a state change: screen → command → event; a state view: event(s) → read model → screen; an automation: read model → automation → command → event). Titles and fields in the board's style; reuse the names of existing events the slice reads from |
| `screenId` | only when the screen a person sees in this step is not part of the slice itself |
| `rules` | the business rules of this slice, taken from its scenarios (and the context note); one line each, thresholds verbatim. Empty when there are none — never invent one |
| `changes` | **impact mode only**: what has to change or be built in this slice, one line each — "add field `email` (String) to Register Customer", "new scenario: duplicate email is rejected" |

**Faithfulness.** Existing slices come from the board. A rule nobody modelled is not a rule — if the walkthrough reveals a gap ("nothing says what happens when confirmation never arrives"), mention it in the step's `description` as an open question, not as a rule. A sketched new slice is a proposal, and the `description` should read like one.

---

## Step 5 — Post it

**One** `post_chat_message`: in a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`.

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "replyTo": "<message_id>",
  "text": "Registration in 4 slices — step through it here, or press Play.",
  "snippet": {
    "kind": "walkthrough",
    "title": "How registration works",
    "summary": "A customer signs up with name, email and password. The account stays inactive until the email is confirmed through the link sent to them.",
    "steps": [
      { "title": "Register Customer", "nodeId": "<slice border id>",
        "description": "Name, email and password are entered on the registration screen and recorded as Customer Registered.",
        "rules": ["Email must be unique", "Password at least 12 characters"] },
      { "title": "Send Confirmation Mail", "nodeId": "<slice border id>",
        "description": "An automation picks up every new registration and sends the confirmation link." }
    ]
  }
}
```

Impact mode, same shape with `status` (and `changes`, or `elements` for a new slice) per step:

```
"summary": "Customers register with an email that has to be confirmed before the account becomes active. Registration stores the email, and a new confirmation flow sends and checks the link.",
"steps": [
  { "title": "Register Customer", "nodeId": "<slice border id>", "status": "changed",
    "description": "The email enters here and has to be validated before anything is recorded.",
    "changes": ["Add field email (String) to Register Customer and Customer Registered", "New scenario: duplicate email is rejected"],
    "rules": ["Customer name is required"] },
  { "title": "Confirm Email", "status": "new",
    "description": "Proposed: the customer opens the link and the email is marked as confirmed.",
    "elements": [
      { "type": "SCREEN",  "title": "Confirm Email Page" },
      { "type": "COMMAND", "title": "Confirm Email",   "fields": ["customerId", "token"] },
      { "type": "EVENT",   "title": "Email Confirmed", "fields": ["customerId", "confirmedAt"] }
    ],
    "changes": ["New slice: Confirm Email (state change)"] },
  { "title": "Customer List", "nodeId": "<slice border id>", "status": "existing",
    "description": "Shows the customers as before; confirmation doesn't change it." }
]
```

- `text` is one line: the subject and the number of slices — in impact mode with the split ("Startup license in 8 slices: 3 new, 2 to adjust"). It is the fallback, so it must make sense alone.
- Impact mode: before posting, check that every step has a `status`, every `changed` step has `changes` and every `new` step has `elements` and no `nodeId`.
- `summary` is always there — the first page shows it under the slice count.
- Every `nodeId` / `screenId` is an id you read in Steps 2–3 — never a guessed or remembered one. A `new` slice has no `nodeId`.
- The snippet is at most 64 KB; keep descriptions short rather than dropping steps.
- **Impact mode** ends there: the walkthrough is the proposal. If the person then asks for the changes, that is ordinary work (prompts per the kit's CLAUDE.md) — and a slice that is not `Created` still needs their confirmation first.

**No chat** (run from a terminal): print the slice count and the summary, then the steps as a numbered list with the same fields, instead of posting.
