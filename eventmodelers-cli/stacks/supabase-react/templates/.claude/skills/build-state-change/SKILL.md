---
name: build-state-change
description: Build a write-side React slice for the Supabase stack — one dedicated component per COMMAND (splitting into a hook and/or a colocated Context/Provider only when the slice actually needs one) that POSTs to its slice-defined apiEndpoint via the shared api.ts, driven by the marked-up region of its actor HTML_SCREEN
---

# Build State Change Slice

> Before doing anything else, read the slice definition from
> `.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json`. This file (plus, when a screen is
> involved, the live screen node fetched in Step 2) is the **source of truth** for every field,
> event, and endpoint — never invent a field, prop, or path that isn't there.

---

## What a State Change Slice is

One `COMMAND` element (`slice.json.commands[]`) that, when submitted, causes one or more `EVENT`
elements (`slice.json.events[]`) to be recorded by the backend. This stack builds only the
**frontend half**: a dedicated React component that collects the command's data (via props — this
component never fetches or owns its own data) and POSTs it to an already-existing backend
endpoint, via `postCommand` in `src/lib/api.ts` — never `fetch` directly. It does not generate any
server-side code.

Every component must be renderable and testable **in isolation**, with no real backend running —
see Step 4 (numbered `samples/`) and `src/lib/api.ts`'s `VITE_DATA_MODE=mock`, which makes
`postCommand` resolve locally instead of hitting the network.

## Step 1 — Read slice.json

Extract:
- **title**, **context** — slice identity, used for file paths (see Step 3).
- **commands[0]** — the command element. Each `Element` carries:
  - `title` — the command name, e.g. `"ReserveBike"`.
  - `fields[]` — one entry per data field (`name`, `type`, `optional?`, `cardinality?`, `example?`,
    `subfields?`). This is the **exact and complete** set of props the component takes — no more,
    no fewer.
  - `apiEndpoint` — the path to POST to. **Read this literally from slice.json when it's present**
    — do not guess a REST convention, invent a path, or infer one from the command name while a real
    one exists. **When `apiEndpoint` is missing** (no backend endpoint decided yet), flag it but keep
    building — this is a partial variant of `request-feedback`, not a full stop:
    1. Post a comment on this slice node naming the command and stating the endpoint is missing
       (`mcp__eventmodelers__add_comment`, same call `request-feedback` Step 3 uses), and mark the
       slice `Blocked` (`mcp__eventmodelers__update_slice_status`, same as `request-feedback` Step 4).
    2. Unlike a normal `request-feedback` escalation, **do not stop here** — continue on to build the
       component exactly as normal, but against a mocked backend: give `postCommand` a clearly
       provisional path, e.g. `/api/mock/<command-title-kebab-case>`, with a one-line comment marking
       it as a placeholder pending the real endpoint. `postCommand` already resolves locally under
       `VITE_DATA_MODE=mock` regardless of what the path string is (see `src/lib/api.ts`), so the
       component is fully functional offline either way — only make Step 4's samples do extra work in
       this case: cover every `command.fields[]` entry with realistic, meaningful values (never
       placeholders like `"foo"`/`"test"`), plus whatever edge cases `specifications[]` call out,
       since those samples are the only data this slice will see until a real endpoint is wired in.
    3. Leave the slice's status as `Blocked` when you finish (see this stack's `CLAUDE.md` "Building
       a Slice" step 6) — the built, mocked component still needs a real endpoint before it's done,
       so don't flip it to `Done`.
  - `description` — implementation hints (validation rules, business constraints).
- **UI contract (write)** — the backend slice's published `POST` contract: look it up as described in
  the `ui-contract` skill ("How the UI build kit looks the contract up" — the `## UI Contract` entry in
  `slice.json` `notes[]`; parse only its `ui-contract` block — an OpenAPI operation). When present it **overrides
  `apiEndpoint`** and fixes everything the component must honour: the path (+ path `parameters`), the exact
  `requestBody` properties, the 2xx `responses` entry, and every non-2xx response (status + description) — surface each error code as a
  distinct user-facing state through `onError`, not one generic failure. When absent, the backend slice
  isn't built or re-fetched yet: fall back to `apiEndpoint` / `fields[]` as above and note the assumption
  as a code comment. If contract and `command.fields[]` disagree, the contract wins for the request and
  you record the mismatch as a code comment.
  **Build the call from it**: `postCommand(buildPath('<contract path>', { <path params> }), { <requestBody
  properties> })` — `buildPath` (in `src/lib/api.ts`) fills and URL-encodes `{param}` segments; the body
  carries exactly the contract's `requestBody` properties (props the contract doesn't list stay out).
- **events[]** — informational only (what the backend is expected to emit); this stack does not
  act on them directly.
- **screens[]** — the actor `SCREEN` element(s) that trigger this command, if any. Empty when the
  command has no UI trigger (rare — build the component from fields alone in that case, skip Step
  2).
- **specifications[]** and **storylines[]** (optional) — GWT scenarios / board walkthroughs. These
  describe how the slice should **behave** — read them in full (Step 3a) to understand the outcomes
  and states the UI must present. The business logic itself lives in the backend; the UI does not implement it.

> **Comments**: each element carries `comments: string[]` (board comments) — read them as
> implementation hints, and resolve consumed ones via
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

## Step 2 — Read the screen, and especially its marks

> **Gated by `ui-baseline check`** (build prompt, `lib/prompt.md`, Step 4): do this step when the verdict
> is `SCREEN_CHANGED`, `NO_BASELINE` or `UNKNOWN` — and then also diff the existing JSX against the fetched
> screen and adjust the UI to it. On `UNCHANGED` skip it.

`slice.json`'s `screens[]` entries only carry `id`/`title`/`fields[]`/`description` (fields already
scoped to this slice) — not the actual markup. Fetch the live node to get that:

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<screen.id>" }
```

This returns the full `meta`, including `pages: string[]` (one HTML fragment per page) and,
if the screen is shared across several slices, `marks: [{ id, color, pageIndex, blurOutside?,
whiteOutside? }]`.

- **If `meta.marks` is non-empty**: the same visual screen is shared by multiple slices, each
  highlighting a different part. Find the mark(s) belonging to this node, then in
  `meta.pages[mark.pageIndex]` locate the element carrying `data-em-mark-id="<mark.id>"` — **that
  HTML subtree, not the rest of the page, is the blueprint for what this component builds.**
  Ignore markup outside it; it belongs to other slices.
- **If `meta.marks` is empty**: the whole page (every entry in `meta.pages`, in order, for a
  multi-step flow) is the blueprint.
- **If `screens[]` was empty in Step 1**: there is no visual reference — build the component from
  `fields[]` alone, with plain, unstyled form markup.

If this project has a `learn-styleguide` skill installed (`.claude/skills/learn-styleguide/`),
read its references before turning markup into JSX and prefer its tokens/component classes over
whatever ad hoc styling the mockup used — the mockup gives you *structure and content*, the style
guide gives you the real visual language when the two disagree.

**Also resolve this screen's lane** (skip if `screens[]` was empty in Step 1 — see Step 3's file
path): the actor row this screen sits in becomes a folder segment. Fetch it cheaply with:

```
mcp__eventmodelers__get_board_outline { "boardId": "<BOARD_ID>", "chapterId": "<screen node's chapterId>" }
```

This returns `{id, type, title, lane}` for every node in the chapter — find the entry whose `id`
matches `screen.id` and take its `lane`. Slugify it the same way `contextSlug` is derived
(lowercase, spaces to hyphens, non-alphanumeric stripped) to get `laneSlug`.

## Step 3 — Build the dedicated component

**File**: `src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/<CommandTitle>.tsx` — `contextSlug` and
`sliceFolder` are derived exactly as in `load-slice` (lowercase-slugified context; slice title
lowercased with spaces removed and any `slice:` prefix stripped); `laneSlug` comes from Step 2
above. Omit the `<laneSlug>` segment (fall back to `<contextSlug>/<sliceFolder>/`) only for the
rare headless command with no `screens[]` at all — there's no lane to resolve without a screen.
Note this nests one level deeper than the staging data in
`.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json` — `load-slice`'s own local index has no
lane concept, so the frontend path isn't a strict 1:1 mirror of it. `CommandTitle` is the command's
`title` verbatim (e.g. `ReserveBike.tsx`).

**Markup**: translate the blueprint HTML from Step 2 into JSX **1:1** — same tags, same classes
(the screen's `cssFrameworks` framework), same layout and copy. This is not a redesign; the screen *is*
the design. Only change what must become dynamic:
- A field's example value becomes that input's **initial/default** `value` only for what the user is
  *entering* (a new-record form). Anything the screen *displays* about an existing entity (names,
  titles, current selection, existing tags, list rows) is **not** static — see "Data binding" below.
- An element repeated for a `cardinality: "List"` field becomes a `.map()` over that field.
- `class`/`style`/structure otherwise stay exactly as drawn — except the board's own mark plumbing:
  drop every `data-em-mark-id` attribute and `em-mark`/`em-mark-<hex>` class (they only draw the
  highlight outline on the canvas; the app never ships it).
- The classes only render correctly if the screen's CSS framework (`cssFrameworks`) is loaded in the app — see Step 7 (styles); don't hand-write CSS to compensate.

**Data binding — mockup text is sample data, not copy.** The example values drawn in a screen are
placeholders from the model. Before translating, classify every piece of text/value in the fragment:
*label/copy* (headings like "Tags", button captions, placeholders — keep verbatim) vs. *data* (a person's
name, a role/organisation line, a pre-selected dropdown value, dropdown options, existing list rows,
badges, counts, dates). For each *data* item find its source in `slice.json` / the model — the
`readmodels[]` whose fields carry it, or the command's own `fields[]` — and render it from there.
**Never hardcode a data value from the mockup into JSX.**

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

- Data comes from a read model (query component of the same page/screen, via `queryReadModel` /
  `getReadModel`) → bind it to that data (props from the parent that fetched it, or fetch it here
  when this component owns that read). If that read-model slice is not built yet, wire the component
  against the typed shape and leave a `// TODO(<read model title>)` — do not paste the example in.
- Select/dropdown *options* come from a read model (e.g. the customer list), never from the
  options drawn in the mockup; the *selected* value comes from the entity's own read model.
- The only legitimate static content is label/copy and `VITE_DATA_MODE=mock` samples in `samples/*.json`.
- Self-check before finishing: grep the component for the mockup's example strings (e.g. the person's
  name, organisation, tag text). Any hit outside `samples/` is a bug.

**Props**: exactly `command.fields[]`, typed per each field's `type` (`String`→`string`,
`Boolean`→`boolean`, `Int`/`Long`→`number`, etc. — `subfields[]` become a nested object type),
respecting `optional`. Add two callback props: `onSuccess?: (result: TResponse) => void` and
`onError?: (error: ApiError) => void`. **No other inputs** — no context/store reads, no fetching
inside the component. All business data the component needs arrives via props from its parent.

### Step 3a — Read the scenarios to understand behavior (not to implement rules)

**Business logic lives in the backend. The UI never re-implements it.** Do not copy a scenario's
rules (preconditions, limits, uniqueness, state checks) into the component as validation or guards —
the backend decides, and a duplicated rule drifts the moment the model changes.

Read every entry in `specifications[]` (and the beat runs in `storylines[]` containing this command)
to understand **how the component should behave around the command**: what the user is trying to
accomplish, what outcomes exist, and what each outcome must look like. Use them to decide:

| Scenario shows | What it tells the UI |
|---|---|
| `when` this command → `then` EVENT(s) | the success outcome: what to confirm or reset after `postCommand` resolves, and what `onSuccess` hands the parent |
| `when` this command → `then` an error / rejection (e.g. "already reserved") | the failure outcomes that exist: render each as its own readable message from the `ApiError` the backend returns — not one generic failure. The backend decides *whether* it fails; the UI only shows it |
| `optional` fields, fields that vary between scenarios | which inputs are required vs. optional in the form (mirror the flags, no invented rules) |
| `given` events before the command | context for what the user was doing — background to understand the flow, not logic to reproduce |
| a `STORYLINE_NOTE` beat | background only |

Rules:
- Understand, don't implement: no business validation, no precondition checks, no computed outcomes
  in the component. Only presentation: states (idle/submitting/success/error), required-vs-optional
  inputs, and showing what the backend returns.
- If a scenario's outcome needs a UI state the markup doesn't show, add the minimal state and note
  the scenario in a one-line comment (e.g. `// spec: "already reserved" → backend 409 shown inline`).

**Default — keep the logic in the component.** For an ordinary command (one form, one submit
action, which is most of them) local state and the `postCommand` call live directly inside the
component. This is the common case and needs nothing more:

```tsx
// ReserveBike.tsx
import { useState } from 'react';
import { postCommand, ApiError } from '../../../../lib/api'; // one less '../' if this command has no lane segment

export interface ReserveBikeProps {
  bikeId: string;
  customerId: string;
  onSuccess?: (result: unknown) => void;
  onError?: (error: ApiError) => void;
}

export function ReserveBike({ bikeId, customerId, onSuccess, onError }: ReserveBikeProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await postCommand('/api/reservebike', { bikeId, customerId });
      onSuccess?.(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong';
      setError(message);
      if (err instanceof ApiError) onError?.(err);
    } finally {
      setSubmitting(false);
    }
  };

  // ...JSX translated from the marked screen fragment, wired to handleSubmit...
}
```

The component owns only: local form/loading/error state, whatever client-side validation the
`specifications[]`/field `optional` flags imply, building the request body from props, and calling
`postCommand(command.apiEndpoint, body)`. It never imports `supabase`, builds headers, or calls
`fetch` directly — that is exclusively `src/lib/api.ts`'s job. In `VITE_DATA_MODE=mock`,
`postCommand` never hits the network at all — it resolves immediately, so this component is fully
exercisable (submitting/success/error UI states) offline.

**Extract a `use<CommandTitle>.ts` hook only when it earns its keep** — e.g. the exact same logic
is genuinely reused by more than one component in this slice, or the non-rendering logic (several
async steps, non-trivial multi-field validation) has grown large enough that pulling it out of the
component measurably improves readability. Don't extract a hook by default, for uniformity with
other slices, or "for consistency" — a small command's logic reads perfectly fine inline, and a
hook file that's just a thin wrapper around `postCommand` is pure ceremony working against
deletability, not for it (one more file to keep in sync instead of one). When it *is* warranted,
move the same logic verbatim into a colocated `use<CommandTitle>.ts` and have the component call
it — nothing about the logic itself changes, only where it lives.

## Step 4 — Add numbered samples

Every command component ships a `samples/` folder colocated next to it, mirroring
`build-state-view`'s convention:
`src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/samples/sample-<N>.json`. Since this component
is driven entirely by props, each sample is a **full set of prop values** — there's no query for
`postCommand` to serve (it's already mock-aware on its own, see Step 3). A sample is for whatever
renders this component in isolation (a `src/pages/` composition, or ad hoc while developing) to
spread as props, e.g. `<ReserveBike {...sample1} onSuccess={...} />`.

Add `sample-1.json` for the ordinary case (`command.fields[].example` values); add a numbered
sample for **each** scenario in `specifications[]` that changes what the component does (an invalid
input that blocks submit, an `optional` field omitted, a precondition that disables the trigger).
Take the values from the scenario's own example data. As in `build-state-view`, the same number across different components' samples is meant to
represent one coherent scenario across the app, not an arbitrary per-component index.

## Step 5 — Context/Provider, only if the marked fragment needs shared local state

Skip this step for the overwhelming majority of commands — an ordinary single-form command is
fully covered by Step 3 alone, and adding a Context there is needless indirection with nothing to
show for it.

Reach for a Context **only** when the blueprint from Step 2 decomposes into several sibling
components that must coordinate (e.g. a multi-step wizard, a shared "selected row" between a list
and a submit bar) — i.e. state that a single component's own `useState` genuinely cannot hold
because more than one sibling needs to read or change it. Follow the same `Context`/`Provider`/hook
shape this project's components use elsewhere (see `useReadOnly`/`ReadOnlyProvider` and
`useUser`/`UserProvider` for the two variants):

```tsx
// ReserveBikeContext.tsx — colocated in the SAME slice folder, never in src/lib
import { createContext, useContext } from 'react';

interface ReserveBikeContextType {
  selectedBikeId: string | null;
  selectBike: (bikeId: string) => void;
}

const ReserveBikeContext = createContext<ReserveBikeContextType | null>(null);

export function ReserveBikeProvider({ children }: { children: React.ReactNode }) {
  // ...state shared by this slice's sibling components...
  return <ReserveBikeContext.Provider value={{ selectedBikeId, selectBike }}>{children}</ReserveBikeContext.Provider>;
}

export function useReserveBikeContext() {
  const ctx = useContext(ReserveBikeContext);
  if (!ctx) throw new Error('useReserveBikeContext must be used within ReserveBikeProvider');
  return ctx;
}
```

Throw when the context is missing (as above) — there is no sensible default for slice-scoped state,
and failing fast surfaces a sub-component rendered outside its own slice's provider immediately.
A plain default value (no throw) is only appropriate for a genuinely app-wide, always-available
value — that belongs in `src/lib`, not here (see **Deletability** in `.build-kit/CLAUDE.md`).

**File**: `src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/<CommandTitle>Context.tsx` — colocated
with the hook and component, never imported by another slice. The command's own `.tsx` file
renders the `Provider` at its root, wrapping the sibling sub-components that call the context hook.

## Step 6 — Compose onto the shared page, if this screen's name is shared

A screen's **title is the page name**. The `html-screen` skill gives each slice its own copy of a
shared visual screen — one node per slice, each with a different mark — so two slices whose
screens carry the **same title** are meant to sit together on **one real page**, arranged exactly
as their marks show. The number of *distinct* screen titles across the board is a direct hint at
how many pages this app needs — not one page per slice.

1. Check whether any other slice references a screen with the same `title` as this slice's screen.
   Search every context's local index, not just this slice's own:
   ```bash
   grep -l '"title": *"<ScreenTitle>"' .build-kit/.slices/*/index.json
   ```
   (Run `/load-slice` with no filter first if the board's other slices haven't been pulled locally
   yet — this check is only as complete as what's on disk.)
2. **No match** (this is the only slice on this screen so far): nothing further to do here — this
   slice's component stands alone for now. A shared page gets created the first time a *second*
   slice on the same screen is built.
3. **Match found**: this screen is a shared page. Its composition lives at
   `src/pages/<ScreenTitle>.tsx` (PascalCase, spaces stripped) — the **one place** in this codebase
   allowed to import across slice folders; a slice component itself never does (see **Deletability**
   in `.build-kit/CLAUDE.md`).
   - Fetch the **whole, unmarked** page markup for this screen (every entry in `meta.pages`, from
     Step 2) — this is the page-level layout blueprint, not just this slice's marked fragment.
   - Translate it 1:1 into JSX, same rule as Step 3 — but at each position carrying a
     `data-em-mark-id`, render that mark's owning slice's component instead of the mockup's static
     content there, passing whatever props it declares. Only substitute positions whose slice
     component already exists; leave any not-yet-built slice's marked area as the mockup's static
     placeholder until that slice is built and this step runs again for it.
   - **Unmarked/unbuilt regions are not an excuse to hardcode data.** Static placeholder is only for
     label/copy. A displayed data value (e.g. the contact's name and "role · organisation" line, the
     selected organisation and the organisation dropdown options) must be bound to the read model that
     carries it — if that read model's component exists (e.g. the contact list/details read), fetch
     through it and pass the values down; if not, type the prop and leave a `// TODO(<read model>)`.
     Never paste the mockup's example (or a slice's `samples/sample-1.json`) into the page as the
     data. The page reads the entity id from the route/query param.
   - The page owns threading shared inputs (route/query params, the current session, etc.) down as
     props to each slice component — a slice component still only knows its own declared props, not
     the rest of the page or its siblings.
   - If `src/pages/<ScreenTitle>.tsx` already exists, update only this slice's marked position;
     leave every other position (already-wired slices, and untouched mockup content) exactly as is.

## Step 7 — Load the screen's styles, every slice

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

## Step 8 — Base page, only if this is the first slice

`src/App.tsx` ships as the Vite demo scaffold. The **first slice built in this project** replaces it
with the app's **base page**, so there is something real to open in the browser; every later slice
leaves it alone.

1. **First slice?** Yes only if `src/slices/` holds no other slice folder than this one (only
   `.gitkeep` besides it) *and* `src/App.tsx` still contains the scaffold (`Get started` heading).
   Otherwise skip this step entirely.
2. Rewrite `src/App.tsx` as the base page: a minimal `<main>` that renders the top-level thing this
   slice produced — `src/pages/<ScreenTitle>.tsx` when Step 6 composed a shared page, else this
   slice's own component. Nothing from the Vite demo (counter, logos, doc links) stays. No router and
   no new dependency — a single page needs neither.
3. Delete what the scaffold alone used and nothing else now imports: `src/App.css` and
   `src/assets/{hero.png,react.svg,vite.svg}` (check with `grep -rn` first); `public/icons.svg` too if
   nothing references it. Leave `src/main.tsx` and `src/index.css` (Step 7 handles it) as they are.
4. Keep the page working with no backend, per the isolation rule in `.build-kit/CLAUDE.md`: the
   slice component must render its empty state, and `VITE_DATA_MODE=mock` must show its sample.

## Step 9 — Verify against slice.json

After writing the hook/component (and context/page/base page, if any), confirm:
- Every prop matches a `command.fields[]` entry exactly (name + type) — no invented or missing
  fields.
- The `postCommand` call uses the UI contract's `path` and `body` when one was found, else `command.apiEndpoint` verbatim — or, when it was missing at build
  time, the provisional `/api/mock/...` path noted in a comment (Step 1).
- At least one numbered sample exists under this slice's `samples/` folder, shaped exactly like
  this component's props.
- Every scenario outcome (success, each named failure) has a rendered state, and **no business rule
  from a scenario was re-implemented in the component** — the backend owns it.
- If a screen was read in Step 2, the rendered JSX matches the marked (or whole, if unmarked)
  HTML fragment structurally — no invented buttons/fields the mockup didn't show, nothing from
  the mockup silently dropped.
- Nothing in this slice's folder is imported from another slice's folder, and nothing outside this
  slice's folder imports from it except `src/pages/` (Step 6) — deleting the folder should delete
  the feature cleanly.

## Quality gate

Run `npm run build` (`tsc -b && vite build`) and `npm run lint` (`oxlint`) — both must pass clean.
There is no component test runner configured in this stack yet; if a slice's `specifications[]`
demand behavioral tests, flag that gap via `request-feedback` rather than inventing a test setup
ad hoc.
