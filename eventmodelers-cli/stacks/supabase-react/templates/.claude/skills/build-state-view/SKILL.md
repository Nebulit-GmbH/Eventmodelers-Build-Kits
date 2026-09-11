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
it calls `queryReadModel(...)` from `src/lib/api.ts`, same as `build-state-change` components only
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
    Read it literally from slice.json; never invent or guess a table name. If it's missing, stop
    and use `request-feedback` rather than guessing.
  - `description` — implementation hints (filtering rules, sort order, business meaning).
- **screens[]** — the actor `SCREEN` element(s) that display this data, if any (see Step 2).
- **specifications[]** — GWT scenarios/storyline; treat as acceptance criteria (e.g. "given no
  active reservation, show an empty state").

> **Comments**: as in `build-state-change` — resolve consumed ones via the same node-comment
> endpoint.

## Step 2 — Read the screen, and especially its marks

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

**Props**: whatever the component needs to *scope* its query (e.g. `customerId`) — passed in from
its parent, never read from a global store. The queried data itself is **not** a prop — the
component fetches it.

**Default — call `queryReadModel` from `src/lib/api.ts` inside the component**. Never `supabase.from(...)`
directly, never a raw `fetch`:

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
read model's `specifications[]` call out (e.g. an empty result, a second customer's data). The
same number across *different* components' `samples/` folders is meant to represent one coherent
scenario across the whole app (e.g. every component's `sample-2.json` together tell the story of
"a long-time customer") — keep that in mind when choosing what a given number represents, rather
than numbering arbitrarily per component.

No extra wiring is needed beyond the `import.meta.glob` shown in Step 3 — switching which sample is
active for the *entire app* is just the `VITE_MOCK_SAMPLE` env var (see `.env.example`); this
component doesn't do anything with that number itself, `queryReadModel` reads it internally.

## Step 5 — Compose onto the shared page, if this screen's name is shared

Identical to `build-state-change` Step 5 — a screen's **title is the page name**, and the number
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
   the mockup's static content until they are). The page threads shared inputs down as props; a
   slice component still only knows its own declared props. Update only this slice's marked
   position if the page file already exists.

## Step 6 — Verify against slice.json

- Every rendered field traces back to a `readmodel.fields[]` entry — no invented or missing
  fields.
- The `queryReadModel` call targets `readmodel.apiEndpoint` verbatim as `table` — never a raw
  `fetch`, a direct `supabase.from(...)` call, or a hardcoded table name that doesn't match
  slice.json.
- At least one numbered sample exists under this slice's `samples/` folder, shaped exactly like
  `queryReadModel`'s return value.
- The component renders a sensible empty/background state, distinct from loading/error, when the
  data is `null`/`[]`.
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
