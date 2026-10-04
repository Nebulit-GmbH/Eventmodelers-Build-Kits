---
name: walkthrough
description: Walk a person through the board step by step, as a player in the chat. Two modes — explain ("how does registration work?") follows a process through its screens, commands, events and read models; impact ("we need to add an email — walk me through the changes") lists, in order, every slice, element and scenario a planned change touches and what has to change there. Each step carries a description, the business rules that apply, a link that zooms the canvas to it, and its screen; the person can play it full-screen like the screen movie strip. Read-only — changes nothing on the board.
---

# Walkthrough — step by step through the board

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback and §16 *Chat snippets* for the `walkthrough` shape.

The result is **one `walkthrough` snippet** in the chat. The person steps back and forth through it; selecting a step zooms the canvas to that step's element, slice or scenario, and **Play** opens all steps full-screen as a strip of their screens with the description, the changes and the rules underneath. The walkthrough is only as good as its links: every step points at a real node on this board.

**This skill never writes to the board.** In impact mode it shows what would change; making those changes is separate work the person asks for afterwards.

---

## Step 1 — Mode and subject

From `$ARGUMENTS` / the message, and the turn's `context=` (selected nodes, `timelineId`, `focusArea` — resolved as in the kit's CLAUDE.md):

| Mode | Typical message | The steps are |
|---|---|---|
| `explain` | "How does registration work?", "walk me through checkout", "/walkthrough Registration" | the process in the order it runs, as a person experiences it |
| `impact` | "We need to add an email — walk me through the changes", "what does it take to support refunds?" | every place in the model the change touches, in the order it should be changed |

The **subject** is the process or the change, in the person's words. "This"/"here" means what they have selected or zoomed to.

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
3. **Slices**: `list_slices { boardId, contextName }` and `get_slice_data { boardId, contextName, projection: "outline", format: "toon" }` — every slice with its elements as `{id, title, type}`.
4. **Find the nodes that matter.** With the outline in hand, decide which slices and elements belong to the subject:
   - **explain**: the slices whose commands, events, read models or screens are about the subject; follow the edges in the outline (screen → command → event → read model → next screen, events → automations) from where the process starts to where it ends. Other chapters only when the flow crosses into them (an external or translated event).
   - **impact**: start from the element the change lands on first (the screen or command where the new data enters, or the event whose meaning changes), then follow the flow **downstream** — every event that would carry it, every read model and automation fed by those events, every screen that shows those read models — and **upstream** where the data has to come from. A name search helps: `get_nodes { boardId, name: "<term>", projection: "line" }` for the field or concept ("email") finds the places that mention it already.

Stop widening when a further step adds nothing the person asked about. A walkthrough of 4–12 steps is typical; 20+ means the subject is really several — say so in the text and walk the first one.

---

## Step 3 — Read only those

Now read the working set in detail — never the whole board:

- `get_slice_data { boardId, contextName, sliceId, projection: "fields" }` per relevant slice — fields and dependencies.
- `get_slice_data { boardId, contextName, sliceId, projection: "specs", format: "toon" }` — the **scenarios**: these are the business rules. A scenario's title in business words ("Email must be unique") is a rule; its Given/When/Then says when it applies.
- `get_nodes { boardId, type: "SCENARIO", chapterId, projection: "line" }` — the ids of the scenario nodes, so an impact step can point at a scenario directly.
- Full `get_nodes { boardId, nodeIds: [...] }` only for the few nodes whose `description` you need.

---

## Step 4 — Build the steps

One step per thing the person should look at, in order.

**explain** — follow the process as the person living it experiences it. One step per meaningful moment, usually one slice: *what they see → what they do → what is recorded → what that makes visible or triggers*. Merge a command and its event into one step when nothing happens between them; give an automation its own step.

**impact** — one step per place that has to change, ordered so each step builds on the previous one (where the data enters → the command → the event → read models → screens → automations → scenarios). Include **scenarios** as their own steps when they need a new case or an update (e.g. "add: Register with an email that is already taken → rejected"). Say what is *not* affected only if the person would reasonably expect it to be.

Per step:

| Field | What goes in |
|---|---|
| `title` | short, business words — the moment ("Customer submits registration") or the place ("Register Customer — command") |
| `description` | 1–3 sentences: what happens here and why it matters, in the board's language. No ids, no cell addresses. |
| `nodeId` | the node to zoom to: the **slice** (its `SLICE_BORDER` id from `list_slices`) when the step is about the slice as a whole, the **element** when it is about one element, the **scenario** node when the step is a scenario |
| `screenId` | the SCREEN / HTML_SCREEN shown in this step, if there is one — that is what the player shows. Leave it out otherwise; don't point at an unrelated screen to fill the frame |
| `rules` | the business rules that apply here, taken from the scenarios (and the context note); one line each, thresholds verbatim. Empty when there are none — never invent one |
| `changes` | **impact mode only**: what has to change here, one line each — "add field `email` (String)", "new scenario: duplicate email is rejected", "show email in the confirmation screen" |

**Faithfulness.** Everything comes from the board. A rule nobody modelled is not a rule — if the walkthrough reveals a gap ("nothing says what happens when confirmation never arrives"), mention it in the step's `description` as an open question, not as a rule.

---

## Step 5 — Post it

**One** `post_chat_message`: in a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`.

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "replyTo": "<message_id>",
  "text": "Registration in 5 steps — step through it here, or press Play.",
  "snippet": {
    "kind": "walkthrough",
    "title": "How registration works",
    "intro": "From the sign-up form to a confirmed account.",
    "steps": [
      { "title": "Customer fills in the sign-up form", "nodeId": "<slice id>", "screenId": "<screen id>",
        "description": "Name, email and password are entered on the registration screen.",
        "rules": ["Email must be unique", "Password at least 12 characters"] },
      { "title": "Customer registered", "nodeId": "<event id>",
        "description": "The registration is recorded; the account is not active yet." }
    ]
  }
}
```

Impact mode, same shape with `changes` per step:

```
{ "title": "Register Customer — command", "nodeId": "<command id>",
  "description": "The email enters here and has to be validated before anything is recorded.",
  "changes": ["Add field email (String)", "Reject the command when the email is already registered"],
  "rules": ["Customer name is required"] },
{ "title": "Scenario: duplicate email", "nodeId": "<scenario id>",
  "changes": ["New case: Given Customer registered with x@y.z, When Register Customer with x@y.z, Then rejected"] }
```

- `text` is one line: the subject and the number of steps. It is the fallback, so it must make sense alone.
- Every `nodeId` / `screenId` is an id you read in Steps 2–3 — never a guessed or remembered one.
- The snippet is at most 64 KB; keep descriptions short rather than dropping steps.
- **Impact mode** ends there: the walkthrough is the proposal. If the person then asks for the changes, that is ordinary work (prompts per the kit's CLAUDE.md) — and a slice that is not `Created` still needs their confirmation first.

**No chat** (run from a terminal): print the steps as a numbered list with the same fields instead of posting.
