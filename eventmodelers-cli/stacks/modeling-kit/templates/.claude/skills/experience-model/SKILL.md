---
name: experience-model
description: >-
  Build or change the experience model (interaction model) of a slice — everything the user does on its screen and what the UI does in response, before and after the slice's command runs. Use it whenever a request describes behaviour around a screen, even without the words "experience model": a button that opens a modal / dialog / drawer, "after submit go to / show the thank-you page", a confirmation or wizard step, navigating on and handing values (e.g. email) to the next screen, selecting a row to show details, searching or filtering a list, showing or hiding something ("only admins", "only if …"), a permission or visibility check on page entry. Not for the slice's command, events or read model (place-element, timeline) or the screen's content (html-screen).
---

# Experience model of a slice

> **Hard rule — never add or change a screen page, a mark or a screen on your own.** Only after the person has **picked** it from your list (Step 4). This holds in every mode, also standalone, and also when a page would obviously help. If you are about to render, stop and list it instead.

## What it is, and when it applies

The experience model is a small event model of its own: **what the user does around a slice's screen and what the UI does in response**, before the slice's command runs (`phase: "pre"`) and after it (post). It is stored on the slice border and exported with the slice as `interactionModel`. The UI build kit turns it into behaviour (`use-interaction-model`), so what you write is what gets built — **presentation only, never business rules**.

A request is about it whenever it says what the user does on a screen and what the UI then does, whatever the words — *"clicking a row shows its details"*, *"admins see this, others don't"*, *"after saving go back to the list"*, *"add a search"*. Triggers: **open / modal / dialog / popup / drawer · redirect / go to / navigate / back to … page · after submit / saving / login · when the user clicks / selects / types · on page load · only visible / only for / hide / show if · filter / search / sort · wizard / step / confirm**. If the request also needs new commands, events or read models, build those with their own skills first, then the experience model around them. Never answer such a request by only editing the screen or the timeline.

Two tools: `get_interaction_model` and `set_interaction_model`. `set_interaction_model` **replaces the whole model** — read first, send back everything you keep.

## Step 1 — Find the slice and read what is there

1. The slice: the prompt's `node_id` / selected slice, else `sliceTitle`. Never guess between two slices with the same title — the tool lists the candidates.
2. `get_interaction_model { boardId, sliceId | sliceTitle }` → the stored `model` or `null`. You change it, you don't rebuild it from nothing.
3. `get_slice_data { boardId, contextName, projection: "outline" }` → the slice's `screens[]`, `readmodels[]`, `commands[]`; then `get_node` on the screen for `meta.pages` (what each page shows) and `meta.marks` (`id`, `name`, `pageIndex`, `component` / `interaction`). **Page numbers and mark ids you write must exist.**

## Step 2 — Take the slice itself into account (your judgment, no tool checks it)

The experience is modelled **around the slice**, never beside it. First tell which kind it is: a **state change** slice has a command (and event) behind a screen; a **state view** slice has only a read model shown on a screen. Say in your reply, in one line each, what you found — it is what the steps are derived from.

**State change slice.** State: the slice's **command** (what it does in the business), the **action on the screen that fires it**, the **read model** the screen shows, the **event** that results.
- **Pre** = everything the user does to *provide what the command needs* (choose or toggle items, select a row, filter, fill in a form, open the modal that holds it) and checks on page entry. The command is not fired until these are done.
- **The slice** = the firing action, step 1. Do not model it again; a `submit` step only makes sense when the command is fired as a *further* action the slice does not already cover.
- **Post** = only what *follows* the command: a redirect, a confirmation, a refresh.
- Read the steps as a story — *prepare → fire the slice → what follows*. Something prepared **after** the slice, with the same command fired again, is the wrong way round: the preparation is pre.

**State view slice** (no command). The **slice is the read model shown on its screen**. State which read model the screen shows and what the user can do with the data.
- **Pre** = what happens on page entry, before the data is shown: permission / visibility check, shared layout placed (`component-placed`), another screen rendered in (`component-rendered`), a preset filter.
- **Post** = what the user does *with what is shown*, one step per action with its result: select a row (`select-item` → `selection-changed`, id field), narrow the list (`filter` → `component-updated`), open details in a modal (`open-modal` → `modal-opened`) or on another screen (`navigate` → `navigated`, id in `fields`).
- No `submit`: a view fires no command. If the user can also *change* something here, that is another slice — model only the navigation to it.

*Illustrations only — other slices look different.* A "publish tags" slice (command Publish, screen with tag toggles): pre = toggling tags, the slice = pressing Publish, post = the published state — not tagging as a post step followed by "Click Publish", which fires the command twice. An "orders of a customer" view slice: pre = shared header, post = filter → select a row → navigate to the detail screen with the order id.

## Step 3 — Only link ORIGINAL elements

A node whose `meta.linkedTo` (or `node.data.linkedTo`) is set is a **copy**: follow it to the origin (on a screen, `linkedTo` is a board link ending in `moveToWidget=<origin id>`) and link the origin's id. Never link a copy, never edit one. Screens and read models you link must exist; read models must be in the slice's own context.

## Step 4 — The page gate: list the pages to add, the person picks — before any `set_interaction_model`

An interaction is easier to read and to build when its results are on the board as screen pages. **Do not call `set_interaction_model` before you have passed this gate.** Compare what the steps would link (`refs.screen` + `refs.page`) with the pages that exist (`meta.pages` of the slice's screen and the screens from Step 1), then do exactly one of these:

**A — every page the steps would link exists:** say so in one line ("Using page 2 *Form* and the screen *Confirmation* — all there"), recommend nothing, ask nothing, go to Step 5.

**B — a page is missing: post a pick list in the chat and stop.** The person decides how much to add. One numbered line per candidate page — *which screen* (the original), *what the page shows*, *which step would use it*, *the marks it would carry* — and let them pick (*format only — your pages and steps will differ*):

> To show this interaction I can add pages to **\<Screen\>**:
> 1. **\<Page name\>** — what it shows (step "\<step name\>"); marks: *\<mark\>*, *\<mark\>*
> 2. **\<Page name\>** — what it shows (step "\<step name\>"); mark: *\<mark\>*
> Which should I render? ("1 and 2", "1", "none")

- Offer only what a step will link — no decorative extras. A UI state with no read model on the board (a selection, an applied filter) is a numbered option too, added with `place-element` only on a pick.
- **On a pick** (numbers, "all", or a prompt that already asks for them): render exactly those with `/html-screen` — append to the original screen, keep the look of its pages, mind the page limit — **with their marks** (the explicit ask `html-screen` needs: both halves, `data-em-mark-id` in the markup and the `meta.marks` entry with `name` and `pageIndex`): **`interaction`** on the element the user clicks (`component-clicked` links it in `refs.marks`), **`component`** on this slice's own component region, a named **area** mark on a region content is shown in or placed into, or a **custom mark with a name of your own**. **Plain marks only — never `blurOutside` / `whiteOutside`.** Only marks a step will link. Then write the steps against those pages.
- **On "none" or no answer:** use the pages that exist, link only those, say in the reply which result has no page yet — never invent a page number.

## Step 5 — Write the steps

A step is `{ name?, phase?: "pre", command?, events? }`: the user does something (`command`, at most one), the UI reacts (`events`, up to 8). The slice itself is step 1 and is never stored; pre steps come first, then post, in the order things happen. **The link (screen, page, read model, marks) always sits on the event, never on the command.** Send both halves of a pair (the editor adds the partner automatically, you must send both).

| User does (command `kind`) | UI reacts (event `kind`) | What the event carries |
|---|---|---|
| `check-permission` (`roles`) | `permission-checked` (`roles`) · `permission-denied` | `refs.screen` = the screen shown instead, on `permission-denied` |
| `check-visibility` | `visibility-checked` | plain-text `condition` |
| `open-modal` | `modal-opened` | `refs.screen` + `refs.page`: the page whose **marked component** shows in the modal |
| `click-component` | `component-clicked` | `refs.marks`: the `interaction` mark of the clicked element |
| `submit` (fires the slice's own command) | `submitted` | nothing linked (rule 5) |
| `navigate` | `navigated` | `refs.screen` (+ `refs.page`), `refs.field` = id the route carries, **`fields` = values handed to the target screen, e.g. `["email"]`** |
| `select-item` | `selection-changed` | `refs.readModel`, `refs.field` = id field of the row |
| `filter` (`fields`) | `component-updated` | `refs.readModels` |
| — | `component-placed` (`refs.marks`) · `component-rendered` (`refs.screen`, `refs.page`) | first pre events: what is placed (**only when the slice's screen has at least one marker** — the editor offers it only then), which page the user starts on |
| — | `item-highlighted` | `refs.readModel`, `refs.field` = the field that holds the viewer |

### Rules

1. **Build only what the request says, usually one step at a time.** A step is one *user action → UI result* pair; add another only when the request names another action. No extra dialogs, cancel buttons or confirmations, no long chains "to be complete" — what obviously follows (closing a dialog) is plain UI the builder adds.
2. **The screens tell the story left to right, in the order the user sees them.** Each result column shows the state *after that step*; the first column shows where the user starts. Derive the order from the request and the slice, never from a pattern you remember: for every step ask "what does the user see before it, and after it?", and show each of those states (by `refs.screen` / `refs.page`) in the order the user meets them, so that nothing is shown before the state that leads to it. The control that moves the user to the next state is the trigger of *that* step; the slice's firing action is whatever its command actually does, not necessarily the first control you notice. Link pages by their place in the story, not the order they are stored; check before you save.
3. **Pre or post follows the slice's command.** Everything the user does *before* the command runs is `pre` — including a modal, drawer or wizard step that **holds the form the command is submitted from**. Only what happens *after* is post. Ask of every step: does the command need this to have happened first? Yes → pre. **`submit` and `navigate` (with `submitted` / `navigated`) are post only** — never part of what leads up to the slice; the editor does not offer them in a pre step and the tool refuses them there. Any other kind in an unusual phase (a permission check after the slice, a placed component after it) is saved with a warning — read `warnings` and move it unless intended.
4. **One screen and one read model per step.** A step is one result: shown on one screen (several pages of it are fine, different screens are not) and that screen shows one read model (`refs.readModel`, or a single entry in `refs.readModels`); the tool refuses two. **The read model is seen from the UI, not the data model:** what the screen shows or holds *as the result of the step* — the selection, the selected data, the filtered list, the page state — not necessarily the slice's whole data set (after "the user toggles a tag" the result is the *selected tags*, not every tag). Link the one that stands for that; if the board has none, it is a missing piece — list it like a page (Step 4) and, until picked, link the closest one and say so. A second screen or read model is a second step; never "Item, Tags" in one `component-updated`.
5. **The slice's own command is not modelled twice, and a command never meets a read model in one step.** A `submit` step ends with `submitted` and links **no** screen or read model (`navigated`, `component-updated`, `item-highlighted`, `selection-changed`, `modal-opened`, `component-rendered`, or any `refs.screen` / `readModel` after a submit make a command *plus* a read model — refused). Where the user goes next is its own following step (`navigate` → `navigated`). The tool also refuses a post `open-modal` step when a later step submits — make it `pre`.
6. **Hand values over with `fields` on `navigated`.** If the next screen shows one record, put the identifying value in `fields` (`["email"]`) — that scopes the next screen's read model. Use values the slice already has; don't invent fields.
7. **Stick to the catalog — never make up kinds or titles.** `kind` is one of the table, nothing else; the tool refuses an unknown kind and a **new** item without a kind (custom items are made in the editor by a person; ones already in the model are kept when you send it back). Don't merge two kinds into one made-up event — "Item and tags shown" is `component-rendered` for the screen **and** `component-updated` for the read model, two events. The `title` is the editor's own wording for the kind (`Click component`, `Component clicked`, `Open modal`, `Modal opened`, `Component rendered`, `Component refreshed`, `Navigated` …), never your own (`Save clicked`) — the tool replaces yours with the kind's and keeps yours as the description. What is specific goes into `description` and the links; a step's `name` may name the moment.

### Example shape (one illustration — every request looks different; derive yours)

| # | phase | command → event | links |
|---|---|---|---|
| 1 | `pre` | the control that leaves the starting state → its result | the starting state's screen / page, the control's `interaction` mark |
| 2 | `pre` | what the user does to reach the state the command needs → its result | the screen / page of that state |
| — | the slice | its own command, fired by the user's last action — not stored | |
| 3 | post | what follows (navigation, confirmation, refresh) → its result | the screen / page the user ends up on, `fields` handed over |

## Step 6 — Write and check

`set_interaction_model { boardId, sliceId | sliceTitle, steps: [...] }` — the whole list, existing steps included. The answer lists `problems` (what was dropped or cleaned), `corrected` (titles replaced by the kind's) and `warnings` (an unusual phase); anything refused comes back as `problems` with nothing saved. Fix and call again until it is clean. Then say in the reply, one line each: which steps you added or changed, which screen / page / mark each links, and — for every `navigated` — which `fields` it hands over.

## What this skill never does

- Render a screen, page or mark **that the person did not pick** (Step 4).
- Edit or link a **copy** of a screen — resolve to the original first.
- Touch the slice's command, events, read model or screen content (`html-screen`, `place-element` own those).
- Add a business rule: validation, a guard, a computed value. If the request is one, say it belongs in the slice's scenarios.
