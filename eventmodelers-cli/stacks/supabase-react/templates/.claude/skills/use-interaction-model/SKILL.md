---
name: use-interaction-model
description: Build the UI behaviour a slice's `interactionModel` describes (modal opens, navigation, selection, filtering, component refresh) into its React component — called by build-state-view and build-state-change whenever slice.json carries an `interactionModel`
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

- **A step with `phase: "pre"` happens before the slice** (page template applied, authorization applied …): `steps` lists those first. There is no
  catalog of pre events yet, so none has a defined reaction: build nothing for them, and mention each in the slice's notes as "pre action not built".
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
| `submit` | The slice's own command: `postCommand` (see `build-state-change`). Nothing else to build for it here. |
| `navigate` → `navigated` | **Go to another page.** The destination is the event's `screens` — the target screen (`src/pages/<ScreenTitle>.tsx`, Step 5/6 of the build skills; `page` picks a page of a multi-page screen) — **the link is always on the event, never on the command**; `field` is the id the route carries (`orderId`) — the destination reads it to scope its read model query. See "Navigation" below. |
| `select-item` → `selection-changed` | The user picks a row/card of the list read model. The selection is **state of the page** (lift it: a prop from the parent, or a colocated `<Name>Context.tsx` when siblings share it — never a global store). `field` names the id field of the row. Components that depend on the selection re-scope their read model query to it. |
| `filter` | A filter / search control narrows the list: pass the filter to `queryReadModel`'s `filters` (never filter rows in the component against data the read model did not return). |
| `component-updated` | The component that shows the event's `readModels` **refreshes** from them: re-run its query when the triggering command/filter/selection changes. |
| *(no `kind`)* | A custom item. Build it from its `title`, `description` and `fields` as presentation-only UI behaviour; if it is not clear what it asks for, make the most sensible interpretation and say so in a code comment — do not stop for it. |

Every item may also carry `description` (the person's own words — read it) and `fields` (data the item works with).

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

This stack ships **no router** — one page needs none. The first slice with a `navigated` event adds the smallest thing that works and later slices reuse it:

- `src/lib/navigation.ts` (shared, cross-cutting like `api.ts`): `navigate(page: string, params?: Record<string, string>)` writes `#/<page>?<params>` to `location.hash`, and
  `useRoute(): { page: string; params: Record<string, string> }` reads it and re-renders on `hashchange`. Create it **only if it does not exist**; never add a dependency.
- `src/App.tsx` (the base page) renders `src/pages/<Page>.tsx` for `useRoute().page` (the first page is the default). Page file names are the screen titles
  (guideline 7). The slice that navigates **does not import the destination page** — it calls `navigate('<ScreenTitle>', { <field>: id })`; the destination page
  reads its param with `useRoute().params` and passes it down as the prop that scopes its read model query.
- If the destination page does not exist yet (its slice is not built), still call `navigate(...)` and leave `// TODO(<ScreenTitle> page)`; the base page shows the
  current page's own content for an unknown route.

## Verify

- Every step of `interactionModel` is realised or listed in the report with its reason.
- No business rule, validation or derived value came from the interaction model.
- A `submit` calls `postCommand` exactly as the command's contract says; a `filter` changes the query's `filters`, not the rows.
- `navigate` uses `src/lib/navigation.ts` (created once, no new dependency); the navigating slice imports no page.
- Samples exist for each state the steps create; the component still renders its empty state with no data.
