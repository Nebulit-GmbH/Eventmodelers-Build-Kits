---
name: experience-model
description: Build or change the experience model (interaction model) of a slice — what happens around its screen before and after the slice runs — a modal opens, the user navigates on and which values (e.g. email) are handed to the next screen, a row is selected, a list is filtered, a permission or visibility check. Use for any request like "open a modal first", "after submit go to Customers with the email", "only admins see this", "select a row to show details", "add a filter".
---

# Experience model of a slice

The experience model is a small event model of its own that describes **what happens around a slice's screen**: before the slice runs (`phase: "pre"` — when the page is entered) and after it (post — when the user acts). It is stored on the slice border and exported with the slice as `interactionModel`. The UI build kit turns it into behaviour (`use-interaction-model`), so what you write here is what gets built — **presentation only, never business rules**.

Two tools do the work: `get_interaction_model` and `set_interaction_model`. `set_interaction_model` **replaces the whole model**, so always read first and send back everything you keep.

## Step 1 — Find the slice and read what is there

1. The slice: from the prompt's `node_id` / selected slice, else `sliceTitle`. Never guess between two slices with the same title — the tool lists the candidates.
2. `get_interaction_model { boardId, sliceId | sliceTitle }` → the stored `model` (or `null`). Keep it; you change it, you don't rebuild it from nothing.
3. Read the slice's screen: `get_slice_data { boardId, contextName, projection: "outline" }` gives the slice's `screens[]`, `readmodels[]`, `commands[]`; then `get_node` on the screen for `meta.pages` (how many pages, what each shows) and `meta.marks` (`id`, `name`, `pageIndex`, `component` / `interaction`). **Page numbers and mark ids you write must exist** — never invent them.

## Step 2 — Only link ORIGINAL elements

A node whose `meta.linkedTo` (or `node.data.linkedTo`) is set is a **copy**: follow it to the origin (on a screen, `linkedTo` is a board link ending in `moveToWidget=<origin id>`) and link the origin's id. Never link a copy. Screens and read models you link must exist on the board; read models must be in the slice's own context.

## Step 3 — Write the steps

A step is `{ phase?: "pre", command?, events? }`: the user does something (`command`, at most one), the UI reacts (`events`, up to 8). **The link (screen, read model, page, marks) always sits on the event, never on the command.** The slice itself is step 1 and is never stored. Pre steps come first.

| User does (command `kind`) | UI reacts (event `kind`) | What the event carries |
|---|---|---|
| `check-permission` (`roles`) | `permission-checked` (`roles`) · `permission-denied` | `refs.screen` = the screen shown instead, on `permission-denied` |
| `check-visibility` | `visibility-checked` (`condition`) | plain-text `condition` |
| `open-modal` | `modal-opened` | `refs.screen` + `refs.page`: the screen/page whose **marked component** shows in the modal. **Pre** when the modal holds the slice's command form (rule 6) |
| `click-component` (pre or post) | `component-clicked` | `refs.marks`: the `interaction` mark of the slice's screen that is clicked. **Pre** when the click opens what the slice's command is submitted from (a button that opens a modal) |
| `submit` (fires the slice's own command) | `submitted` | — **and no screen / read model on this step (rule 7)** |
| `navigate` (its own step, after the slice's command) | `navigated` | `refs.screen` (+ `refs.page`), `refs.field` = id the route carries, **`fields` = the values handed to the target screen, e.g. `["email"]`** |
| `select-item` | `selection-changed` | `refs.readModel`, `refs.field` = id field of the row |
| `filter` (`fields` = what is filtered by) | `component-updated` | `refs.readModels` |
| — | `component-placed` (`refs.marks`) · `component-rendered` (`refs.screen`, `refs.page`) | first pre events: what is placed and which page the user starts on |
| — | `item-highlighted` | `refs.readModel`, `refs.field` = the field that holds the viewer |

Anything else is a **custom item**: a `title` and `description` in the person's words, no `kind`.

### Rules

1. **Build only what the request says.** No extra dialogs, cancel buttons or confirmations — what obviously follows (closing a dialog) is plain UI the builder adds.
2. **Hand values over with `fields` on `navigated`.** If the next screen shows one record (a profile, a detail page), put the identifying value in `fields` (`["email"]`) — that is what scopes the next screen's read model to that record. Use values the slice already has (its command / event / screen fields); don't invent fields.
3. **Pages follow the screen.** `component-rendered` names the page the user starts on; `modal-opened` the page whose marked component appears in the modal; a page no step mentions is not built. Check against `meta.pages` and `meta.marks`.
4. **Keep step order = left to right**: pre steps, then post steps in the order things happen. Pair each command with its event (the editor adds the partner automatically; you must send both).
5. Titles are short, in the editor's wording (`Open modal`, `Modal opened`, `Navigated`).
6. **Pre or post is decided by the slice's own command — and the tool never refuses a phase.** Every kind can go in either phase; one that usually belongs to the other (a `navigate` before the slice, a permission check after it) is saved with a warning, so read `warnings` and move it unless it is intended. Everything the user does *before* that command runs is `phase: "pre"` — and that includes a modal / drawer / wizard step that **holds the form the command is submitted from**: "a button opens a modal, the user submits it" = `click-component` → `open-modal` / `modal-opened` as **pre** steps, the slice's command is the submission. Only what happens *after* the command ran is post (redirect, confirmation, refresh). Ask of every step: does the slice's command need this to have happened first? Yes → pre.
7. **Never a command and a read model in the same slice.** A `submit` step is the slice's own domain command: it ends with `submitted` and links **no** screen or read model — `navigated`, `component-updated`, `item-highlighted`, `selection-changed`, `modal-opened`, `component-rendered` after a submit, or any `refs.screen` / `readModel` on its events, make that column a command *plus* a read model, and `set_interaction_model` refuses it. Where the user goes next is its own **following** step: a `navigate` command with a `navigated` event that links the target screen (`refs.screen`, `fields`). The tool also refuses a post step that opens a modal while a later step submits (rule 6: make it `pre`).
8. **One cause, one step.** Do not stack unrelated results into one step (`Submitted` + `Redirected to thank you`): the result of the user's action is the next screen — one `navigated` event.

### Example — "the button opens a modal, after submission go to the thank-you page"

| # | phase | command → event | links |
|---|---|---|---|
| 1 | `pre` | `click-component` → `component-clicked` | `refs.marks` = the button's `interaction` mark |
| 2 | `pre` | `open-modal` → `modal-opened` | `refs.screen` / `refs.page` = the form screen / page |
| — | the slice | the slice's own command (e.g. *Register customer*) — not stored | |
| 3 | post | `navigate` → `navigated` | `refs.screen` = the thank-you screen, `fields` = the values it shows |

Not: the modal as a post step after the slice, nor a `submit` step with a `Redirected` / `navigated` event stacked in the same step.

## Step 4 — Write and check

`set_interaction_model { boardId, sliceId | sliceTitle, steps: [...] }` — the whole list, existing steps included. The answer lists `problems` (things dropped or cleaned) and `warnings` (unknown kinds). Fix and call again until it is clean. Then say in the reply, in one line each: which steps you added or changed, which screen/page/mark each one links, and — for every `navigated` — which `fields` it hands over.

## What this skill never does

- Edit a **copy** of a screen, or link one — resolve to the original first.
- Touch the slice's command, events, read model or screen content (`html-screen`, `place-element` own those).
- Add a business rule: validation, a guard, a computed value. If the request is one, say it belongs in the slice's scenarios.
