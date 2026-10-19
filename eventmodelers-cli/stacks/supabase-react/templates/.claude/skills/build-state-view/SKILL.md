---
name: build-state-view
description: Build a read-side React slice for the Supabase stack — a component tailored to its READMODEL(s), reading its table/view through the shared api.ts (never Supabase directly), which is what lets it also be tested/previewed in isolation from numbered samples/sample-N.json files
---

# Build State View Slice

> Before doing anything else, read the slice definition from
> `.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json`. This file (plus, when a screen is
> involved, the live screen node fetched in Step 2) is the **source of truth** for every field and
> data source — never invent a field, prop, or table name that isn't there.

---

## What a State View Slice is

One or more `READMODEL` elements (`slice.json.readmodels[]`) that display data back to the user.
Read models here are **tailor-made for one component** — the default is a strict 1:1 correlation
between a read model and the component that renders it. A single component may combine more than
one read model (e.g. a dashboard-style screen), but the reverse — one read model reused by several
different components — is rare; if the same read model turns up wired into more than one slice's
screen, that's unusual enough to double-check rather than assume is intentional.

This stack builds only the **frontend half**, and its read architecture is **direct table access,
not a custom read API**: a read model is typically a real, persisted Postgres table (a projection
the backend keeps up to date), protected by Row Level Security policies that already enforce which
rows a given user may see. That RLS enforcement is exactly what makes it correct — not merely
convenient — for a component to read it straight from Supabase, with no bespoke backend endpoint in
between, the same way `miro-eventmodeling` and this stack's other Supabase-backed components do.

That said, a component never calls `supabase.from(...)` (or imports `src/lib/supabase.ts`) itself —
it calls `getReadModel(...)` (backend `GET` UI contract available) or `queryReadModel(...)` (table
read) from `src/lib/api.ts`, same as `build-state-change` components only
ever call `postCommand`. `queryReadModel` is the real Supabase call in production, but in mock mode
it serves a numbered sample instead (see Step 4) — routing every read through this one seam is what
makes a component testable/previewable in isolation, with zero Supabase project needed.

Assume a read model names a real persisted table unless its `comments[]`, `description`, or a
custom prompt on the slice explicitly says otherwise (e.g. it's actually a view joining several
tables, or computed on the fly) — check those before assuming a plain table lookup.

## Step 1 — Read slice.json

Extract:
- **title**, **context** — slice identity, used for file paths (see Step 3).
- **readmodels[]** — one entry per read model this slice's screen displays. Each `Element` carries:
  - `title` — the read model's name, e.g. `"ActiveReservationView"`.
  - `fields[]` — the exact and complete set of columns/values the component displays — no more,
    no fewer.
  - `apiEndpoint` — in this stack, **the Postgres table or view name to query**, not a REST path.
    **Read it literally from slice.json when it's present** — never invent or guess a table name
    while a real one exists. **When it's missing** (no table/view decided yet), flag it but keep
    building — this is a partial variant of `request-feedback`, not a full stop:
    1. Post a comment on this slice node naming the read model and stating the table/view is missing
       (`mcp__eventmodelers__add_comment`, same call `request-feedback` Step 3 uses), and mark the
       slice `Blocked` (`mcp__eventmodelers__update_slice_status`, same as `request-feedback` Step 4).
    2. Unlike a normal `request-feedback` escalation, **do not stop here** — continue on to build the
       component exactly as normal, but against a mocked read: give `queryReadModel` a clearly
       provisional table name, e.g. `mock_<read_model_title_snake_case>`, with a one-line comment
       marking it as a placeholder pending the real table/view. In mock mode `queryReadModel` never
       touches Supabase regardless of the table name (see `src/lib/api.ts`), so the component is
       fully functional offline either way — only make Step 4's samples do extra work in this case:
       cover every `readmodel.fields[]` entry with realistic, meaningful values (never placeholders
       like `"foo"`/`"test"`), plus whatever edge cases `specifications[]` call out, since those
       samples are the only data this slice will see until a real table/view is wired in.
    3. Leave the slice's status as `Blocked` when you finish (see this stack's `CLAUDE.md` "Building
       a Slice" step 6) — the built, mocked component still needs a real table/view before it's done,
       so don't flip it to `Done`.
  - `description` — implementation hints (filtering rules, sort order, business meaning).
- **UI contract (read)** — **not used for a read model backed by a table, which is the normal case on this
  stack: that is always read directly with `queryReadModel`, even when the backend published a `GET`
  contract.** Only when `slice.json` says the read model is not a persisted table (a computed view, an
  external source) does the backend's published `GET` contract apply: look it up as described in
  the `ui-contract` skill ("How the UI build kit looks the contract up" — the `## UI Contract` entry in
  `slice.json` `notes[]`; parse only its `ui-contract` block — an OpenAPI operation). **In that case it
  is the specification and you build the call from it** — it overrides `apiEndpoint`:
  - fetch with `getReadModel(buildPath('<contract path>', { <path params> }), { <query params> }, samples)`
    from `src/lib/api.ts` — path and query `parameters` exactly as the contract names them, never a
    guessed URL, never `supabase.from(...)`;
  - type the result from the 2xx `responses` schema (it must match `readmodel.fields[]`; the contract
    wins for the wire shape, record any mismatch as a code comment);
  - render **every** non-2xx response (status + description) as its own distinct state — a 404 "no
    reservation" is an empty state, not an error banner; don't collapse them into one generic failure;
  - the numbered samples (Step 4) are shaped like the contract's 2xx response body.

  **When absent** (backend slice not built or not re-fetched yet): fall back to the table read —
  `readmodel.apiEndpoint` (table/view name) + `fields[]` via `queryReadModel` — and note the assumption
  as a code comment.
- **screens[]** — the actor `SCREEN` element(s) that display this data, if any (see Step 2).
- **specifications[]** and **storylines[]** (optional) — GWT scenarios / board walkthroughs. These
  describe how the slice should **behave** — read them in full (Step 3a) to understand the outcomes
  and states the UI must present. The business logic itself lives in the backend; the UI does not implement it.

> **Comments**: as in `build-state-change` — resolve consumed ones via the same node-comment
> endpoint.

## Step 2 — Read the screen, and especially its marks

> **Gated by `ui-baseline check`** (build prompt, `lib/prompt.md`, Step 4): do this step when the verdict
> is `SCREEN_CHANGED`, `NO_BASELINE` or `UNKNOWN` — and then also diff the existing JSX against the fetched
> screen and adjust the UI to it. On `UNCHANGED` skip it.

Identical to `build-state-change` Step 2 — fetch the live screen node
(`mcp__eventmodelers__get_node`), find this slice's marked fragment in `meta.pages`/`meta.marks`
(or the whole page if unmarked), and treat it as the blueprint. The same `learn-styleguide` note
applies: prefer its tokens/classes over the mockup's ad hoc styling where they disagree.

Also resolve this screen's lane the same way — `mcp__eventmodelers__get_board_outline` on the
screen's chapter, match this node's `id` to get its `lane`, slugify it to `laneSlug` — skip only if
`screens[]` was empty in Step 1.

## Step 3 — Build the dedicated component

**File**: `src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/<ReadModelTitle>.tsx` (omit
`<laneSlug>` only for the rare read model with no screen at all), `contextSlug`/`sliceFolder`/
`laneSlug` derived exactly as in `build-state-change`. If a component genuinely combines more than
one read model, name it after the screen/purpose rather than forcing one read model's title onto a
multi-read-model component.

**Markup**: same rule as `build-state-change` — translate the blueprint from Step 2 1:1 into JSX;
the mockup is the design, not a starting point for a redesign.

**Data binding — the whole point of a read-model component.** Every *data* value in the mockup (names,
role/organisation lines, selected values, dropdown options, list rows, badges, counts, dates) is a
sample taken from the model's examples; it must be rendered from the queried data, mapped from
`readmodel.fields[]` — keep only label/copy (headings, button captions, placeholders) verbatim.
Check where each displayed value comes from before writing JSX: a field of this read model → bind it;
a field of another read model on the same screen → it arrives as a prop from the parent that fetched
it (or a sibling read-model component), never from the mockup. List rows are a `.map()` over the
fetched rows, not the rows drawn. Self-check: grep the component for the mockup's example strings;
any hit outside `samples/` means hardcoded data — fix it.

**Find the screen's data sources on the board, not just in `slice.json`.** A screen is often shown by
one slice but fed by a read model that belongs to *another* slice (e.g. the Contact Details screen
sits in the Assign Tag slice, yet its contact data comes from the Contact List read model via an edge
READMODEL → SCREEN). `slice.json` only lists this slice's own elements, so also call
`mcp__eventmodelers__get_connected_nodes { boardId, nodeId: <screen.id> }` and take every READMODEL
wired into the screen. Each one is a data source for the displayed values; look up its fields in that
read model's slice (`.build-kit/.slices/*/*/slice.json`, or `get_node`). A list read model feeding a
detail screen (`Contact List[]` → one contact) means: query it filtered by the entity id the page
gets from the route (match the id field, e.g. `contactId` / the command's `recordId`) and render that
row. If the source read model's slice isn't built, still type and wire against its fields (TODO), do
not substitute the mockup's values.


**Props**: whatever the component needs to *scope* its query (e.g. `customerId`) — passed in from
its parent, never read from a global store. The queried data itself is **not** a prop — the
component fetches it.

**With a UI contract (Step 1, non-table read models only)**: call `getReadModel(buildPath(path, pathParams), queryParams, samples)`
from `src/lib/api.ts` inside the component instead of the `queryReadModel` snippet below — same
effect shape (`useEffect` → loading / empty / error / data), but each documented non-2xx response
(`ApiError.status`) maps to its own state. Never a raw `fetch`.

**Default (a table-backed read model — always, unless the contract case above applies) — call `queryReadModel` from `src/lib/api.ts` inside the component**. Never
`supabase.from(...)` directly, never a raw `fetch`:

```tsx
// ActiveReservationView.tsx
import { useEffect, useState } from 'react';
import { queryReadModel } from '../../../../lib/api'; // one less '../' if this read model has no lane segment

export interface ActiveReservationViewProps {
  customerId: string;
}

interface ActiveReservation {
  status: string;
  // ...remaining readmodel.fields[], typed per each Field.type
}

const samples = import.meta.glob<{ default: ActiveReservation }>('./samples/sample-*.json', { eager: true });
const samplesByNumber = Object.fromEntries(
  Object.entries(samples).map(([path, mod]) => [path.match(/sample-(\d+)\.json$/)![1], mod.default]),
);

export function ActiveReservationView({ customerId }: ActiveReservationViewProps) {
  const [data, setData] = useState<ActiveReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryReadModel<ActiveReservation>(
      {
        table: 'active_reservations', // readmodel.apiEndpoint, verbatim
        select: 'status, ...', // every readmodel.fields[] name, by its actual column name — not '*'
        filters: { customer_id: customerId },
        single: true,
      },
      samplesByNumber,
    )
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // ...JSX translated from the marked screen fragment. Render a sensible empty/background
  // state for `data === null` (or `[]`), distinct from the loading and error states — a
  // component must never assume data is always present...
}
```

### Step 3a — Read the scenarios to understand behavior (not to implement rules)

**Business logic lives in the backend (the projection). The UI never re-derives it** — no
recomputing totals, statuses or membership from events; render what the read model holds.

Read every entry in `specifications[]` (and the READMODEL beats in `storylines[]`) to understand
**what the read model looks like in different situations and how the component should present each**:

| Scenario shows | What it tells the UI |
|---|---|
| `then` read model is empty (`expectEmptyList` / no rows) | an **empty state** must exist, distinct from loading and error |
| the same field takes different values across scenarios (e.g. status `open` → `closed`) | each value needs a sensible presentation (label, badge, shown/hidden actions) — presentation only |
| rows appear/disappear between scenarios | the component renders whatever rows the read model returns; it does not decide which belong |
| row order visible across scenarios | hint for `order`/sort on the query, if the read model doesn't already guarantee it |
| a `STORYLINE_NOTE` beat | background only |

Rules:
- Understand, don't implement: presentation of what the backend provides, nothing more.
- Cite the scenario behind a non-obvious state in a one-line comment.

Select fields explicitly by name rather than `select('*')`. Map each field's `name` to its actual
column name — check the paired backend stack's migrations if the naming convention (e.g. camelCase
vs. snake_case) isn't obvious rather than guessing; if genuinely unclear, use `request-feedback`.

Extract a `use<ReadModelTitle>.ts` hook, or introduce a colocated `<Name>Context.tsx`, under
exactly the same conditions as `build-state-change` Steps 3-4 — only when genuinely warranted
(logic reused by more than one sibling component, or state that must be shared across them). Don't
reach for either by default; most read-model components are a query plus a render and need
nothing more.

## Step 4 — Add numbered samples

Every read-model component ships a `samples/` folder colocated next to it:
`src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/samples/sample-<N>.json` (`sample-1.json`,
`sample-2.json`, ...). Each file mimics **exactly the row shape `queryReadModel` returns** — the
same field names/types as `readmodel.fields[]`, as a single object for `single: true` or an array
otherwise; use `null`/`[]` for a sample meant to exercise the empty/background state.

Add at least one sample (`sample-1.json`) covering the ordinary case from
`readmodel.fields[].example` values; add more numbered ones for whatever other scenarios this
read model's `specifications[]` show — **one sample per distinct scenario outcome**, using the
scenario's own example values (an empty result, each status a row can take, a second customer's
data). The
same number across *different* components' `samples/` folders is meant to represent one coherent
scenario across the whole app (e.g. every component's `sample-2.json` together tell the story of
"a long-time customer") — keep that in mind when choosing what a given number represents, rather
than numbering arbitrarily per component.

No extra wiring is needed beyond the `import.meta.glob` shown in Step 3 — switching which sample is
active for the *entire app* is just the `VITE_MOCK_SAMPLE` env var (see `.env.example`); this
component doesn't do anything with that number itself, `queryReadModel` reads it internally.

## Step 5 — Compose onto the shared page, if this screen's name is shared

Identical to `build-state-change` Step 6 — a screen's **title is the page name**, and the number
of *distinct* screen titles across the board is a direct hint at how many pages this app needs, not
one page per slice.

1. Check whether any other slice references a screen with the same `title` as this slice's screen,
   across every context's local index:
   ```bash
   grep -l '"title": *"<ScreenTitle>"' .build-kit/.slices/*/index.json
   ```
   (Run `/load-slice` with no filter first if the board's other slices haven't been pulled locally
   yet.)
2. **No match**: nothing further to do — this slice's component stands alone for now.
3. **Match found**: this screen is a shared page, composed at `src/pages/<ScreenTitle>.tsx` — the
   one place allowed to import across slice folders. Translate the screen's whole, unmarked
   `meta.pages` markup into JSX (the page-level layout), and at each `data-em-mark-id` position
   render that mark's owning slice's component (only for slices already built; leave the rest as
   the mockup's static content until they are). Static placeholder content is label/copy only — displayed data (names, selections, options, rows) is bound to its read model, never the mockup's examples or a sample file. The page threads shared inputs down as props; a
   slice component still only knows its own declared props. Update only this slice's marked
   position if the page file already exists.

## Step 6 — Load the screen's styles, every slice

The mockup's classes only mean something with the CSS framework the board renders it with, so the
app must load that same one. This runs on **every** slice (not just the first) and is idempotent —
an existing project that is missing it gets fixed on its next build.

1. **Detect** the framework the screen loads, from the node fetched in Step 2: `cssFrameworks` (one id).
   If it isn't returned, infer it from the classes in `meta.pages` (`title`/`field`/`is-*` → bulma,
   `btn`/`form-control`/`col-*` → bootstrap, utility classes like `flex p-6` → tailwind). If the
   screen loads **no** framework (`[]`, or nothing detectable), use Vite's default: change nothing —
   skip this whole step, leave `index.html` and `src/index.css` as the template ships them.
2. **Ensure it's loaded** in `index.html`'s `<head>`, same pinned version the board uses — check with
   `grep -n -i "bulma\|bootstrap\|cdn.tailwindcss" index.html` first, add only what's missing:
   - `bulma` → `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">`
   - `bootstrap` → `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">`
   - `tailwind` → `<script src="https://cdn.tailwindcss.com/3.4.16"></script>`

   A *different* framework already there means two screens disagree: don't mix them — keep what's
   there and flag it via `request-feedback`.
3. **Neutralise the Vite demo CSS** (only because a framework was detected). If `src/index.css` still holds the demo (it contains `#social` or
   `--social-bg`), replace the whole file with `body { margin: 0; }` — the centred 1126px `#root`,
   dark-mode palette, `color-scheme: light dark`, grey text and 56px `h1` all fight the mockup. A file
   without those markers was already customised (or filled from `learn-styleguide`): leave it alone.

## Step 7 — Base page, only if this is the first slice

`src/App.tsx` ships as the Vite demo scaffold. The **first slice built in this project** replaces it
with the app's **base page**, so there is something real to open in the browser; every later slice
leaves it alone.

1. **First slice?** Yes only if `src/slices/` holds no other slice folder than this one (only
   `.gitkeep` besides it) *and* `src/App.tsx` still contains the scaffold (`Get started` heading).
   Otherwise skip this step entirely.
2. Rewrite `src/App.tsx` as the base page: a minimal `<main>` that renders the top-level thing this
   slice produced — `src/pages/<ScreenTitle>.tsx` when Step 5 composed a shared page, else this
   slice's own component. Nothing from the Vite demo (counter, logos, doc links) stays. No router and
   no new dependency — a single page needs neither.
3. Delete what the scaffold alone used and nothing else now imports: `src/App.css` and
   `src/assets/{hero.png,react.svg,vite.svg}` (check with `grep -rn` first); `public/icons.svg` too if
   nothing references it. Leave `src/main.tsx` and `src/index.css` (Step 6 handles it) as they are.
4. Keep the page working with no backend, per the isolation rule in `.build-kit/CLAUDE.md`: the
   slice component must render its empty state, and `VITE_DATA_MODE=mock` must show its sample.

## Step 8 — Verify against slice.json

- Every rendered field traces back to a `readmodel.fields[]` entry — no invented or missing
  fields.
- With a UI contract: the `getReadModel` call uses the contract's path and query `parameters`
  verbatim, and every non-2xx response has its own rendered state. Otherwise:
- The `queryReadModel` call targets `readmodel.apiEndpoint` verbatim as `table` — or, when it was
  missing at build time, the provisional `mock_...` table name noted in a comment (Step 1) — never a
  raw `fetch`, a direct `supabase.from(...)` call, or a hardcoded table name that doesn't match
  slice.json.
- At least one numbered sample exists under this slice's `samples/` folder, shaped exactly like
  `queryReadModel`'s return value.
- Every scenario situation (empty, each distinct field value) has a rendered presentation, and the
  component re-derives nothing the read model already holds.
- If a screen was read in Step 2, the rendered JSX matches the marked (or whole, if unmarked) HTML
  fragment structurally.
- Nothing in this slice's folder is imported from another slice's folder, and nothing outside it
  imports from it except `src/pages/` (Step 5) — deleting the folder should delete the feature
  cleanly.

## Quality gate

Run `npm run build` (`tsc -b && vite build`) and `npm run lint` (`oxlint`) — both must pass clean.
There is no component test runner configured in this stack yet; if a slice's `specifications[]`
demand behavioral tests, flag that gap via `request-feedback` rather than inventing a test setup
ad hoc.
