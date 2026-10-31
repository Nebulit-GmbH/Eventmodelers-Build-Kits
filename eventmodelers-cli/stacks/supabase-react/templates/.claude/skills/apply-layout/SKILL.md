---
name: apply-layout
description: Build a layout slice — a slice with a screen but no command and no read model, whose screen is the overall layout (sidebar, header, shell around a content area) — by turning that screen's markup into the app layout every page of the slice's timeline renders inside. Use when the task's slice has screens but no commands/readmodels/processors, instead of build-state-change/build-state-view.
---

# Apply Layout

A **layout slice** is not a feature. Its screen shows the shell the whole app should look like — brand,
sidebar or top navigation, a content area — and its UI prompts (`codeGen.uiPrompts`) say anything the
mockup cannot (e.g. "sidebar collapses on small screens"). This skill reads that screen and makes it the
layout **of every page in the slice's timeline** (the slice's `contextName`). Pages of other timelines keep
the layout they have. One layout slice per timeline; a second one for the same timeline replaces the first.

Slices own their own folder; the layout is the one thing that is shared, so **this skill is the only
writer** of the layout files named below. A feature slice never edits them.

## Step 1 — Read slice.json and confirm it is a layout slice

Read `.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json` (run `/load-slice` first if it is only a
stub). It is a layout slice when `screens[]` has at least one entry and `commands`, `readmodels` and
`processors` are all empty. If it has any of those, stop and use `build-state-change`/`build-state-view`.

Collect:
- **`screens[0]`** — the layout screen (`id`, `title`).
- **`codeGen.uiPrompts`** — instructions typed on the board for this layout, if there are any (the field may
  be missing or empty: then there are none and the heuristics below decide everything). Read them
  **before** the screen: they say what the mockup cannot, and they **override** the heuristics in Steps 3
  and 4 wherever they speak to the same point — e.g. which area is the content, which pages the nav
  lists and in what order, whether it is a sidebar or a top bar, what the active state looks like,
  responsive behaviour, which timelines or pages the layout covers. Apply every one, and keep a note of
  how each was applied for your reply. A prompt that contradicts the mockup wins over the mockup; one
  that cannot be applied (names a page the model doesn't have) is applied as far as possible and
  reported, never ignored silently.
- **`contextName`** — the timeline this layout is for. Find its entry in `src/app/model.ts`
  (`TIMELINES`, matched by `title`): its `slug` names the layout file and its `pages` are the pages that get it.
  No match → `model.ts` predates this timeline (a `scaffold` refresh adds it). Don't stop: use the slug
  derived from `contextName` the way the scaffold does (lowercase, non-alphanumerics → `-`), take the
  timeline's pages from the screen titles in `.build-kit/.slices/<contextSlug>/index.json` matched
  against `PAGES`, and say so in your reply.

## Step 2 — Fetch the layout screen

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<screens[0].id>" }
```

The markup is in `meta.pages` (HTML strings; for a multi-step flow one per step — the layout is
`meta.pages[0]` unless a UI prompt names another). Also read `cssFrameworks`. Never trust the JSX already
in the repo; the board is the source.

If this project has `.claude/skills/learn-styleguide/`, read its references first: the mockup gives
structure and content, the style guide the real visual language.

## Step 3 — Read the markup as a generic layout, not a finished design

The layout screen is often **plain HTML**: a header, some links, a main area, no board conventions, and
nav captions that were typed as placeholders ("Dashboard", "Link 1", "Settings"). Do not expect it to
name the app's pages or mark its content area — work out what each part means for **this** app.

Classify every region of `meta.pages[0]`:

| Region | How to recognise it | Becomes |
|---|---|---|
| **Content slot** | In order: `data-em-slot="content"` / `id="content"`; an element with `data-em-mark-id`; `<main>`; the largest region beside the sidebar or below the header; the element after the last nav/header when the shell is only a bar. No navigation or header at all → the outermost container is the "shell", the slot is its body. | `<Outlet />` in place of the slot's children; the slot element itself (its tag, classes, padding, background) stays as the wrapper, and the drawn placeholder inside is dropped |
| **Navigation** | `<nav>`; a list of links in a sidebar/header; or — in a hand-drawn layout — a run of short sibling blocks (`<div>`, `<li>`, `<span>`) of plain text after the brand inside a sidebar/header, with no `<a>` at all | generated from the model, Step 4 |
| **Brand** | logo + name at the start of the shell | kept as copy |
| **User area** | avatar, name, email, sign-out, menu at the end of the shell | `email` prop + `onSignOut` |
| **Page header** | the screen's own `<h1>`, breadcrumb, intro text inside or above the slot | not ported — pages keep their own titles |
| **Everything else** | footer, banners, static links | kept 1:1 as copy; a link whose target is not a model page or an external URL gets `href="#"` and a `// TODO` |

Where a UI prompt names a region, it decides; otherwise choose the most plausible reading and say what you chose in your reply. Ask (`/request-feedback`) only
if no region could plausibly be the content slot.

## Step 4 — Derive the navigation from the model

The drawn items give the **look** (markup, classes, icon, the active-state variant, grouping); the **entries**
come from the model, because the mockup's captions are only a sketch. A UI prompt that lists the entries
(or says which pages to include or leave out) replaces steps 2 and 3 below: use exactly what it names,
resolved against `PAGES`. The layout screen's own page
(`PAGES` entry named after its title) is never an entry — unless other slices share that screen title
(the layout is often drawn on a feature screen, e.g. "New Organization"): then it is a normal page and
follows the rules below.

1. **Item template.** In the nav, take one item as the template and note how the active item differs
   from its siblings (an `is-active` / `active` / `aria-current` class, or — in a layout drawn with inline
   styles — the style properties only the highlighted item carries, e.g. a background and a heavier weight;
   render those only when the entry is active). The drawn items are often not links: turn each into a
   `NavLink` that keeps the item's tag, classes and style. Group
   headings, dividers and icons stay where drawn.
2. **Candidate entries — the timeline's entry pages.** From `src/app/model.ts`: pages in this timeline's
   `pages` (`TIMELINES[t].pages` → `PAGES`) with `hasParams: false` that carry a read-model slice
   (a `STATE_VIEW` in `TIMELINES[t].slices` whose title is in `PAGE.slices`), plus the page flagged as the
   home route. A page that only holds a command form ("New Contact") or needs an id in its route
   ("Contact Details") is reached from an entry page, not from the nav — unless the mockup lists it by
   name (rule 3).
3. **Match the drawn captions.** Compare each drawn caption with the `PAGES` titles in this timeline
   (and their slice titles): lower-case, drop the verbs "new/add/edit/create/register" and a trailing
   "list"/"overview", then match on a shared word stem of at least five letters ("Organizations" ↔
   "New Organization", "Archive" ↔ "Archived Contacts"). Several pages match → prefer an entry page, then
   a page without route parameters, then the first in `TIMELINES[t].pages`; say which you picked. A
   caption may match a command page when the timeline has no entry page for that word — the drawn nav
   is the author's intent, so link it rather than leave it dead.
   - **Most drawn items match a page** → *matching mode*: keep the drawn order and captions, link each to
     its page. A drawn item with no page stays as a non-link (`aria-disabled="true"`, same classes) with
     `// no page in the model for "<caption>"`.
   - **Few or none match** (generic placeholders) → *generated mode*: discard the drawn captions,
     repeat the item template once per candidate entry from step 2, caption = the page title, order =
     home page first, then the order the pages appear in `TIMELINES[t].pages`. Keep the number of groups
     only if the mockup draws headings; otherwise one flat list.
4. **Other timelines.** This layout replaces the app's default nav for this timeline's pages, so the
   other timelines would become unreachable from it. If the model has more than one timeline, add one
   more group at the end of the nav — same item markup, heading from the mockup's group heading style —
   with an entry per other timeline, `NavLink` to `/timelines/<slug>`, caption `TIMELINES[].title`.
   Leave it out if the mockup is a single bar with no room for a group and say so in your reply.
5. **Links.** A matched or generated entry is a `NavLink` to the page's `route`, active when the path
   matches that route, or any other route of the **same** timeline that is reached from it (a command
   page whose slice's screen sits next to that entry's read model). Never invent a route.
6. **Keep what the old layout did**: the signed-in email (`email` prop) and a sign-out control
   (`onSignOut`). If the mockup has no place for them, put them at the end of the shell in the
   mockup's own classes.
7. **Data in the shell** — the drawn user's name or initials, counts, badges, "3 new" markers — is never
   ported. The user is the `email` prop; anything else needing a read model: type it, leave
   `// TODO(<read model title>)` and render nothing in its place.

## Step 5 — Write the layout

Create `src/app/layouts/<TimelineSlug>Layout.tsx` (PascalCase of the slug, e.g. `customers-contacts` →
`CustomersContactsLayout.tsx`), translated **1:1** from the shell: same tags, same classes (the screen's
`cssFrameworks`), same structure and copy — the screen is the design. Only change what Steps 3 and 4 say and the
usual JSX conversion (`class`→`className`, self-closing tags, style objects, drop every
`data-em-mark-id` / `data-em-slot` attribute and `em-mark`/`em-mark-<hex>` class). Signature:

```tsx
import { NavLink, Outlet } from 'react-router-dom';
import type { LayoutProps } from '../Layout';

export function CustomersContactsLayout({ email, onSignOut }: LayoutProps) {
  return (/* the shell, with <Outlet /> where the content slot was */);
}
```

Apply the `uiPrompts` to this component (the ones not already used in Steps 3 and 4). Styles: follow `build-state-change` **Step 7** (detect the
framework, make sure `index.html` loads it, neutralise the Vite demo CSS). Never hand-write CSS to imitate
a framework.

## Step 6 — Register it in `src/app/Layout.tsx`

`Layout.tsx` is the one component `App.tsx` mounts around every route. The first layout slice turns it into
a dispatcher; later ones only add a line. Check what is there:

```bash
grep -n "apply-layout:registry" src/app/Layout.tsx
```

**Marker missing** → refactor once. Rename the existing exported `Layout` to `DefaultLayout`, keep its
markup unchanged, and change its signature to
`function DefaultLayout({ email, onSignOut, activeTimeline }: LayoutProps & { activeTimeline: TimelineInfo | undefined })`
(drop the `useLocation`/`matchPath` lookup it did itself, import `TimelineInfo` from `./model`). Then add:

```tsx
import type { ComponentType } from 'react';
import { CustomersContactsLayout } from './layouts/CustomersContactsLayout';

export type LayoutProps = { email: string | undefined; onSignOut: () => void };

// apply-layout:registry — one line per timeline that has a layout slice, keyed by TIMELINES[].slug.
// Written by the apply-layout skill; a timeline not listed here keeps DefaultLayout.
const LAYOUTS: Record<string, ComponentType<LayoutProps>> = {
  'customers-contacts': CustomersContactsLayout,
};

export function Layout(props: LayoutProps) {
  const { pathname } = useLocation();
  const activeTimeline = TIMELINES.find((t) =>
    matchPath(`/timelines/${t.slug}`, pathname) ||
    PAGES.some((p) => t.pages.includes(p.name) && matchPath(p.route, pathname)),
  );
  const Custom = activeTimeline && LAYOUTS[activeTimeline.slug];
  return Custom ? <Custom {...props} /> : <DefaultLayout {...props} activeTimeline={activeTimeline} />;
}
```

A page that belongs to several timelines gets the layout of the first of them in `TIMELINES` order, the
same one the default navigation highlights.

**Marker present** → add (or replace) only this timeline's import and its `LAYOUTS` entry. Keep keys
sorted, never touch another timeline's line.

Every layout component must render exactly one `<Outlet />`; without it no page shows.

## Step 7 — Make it survive `scaffold`

`src/app/Layout.tsx` is a scaffold-owned template: `eventmodelers scaffold` rewrites it on every refresh,
which would silently remove the registry. If the app was scaffolded (`../skeleton.json` exists — the kit
runs in `web/`, the app root is `..`), save the result as the app's own templates so a refresh reuses it:

```bash
mkdir -p ../templates/web/src/app/layouts
cp src/app/Layout.tsx ../templates/web/src/app/Layout.tsx.tmpl
cp src/app/layouts/<TimelineSlug>Layout.tsx ../templates/web/src/app/layouts/<TimelineSlug>Layout.tsx.tmpl
```

Copy every layout file under `src/app/layouts/` the first time you do this, and only the changed ones
afterwards. The scaffold fills `__APP_TITLE__`, `__API_PORT__`, `__WEB_PORT__`, `__DB_PORT__` in
templates — if a layout contains one of those literal strings by accident, rename it before copying.
No `../skeleton.json` → not a scaffolded app, skip this step.

## Step 8 — Verify

- `npm run build` and `npm run lint` pass clean.
- Grep the layout for the mockup's example data (a drawn person's name, counts, badges). Brand and nav
  captions are copy and may stay; any other hit is a bug.
- Every nav `NavLink` target is a `route` from `PAGES` or `/timelines/<slug>`; no drawn placeholder caption ("Link 1", lorem) survives in generated mode.
- The timeline's pages render inside the layout and pages of other timelines still use the default.

The slice's checks, commit (`feat: [Slice Name]`), `ui-baseline record` and status handling are the run
loop's normal steps (`lib/prompt.md`, steps 4–8); there is no `slice.json` field-by-field check for a
layout slice. In your reply, name each UI prompt and the change you made for it, the content slot you
chose, the navigation mode (matching or generated) with the entries it produced, which drawn items had no page, and which timeline the layout applies to.
