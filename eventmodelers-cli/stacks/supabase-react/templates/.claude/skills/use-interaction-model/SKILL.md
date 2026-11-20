---
name: use-interaction-model
description: >-
  Build the UI behaviour a slice's `interactionModel` describes (pre and post steps: permission and visibility checks, placed components, modal opens, navigation, clicks on marked elements, selection, filtering, component refresh) into its React component — called by build-state-view and build-state-change whenever slice.json carries an `interactionModel`
---

# Use the Interaction Model

> Called by `build-state-view` (Step 3b) and `build-state-change` (Step 3b) — never on its own. Run it only when
> `slice.json` has an **`interactionModel`**; a slice without one is built exactly as before.
>
> **This is this kit's own definition of how the UI reacts to each event** (React + Supabase, no router, `src/lib/api.ts`). The interaction model only
> says *what* happens; *how* it is realised is specific to each UI kit, so another kit defines its own reactions — nothing here is shared.

## What it is

The person who models the board can describe, per screen slice, **what happens around the screen before the next
command runs** — a modal opens, a row is selected, a filter narrows a list, the user goes to another screen. It is a small
event model of its own, exported in `slice.json` as:

```json
"interactionModel": {
  "steps": [
    { "command": { "title": "Open order", "kind": "navigate" },
      "events":  [{ "title": "Navigated", "kind": "navigated", "field": "orderId",
                    "screens": [{ "id": "s-2", "title": "Order Page" }] }] }
  ]
}
```

- **A step with `phase: "pre"` happens before the slice** (page template applied, authorization applied …): `steps` lists those first. They are built like
  any other step, by the table below — the kinds that can be pre are `check-permission`, `check-visibility`, `component-placed`, `component-rendered`,
  `open-modal`, `select-item` and `filter` with their events. A pre item with a `kind` this table does not know, or a custom one, follows the custom-item row;
  if it is not clear what it asks for, it is a blocker (see "Clear, or a blocker").
- **Steps run in order**, each is *user does something* (`command`) → *the UI reacts* (`events`, one or several). Step 1 of the board's
  interaction model is the slice itself — what is in `slice.json` — and is not repeated here.
- **The event is the fact, the read model is its result, the screen follows from the read model.** `readModels` is what an item works
  on or is refreshed from, `screens` is where those read models are shown. Build the *destination* from the read model, never from
  the interaction item's own title.
- **Links are already resolved** (`{id, title}` of board elements): a `submit` carries the slice's own command; `select-item`, `filter`,
  `selection-changed` and `component-updated` carry the slice's read model unless the person linked another. Use the id to read the
  element (`mcp__eventmodelers__get_node`) or find its slice (`.build-kit/.slices/*/*/slice.json`).
- **It is presentation only.** Like scenarios (Step 3a of the build skills), it describes *how the UI behaves*; business rules stay in the
  backend. Never turn a step into validation, a guard or a derived value.

## How this kit reacts to each `kind`

| `kind` | What the UI does |
|---|---|
| `open-modal` → `modal-opened` | A **modal / drawer** that opens when the user acts. The event's `screens` is the screen the modal shows — its markup is the blueprint (fetch it as in Step 2); `page` says which page of a multi-page screen (0-based, absent = the default page). Closing it is plain UI behaviour; it is not listed unless the model says so. |
| `submit` → `submitted` | The slice's own command: `postCommand` (see `build-state-change`). `submitted` is the state after success (the button disabled while sending, the confirmation the model lists) — nothing more. |
| `click-component` → `component-clicked` | The `onClick` of the **element the event's `marks` point to** (`data-em-mark-id` in the screen's HTML; the fixed markers are named `component`, `interaction`, `trigger` — a `trigger` marker starts the interaction; an **area** marker (purple, named by the person) is a region of the page that content is shown in or placed into — its name says what belongs there). The result of the click is the next step's event. |
| `check-permission` → `permission-checked` / `permission-denied` | A **pre** step: when the page is entered, check the signed-in user's roles against `roles`. Allowed → render; denied → go to / show the event's `screens` (navigation, below). This is **convenience, not security** — the backend enforces; say so in the report. Only built when the roles of the user are available — otherwise it is a blocker (see "Clear, or a blocker" below). |
| `check-visibility` → `visibility-checked` | Whether the component / region is shown at all. The `condition` is **a prompt, not a formal expression**: read the sentence as the person's instruction and build it — a small pure `isVisible(data)` over the fields of the read model it names; samples cover both outcomes (shown / hidden). The same goes for a `description` on `component-placed` or a custom item. Only when the **data** the sentence needs does not exist is it a blocker. |
| `component-placed` | A **pre** step: the named shared component (page template, layout, header, menu) is placed on the page — in `src/App.tsx` for the whole app, in the slice's component at the marker (`marks`; with none set, the screen's `component` marker). Reuse an existing component; never write a second one. |
| `component-rendered` | A component **renders a screen** (pre or post): the event's `screens` is the screen, `page` the page of a multi-page one (0-based, absent = the default). Build a component from that screen's markup (fetch it as in Step 2) and render it where the step sits — in the slice's component, or in `src/App.tsx` for a pre step. Reuse a component that already renders that screen. |
| `item-highlighted` | The row / card whose `field` equals the signed-in user's id is highlighted — styling only. |
| `navigate` → `navigated` | **Go to another page.** The destination is the event's `screens` — the target screen (`src/pages/<ScreenTitle>.tsx`, Step 5/6 of the build skills; `page` picks a page of a multi-page screen) — **the link is always on the event, never on the command**; `field` is the id the route carries (`orderId`) — the destination reads it to scope its read model query. See "Navigation" below. |
| `select-item` → `selection-changed` | The user picks a row/card of the list read model. The selection is **state of the page** (lift it: a prop from the parent, or a colocated `<Name>Context.tsx` when siblings share it — never a global store). `field` names the id field of the row. Components that depend on the selection re-scope their read model query to it. |
| `filter` | A filter / search control narrows the list: pass the filter to `queryReadModel`'s `filters` (never filter rows in the component against data the read model did not return). |
| `component-updated` | The component that shows the event's `readModels` **refreshes** from them: re-run its query when the triggering command/filter/selection changes. |
| *(no `kind`)* | A custom item. Build it from its `title`, `description` and `fields` as presentation-only UI behaviour; if it is not clear what it asks for, make the most sensible interpretation and say so in a code comment — do not stop for it. |

**No `component-placed` event?** Then the slice's own component sits at the screen's **`component` marker** (`meta.marks[]` with `component: true`, the green one) when the screen has one — build it there. The event is only needed to name a *shared* component (template, layout, header, menu) or to point at another marker; with no event and no `component` marker, the unmarked page is the blueprint.

Every item may also carry `description` (the person's own words — read it) and `fields` (data the item works with).

## Pre and post steps, and what a step needs to be built

- A step with `"phase": "pre"` happens **before the slice's own step** — when the page is entered (mount / route change), in array order, before the
  component renders its content: checks (`check-permission`, `check-visibility`), placed components (`component-placed`), a modal that opens with the page.
  Steps without `phase` are **post**: they run when the user acts, in order, after the slice's own step. A step's `name` (when it has one) names its component,
  hook or function and is used in the report.
- A command and its event are a **tandem**: the command is the trigger (what the user or the page does), the event is the result you build and show.
  The **link is always on the event** (`screens`, `page`, `readModels`, `marks`, `field`); a command never carries one.

### Clear, or a blocker — never a guess

For every item, decide **before building anything of the interaction model** whether it is *clear* from the code or the context (`slice.json`, the board
via `get_node`, the code already in this repository, slices already built). **If it is not clear, it is a blocker — do not assume it.** A guessed
permission rule, visibility condition or placed component hides a modelling gap; the person has to model what is missing. (This is the one place where the
build kits' default "assume and build" does not apply.)

| item | clear when | otherwise a blocker — what has to be modelled |
|---|---|---|
| `modal-opened` | the event links the `screens` it shows (`page` optional) | the screen the modal shows |
| `navigated` | the event links its target `screens` | the target screen |
| `component-clicked` | its `marks` resolve to an element of the slice's screen HTML (`data-em-mark-id`) | the marker of the clicked element (or the marker is missing from the screen) |
| `submit` / `submitted` | the slice has its own command | — (a read-model slice cannot submit: model the command) |
| `select-item`, `filter`, `component-updated`, `selection-changed` | the event names a read model or the slice has one | the list's read model |
| `item-highlighted` | `field` is set **and** the code already exposes the signed-in user's id | the field, or a source of the current user's id (a read model such as "Current user") |
| `check-permission` → `permission-checked` / `permission-denied` | `roles` are set, the denied event links a `screens`, **and** the roles of the signed-in user are available (existing code that exposes them, or a read model of the context that provides them) | a **read model with the current user's roles** (or the roles themselves, the denied screen) |
| `check-visibility` → `visibility-checked` | the `condition` can be read as a rule over data the UI has — fields of the slice's read model, or of a read model the event links ("the customer has an open order" → an `openOrders` field or list on a linked read model) | the read model / field the condition depends on — the sentence is fine, the **data** is what has to exist |
| `component-placed` | its `marks` and/or `description` name a component that exists in the code (`src/components/…`, the base page) or can be taken from the screen's marked region — **with no `marks` set, the slice's screen's `component` marker is used when it has exactly one** (several: a blocker, say which) | which component or template is placed, and where (a marker) |
| `component-rendered` | the event links the `screens` it renders (`page` optional) | which screen, and where it is rendered |
| custom item (no `kind`) | `title`, `description` and `fields` say what to do | what the item is meant to do |

**One blocker call per slice.** Classify every item first; if any is a blocker, invoke `request-feedback` **once**, listing **all** of them (item title, step
name or number, what is missing, and the smallest thing to model — "add a read model *Current user roles* with `role` to this context"), then stop the
interaction model for this run. The component you already built stays; the clear items are not built until the blockers are resolved, so the model and the
code never diverge. Do not build the blocked items "provisionally", and do not remove a blocker by writing your own roles hook, condition or component.

## Rules

1. **Build only what the steps say.** No extra interactions, no cancel buttons, no confirmation dialogs the model does not list — what obviously
   follows from a dialog (close, cancel) is plain UI behaviour you may add, but never invent a step.
2. **Placement.** Behaviour that belongs to this slice's component lives in it (plain `useState`); split into a hook or a colocated Context only
   under the conditions of Step 3 of the build skills. A modal that shows another read model is a component **in this slice's folder**
   that fetches that read model via `queryReadModel` — it never imports another slice's folder (guideline 6). If the read model belongs to
   a slice that is already built and the modal would only repeat it, build the modal's content from `readModels` fields and leave a
   `// TODO` instead of importing.
3. **Data comes from read models**, as everywhere in this stack: the modal's / destination's data is the linked read model's, bound by field —
   never copied from the mockup. Samples (`samples/sample-<N>.json`) cover the states the steps create (e.g. a selected row, a filtered
   list, the empty result) — one number per coherent scenario.
4. **Only read models of the slice's own context** appear in `readModels` (the export drops the rest). If a read model you need is not in the
   list, do not reach for another context's — flag it through `request-feedback` as a modelling gap only if the screen cannot work without it.
5. **Every step ends visible.** For each event, say in your final report where the user sees the result ("`Navigated` → page `Order Page`,
   route param `orderId`"); an event you could not realise is listed with the reason, not silently dropped.

## Navigation (`navigate` / `navigated`)

**Never write a destination path from the page's name.** Where the page lives is decided by the app, so look it up:

1. **Scaffolded app (`src/app/model.ts` exists, react-router):** the destination's route is the `route` of its entry in `PAGES` in `src/app/model.ts` — match the
   entry by `name` / `title` = the event's screen title (e.g. screen "Customers" → `PAGES` entry `{ name: "Customers", route: "/customers" }` → `navigate('/customers')`).
   Read the value from the file; do not guess it, do not build it from the title. A route parameter (`field`, e.g. `orderId`) is the `:param` segment of that
   `route`; the destination reads it with `useParams()` and uses it to scope its read model query. Use `useNavigate()` from `react-router-dom` in the page
   or component that navigates; the slice **does not import the destination page**.
   **`fields` on the `navigated` event are the values handed to the target screen** (e.g. `email`). Pass each one when navigating: as the route's `:param` when the
   `PAGES` route has one, otherwise as a query parameter (`navigate('/customers?email=' + encodeURIComponent(email))`; the value comes from what the user just
   submitted or the session, never invented). The destination page reads it with `useParams()` / `useSearchParams()` and passes it down as the prop that scopes its
   read model (`build-state-view`, Step 3-scope) — that is how a screen shows one record instead of the whole collection.
2. **Only when the screen has no `PAGES` entry** (a page file that is not in the model) is its route `/pages/<kebab-case-file-name>` (`src/app/pages.ts` derives it). It is a
   fallback for pages outside the model, never the route of a page the model lists.
3. **No `src/app/model.ts` and no router** (an app that was not scaffolded): this stack has none — one page needs none. Add the smallest thing that works, only if it
   does not exist yet: `src/lib/navigation.ts` with `navigate(page, params?)` writing `#/<page>?<params>` to `location.hash` and `useRoute()` reading it, and have
   `src/App.tsx` render `src/pages/<Page>.tsx` for `useRoute().page`. Never add a dependency.
4. If the destination page does not exist yet (its slice is not built), still navigate to its route from `PAGES` and leave `// TODO(<ScreenTitle> page)`.

## Verify

- Every step of `interactionModel` is realised or listed in the report with its reason.
- No business rule, validation or derived value came from the interaction model.
- A `submit` calls `postCommand` exactly as the command's contract says; a `filter` changes the query's `filters`, not the rows.
- `navigate` uses `src/lib/navigation.ts` (created once, no new dependency); the navigating slice imports no page.
- Samples exist for each state the steps create; the component still renders its empty state with no data.
