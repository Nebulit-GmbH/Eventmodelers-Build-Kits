---
name: experience-model
description: Build or change the experience model (interaction model) of a slice — everything the user does on its screen and what the UI does in response, before and after the slice's command runs. Use it whenever a request describes behaviour around a screen, even without the words "experience model": a button that opens a modal / dialog / drawer, "after submit go to / show the thank-you page", a confirmation or wizard step, navigating on and handing values (e.g. email) to the next screen, selecting a row to show details, searching or filtering a list, showing or hiding something ("only admins", "only if …"), a permission or visibility check on page entry. Not for the slice's command, events or read model (place-element, timeline) or the screen's content (html-screen).
---

# Experience model of a slice

> **Hard rule — never add or change a screen page on your own.** Not a page, not a mark, not a screen: only after the person has **picked** it from your list (Step 2b). This holds in every mode, also standalone, and also when a page would obviously help. If you find yourself about to render, stop and list it instead.

## When this applies — recognise it, even unnamed

A request is about the experience model when it says **what the user does on a screen and what the UI then does**, whatever the words: *"I want the button to open a modal, and then after submission redirect to the thank-you page"*, *"admins see this, others don't"*, *"clicking a row shows its details"*, *"after saving go back to the list"*, *"add a search"*. Look for these triggers: **open / modal / dialog / popup / drawer · redirect / go to / navigate / back to … page · after submit / after saving / after login · when the user clicks / selects / types · on page load / when the page opens · only visible / only for / hide / show if · filter / search / sort · wizard / step 2 / confirm**. If it also needs new commands, events or read models, build those with their own skills first and then the experience model around them. Do not answer such a request by only editing the screen or the timeline.

The experience model is a small event model of its own that describes **what happens around a slice's screen**: before the slice runs (`phase: "pre"` — when the page is entered) and after it (post — when the user acts). It is stored on the slice border and exported with the slice as `interactionModel`. The UI build kit turns it into behaviour (`use-interaction-model`), so what you write here is what gets built — **presentation only, never business rules**.

Two tools do the work: `get_interaction_model` and `set_interaction_model`. `set_interaction_model` **replaces the whole model**, so always read first and send back everything you keep.

## Step 1 — Find the slice and read what is there

1. The slice: from the prompt's `node_id` / selected slice, else `sliceTitle`. Never guess between two slices with the same title — the tool lists the candidates.
2. `get_interaction_model { boardId, sliceId | sliceTitle }` → the stored `model` (or `null`). Keep it; you change it, you don't rebuild it from nothing.
3. Read the slice's screen: `get_slice_data { boardId, contextName, projection: "outline" }` gives the slice's `screens[]`, `readmodels[]`, `commands[]`; then `get_node` on the screen for `meta.pages` (how many pages, what each shows) and `meta.marks` (`id`, `name`, `pageIndex`, `component` / `interaction`). **Page numbers and mark ids you write must exist** — never invent them.

## Step 1b — Take the slice itself into account (no tool checks this — it is your judgment)

The experience is modelled **around the slice**, never beside it. First tell which kind of slice it is from `get_slice_data` (`commands[]`, `readmodels[]`, `screens[]`): a **state change** slice has a command (and its event) behind a screen; a **state view** slice has only a read model shown on a screen and no command. The two are read differently — see below.

### State change slice (a command)

Before writing a step, say in your reply, in one line each: the slice's **command** (what it does in the business), the **action on the screen that fires it** (the click on Publish, the submit of the form — that is the slice, step 1), the **read model** the screen shows and the **event** that results. Then:

- **Pre** = everything the user does to *provide what the command needs*: choosing / toggling / untoggling items, selecting a row, filtering a list, filling in a form, opening the modal that holds it, a check on page entry. The command is not fired until these are done.
- **The slice** = the firing action. Do not model it a second time (no "Click Publish" or `submit` step that does what the slice already does) — a `submit` step only makes sense when the slice's command really is fired as a *further* action of its own that the slice does not already cover.
- **Post** = only what *follows* the command: a redirect, a confirmation, a refresh of what the screen shows.
- Sanity check: read the steps left to right as a story — *prepare → fire the slice → what follows*. If something is prepared **after** the slice and the same command is fired again, it is the wrong way round: the preparation is pre.

*Illustration only — other slices look different. Slice "Publish Tags for Item" (command Publish, event Tags Published, screen with tag toggles and a Publish button):* pre = the user toggles tags (`click-component` → `component-clicked`, or `select-item` → `selection-changed` / `component-updated` over the *Tags* read model); the slice = pressing Publish; post = nothing, or the screen shows the published state. **Not**: tagging as a post step followed by "Click Publish" and "Published tags shown" — that fires the slice's command twice.

### State view slice (a read model on a screen, no command)

There is no command to prepare and no firing action: the **slice is the read model shown on its screen** (step 1). Say in your reply which read model the screen shows and what the user can do with the data on display. Then:

- **Pre** = what happens when the page is entered, before the data is shown: a permission or visibility check, the shared layout / menu placed (`component-placed`), another screen rendered into this one (`component-rendered`), a filter that is already set.
- **Post** = what the user does *with what the screen shows*, one step per action, each with its result: **select a row** (`select-item` → `selection-changed`, with the id field), **narrow the list** (`filter` → `component-updated` over the slice's read model), **open details** in a modal (`open-modal` → `modal-opened`) or on another screen (`navigate` → `navigated`, handing over the id or value the next screen needs in `fields`).
- No `submit`: a view fires no command. If the user can also *change* something from this screen, that is a different slice (a state change slice with its own screen or button) — model the navigation to it here, nothing more.
- The read model's own fields decide the `fields` and the row id (`refs.field`); a list screen and its detail screen are two slices linked by a `navigated` event that hands the id over.

*Illustration only — other slices look different. Slice "Orders of a customer" (read model Orders on a list screen):* pre = `component-placed` (the shared header) and a permission check if the model asks for it; post = `filter` → `component-updated` (Orders), `select-item` → `selection-changed` (field `orderId`), then `navigate` → `navigated` to the order detail screen with `fields: ["orderId"]`.

## Step 2 — Only link ORIGINAL elements

A node whose `meta.linkedTo` (or `node.data.linkedTo`) is set is a **copy**: follow it to the origin (on a screen, `linkedTo` is a board link ending in `moveToWidget=<origin id>`) and link the origin's id. Never link a copy. Screens and read models you link must exist on the board; read models must be in the slice's own context.

## Step 2b — The page gate: list the pages to add, the person picks — before any `set_interaction_model`

An interaction is easier to read — and to build — when its results are on the board as screen pages: the page a modal shows, the thank-you page a redirect leads to, the list with a row selected, the confirmation state. **This is a gate, not a nicety: do not call `set_interaction_model` before you have passed it.** Compare what the steps would link (`refs.screen` + `refs.page`) with the pages that exist (`meta.pages` of the slice's screen and the screens you found in Step 1), then do exactly one of these:

**A — every page the steps would link exists:** say so in one line ("Using page 2 *Registration form* and the screen *Thank you* — all there"), recommend nothing, ask nothing, and go straight to Step 3.

**B — a page is missing: post a pick list in the chat and stop.** Never render on your own; the person decides how much of it they want. List **the pages that could be added to the screen**, numbered, one line each — *which screen* (the original, never a copy), *what the page shows*, *which step would use it*, and the marks it would carry — and let the person pick. Example:

*Format only — your pages and steps will differ:*

> To show this interaction I can add pages to **Registration**:
> 1. **Registration form** — the form inside the modal (step "Open registration form"); marks: *Register now button*, *Registration form*
> 2. **Thank you** — the page after the redirect (step "Redirect"); mark: *Thank-you message*
> Which should I render? (e.g. "1 and 2", "1", "none")

- Offer only what a step will link: the modal, the target of a navigation, the state a selection or filter leads to — no decorative extras. A UI state that has no read model on the board (the selected tags, the applied filter) is a numbered option too ("3. read model *Selected tags*"), added with `place-element` only on a pick.
- **On a pick** (a number, several, "all", or a prompt that already asks for them): render exactly those with `/html-screen` — append pages to the original screen, keep the look of its existing pages, mind the page limit — **and add the marks with the pages** (the explicit ask `html-screen` needs for marks: both halves — `data-em-mark-id` in the markup and the `meta.marks` entry with its `name` and `pageIndex`): the **`interaction`** mark on the element the user clicks (`component-clicked` links it in `refs.marks`), the **`component`** mark on this slice's own component region, a named **area** mark on a region content is shown in or placed into. Beyond those a **custom mark with a name of your own** is fine ("Tag list", "Error banner"). **Plain marks only: never `blurOutside` or `whiteOutside`.** Only marks a step will link. Then write the steps against those pages (`refs.screen` + `refs.page` by index, and `refs.marks`).
- **On "none", or no answer:** draw the model with the pages that exist, link only pages that exist, and say in the reply which result has no page yet — never invent a page number.

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

Anything none of these says is a **custom item**: a `title` and `description` in the person's words, no `kind` — the exception, not the way to word what a kind already says.

### Rules

**The screens tell the story left to right, in the order the user sees them.** Each result column shows the state the user is in *after that step*; the first column shows where the user starts. Derive the order from the request and the slice, never from a pattern you remember: ask of every step "what does the user see before it, and after it?", and make sure each of those states is shown — by the step's event links (`refs.screen` / `refs.page`) — in the order the user meets them, so that nothing is shown before the state that leads to it. The control the user uses to move to the next state is the trigger of *that* step; the slice's own firing action is whatever the slice's command actually does, and it is not necessarily the first control you notice on the screen. Check the order of your `refs.page` values against this story before you save, and link pages by their place in the story, not in the order they are stored.

**Usually one step at a time.** The experience model shows a UI interaction, and an interaction is one user action with its UI result. Model the one the request describes — a step is a *user action → UI result* pair — and add another only when the request names another action. No long chains "to be complete"; what obviously follows is the builder's.


1. **Build only what the request says.** No extra dialogs, cancel buttons or confirmations — what obviously follows (closing a dialog) is plain UI the builder adds.
2. **Hand values over with `fields` on `navigated`.** If the next screen shows one record (a profile, a detail page), put the identifying value in `fields` (`["email"]`) — that is what scopes the next screen's read model to that record. Use values the slice already has (its command / event / screen fields); don't invent fields.
3. **Pages follow the screen.** `component-rendered` names the page the user starts on; `modal-opened` the page whose marked component appears in the modal; a page no step mentions is not built. Check against `meta.pages` and `meta.marks`.
4. **Keep step order = left to right**: pre steps, then post steps in the order things happen. Pair each command with its event (the editor adds the partner automatically; you must send both).
5. **Stick to the catalog — never make up kinds or titles.** `kind` is one of the table above, nothing else (`set_interaction_model` refuses an unknown kind, and a **new** item without a kind — custom items are made in the editor by a person; the ones already in the model are kept when you send it back). Do not merge two kinds into one made-up event ("Item and tags shown" = `component-rendered` for the screen **and** `component-updated` for the read models, two events). The `title` is the editor's own wording for that kind — `Click component`, `Component clicked`, `Open modal`, `Modal opened`, `Component rendered`, `Navigated` … — never your own (`Save clicked`, `Edit dialog`) — the tool replaces a title of your own with the kind's and keeps yours as the description. What is specific goes into `description` and the links (`refs.marks`, `refs.screen`), and a step's `name` may name the moment ("Open registration form"). A custom item (no `kind`) is only for what no kind says; look through the table first, because a custom item has no reaction defined in the UI kits.
6. **Pre or post is decided by the slice's own command — and the tool never refuses a phase.** Every kind can go in either phase; one that usually belongs to the other (a `navigate` before the slice, a permission check after it) is saved with a warning, so read `warnings` and move it unless it is intended. Everything the user does *before* that command runs is `phase: "pre"` — and that includes a modal / drawer / wizard step that **holds the form the command is submitted from**: "a button opens a modal, the user submits it" = `click-component` → `open-modal` / `modal-opened` as **pre** steps, the slice's command is the submission. Only what happens *after* the command ran is post (redirect, confirmation, refresh). Ask of every step: does the slice's command need this to have happened first? Yes → pre.
7. **Never a command and a read model in the same slice.** A `submit` step is the slice's own domain command: it ends with `submitted` and links **no** screen or read model — `navigated`, `component-updated`, `item-highlighted`, `selection-changed`, `modal-opened`, `component-rendered` after a submit, or any `refs.screen` / `readModel` on its events, make that column a command *plus* a read model, and `set_interaction_model` refuses it. Where the user goes next is its own **following** step: a `navigate` command with a `navigated` event that links the target screen (`refs.screen`, `fields`). The tool also refuses a post step that opens a modal while a later step submits (rule 6: make it `pre`).
8. **One cause, one step.** Do not stack unrelated results into one step (`Submitted` + `Redirected to thank you`): the result of the user's action is the next screen — one `navigated` event.
9. **One screen and one read model per step.** A step is one result: it is shown on one screen (several pages of it are fine, different screens are not) and that screen shows one read model — link that one (`refs.readModel`, or a single entry in `refs.readModels`). `set_interaction_model` refuses a step that links two screens or two read models. **The read model is seen from the UI, not from the data model:** it is what the screen shows or holds *as the result of the step* — the selection, the selected data, the filtered list, the state of the page — not necessarily the slice's whole data set. After "the user toggles a tag" the result is the *selected tags*, not every tag of the item. Pick the read model that stands for that; if the board has none that does, it is a missing piece — recommend it and ask like a missing screen (Step 2b) before adding it with `place-element`, and until then link the closest existing one and say so. **The read model is seen from the UI, not from the data model:** it is what the screen shows or holds *as the result of the step* — the selection, the selected data, the filtered list, the state of the page — not necessarily the slice's whole data set. After "the user toggles a tag" the result is the *selected tags*, not every tag of the item. Pick the read model that stands for that; if the board has none that does, it is a missing piece — recommend it and ask like a missing screen (Step 2b) before adding it with `place-element`, and until then link the closest existing one and say so. A second screen or read model is a second step: show the *Item* in one step, the *Tags* in the next — never "Item, Tags" in one `component-updated`.

### Example shape (one illustration — every request looks different; derive yours from the slice and the request)

| # | phase | command → event | links |
|---|---|---|---|
| 1 | `pre` | the control that leaves the starting state → its result | the starting state's screen / page, and the control's `interaction` mark |
| 2 | `pre` | what the user does to get to the state the slice's command needs → its result | the screen / page of that state |
| — | the slice | its own command, fired by the user's last action — not stored | |
| 3 | post | what follows the command (a navigation, a confirmation, a refresh) → its result | the screen / page the user ends up on, `fields` handed over |

Not: a state shown before the state that leads to it, a column with no screen where the user is somewhere, nor a `submit` step with a follow-up event stacked in the same step.

## Step 4 — Write and check

`set_interaction_model { boardId, sliceId | sliceTitle, steps: [...] }` — the whole list, existing steps included. The answer lists `problems` (things dropped or cleaned) and `warnings` (unknown kinds). Fix and call again until it is clean. Then say in the reply, in one line each: which steps you added or changed, which screen/page/mark each one links, and — for every `navigated` — which `fields` it hands over.

## What this skill never does

- Render a screen or a page **that the person did not pick** (Step 2b) — list the pages first.
- Edit a **copy** of a screen, or link one — resolve to the original first.
- Touch the slice's command, events, read model or screen content (`html-screen`, `place-element` own those).
- Add a business rule: validation, a guard, a computed value. If the request is one, say it belongs in the slice's scenarios.
