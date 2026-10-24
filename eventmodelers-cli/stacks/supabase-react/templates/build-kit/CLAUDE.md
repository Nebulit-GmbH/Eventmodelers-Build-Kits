# Project Configuration

Read `src/slices` to understand the global structure — each subdirectory is one board slice; there is no other domain code in this project.

This stack is UI-only: it only builds **state-change** (command → event, write side) and
**state-view** (read model, read side) slices. Translation slices default to
`build-state-change`. Automations/processors have no UI counterpart here — if a slice's
`processors` array is non-empty, that slice belongs to a backend stack, not this one; do
not attempt to build it, flag it via `request-feedback` instead.

## File Structure Constraints

- **Strict Path Limitation**: `src/slices/{contextSlug}/{laneSlug}/{slicename}/*` — the one
  exceptions are `src/pages/`, where multiple slices sharing one screen get composed together (see
  guideline 7 below), and — for the **first slice only** — `src/App.tsx` plus the Vite demo files it
  replaces (guideline 10 below); `index.html` and the demo `src/index.css` for every slice (guideline 11)
- **Slice Organization**: Each feature/domain should be organized as a separate slice

## Code Standards

- **Language**: TypeScript
- **Module System**: ESM
- **Type Safety**: TypeScript, strict mode (see `tsconfig.app.json`)

## Development Guidelines

1. Each slice should be self-contained and focused on a specific domain
2. Maintain clear separation of concerns within each slice
3. Headers, auth, `fetch`, and Supabase table access live exclusively in `src/lib/api.ts` — a
   slice component never imports `src/lib/supabase.ts` itself, never calls `fetch`, and never
   calls `supabase.from(...)` directly; a table-backed read model is always read directly with `queryReadModel` (the backend's `GET` contract is ignored for it); when the backend slice published a UI contract (`ui-contract` skill, `slice.json` `notes[]`) for a *write* or a non-table read, the slice is built *from* it — path, parameters, body and every error response — and falls back to `apiEndpoint`/`fields[]` only when none exists; it calls `postCommand`/`getReadModel`/`queryReadModel` and only contains
   business logic (validation, request-body shaping, response handling)
4. A command's/read-model's screen markup (`meta.pages` on its actor HTML_SCREEN node, scoped to
   this slice's `meta.marks` when the screen is shared) is the visual blueprint — translate it into
   JSX rather than redesigning it; see `build-state-change`/`build-state-view` Step 2
5. A slice's business logic lives in its component by default (plain `useState`, no ceremony). Only
   split it into a colocated `use<Name>.ts` hook when that's genuinely warranted — reused by more
   than one sibling component, or non-rendering logic large enough that separating it clearly helps
   — never by default or "for consistency"; see `build-state-change`/`build-state-view` Step 3.
6. **Design every slice for deletability**: its folder must be removable wholesale without
   leaving dangling imports elsewhere.
   - Local state shared only *within* one slice's sub-components (e.g. a multi-step command, a
     list + submit bar) — and *only* when a single component's own `useState` genuinely can't hold
     it — gets its own `<Name>Context.tsx`, colocated in that same slice folder, never in
     `src/lib`, never imported by another slice. This is the exception, not the default; most
     slices need no Context at all. Follow the same `createContext`/`XProvider`/`useX` shape used
     in this pattern's origin, `miro-eventmodeling` (e.g. `useReadOnly`/`ReadOnlyProvider`,
     `useUser`/`UserProvider`): a context object, a `<Name>Provider>` component owning the state,
     and a `use<Name>` hook wrapping `useContext` — throwing if the value is missing when there's
     no sensible default (slice-scoped state always throws), returning a plain default only for
     something genuinely app-wide.
   - Only concerns that are truly cross-cutting (current session, theme, feature flags — things
     every slice might need) get a shared provider under `src/lib/`, composed once where the app
     mounts its providers (e.g. `src/main.tsx`), the same way `miro-eventmodeling`'s root layout
     nests `UserProvider`/`OrganizationProvider`/etc.
   - A slice component must never import from another slice's folder — the one place that's allowed
     to is `src/pages/` (guideline 7). If two slices seem to need the same state, that state belongs
     in a `src/lib` provider, not a cross-slice import.
7. **A screen's title is the page name.** Several slices can each hold their own copy of one shared
   visual screen (one node per slice, each with a different mark, per the `html-screen` skill) —
   when their screens share a `title`, their components belong on one real page together, arranged
   as the marks show. The count of *distinct* screen titles across the board is a direct hint at how
   many pages this app needs, not one page per slice. That composition lives at
   `src/pages/<ScreenTitle>.tsx`, translating the screen's whole unmarked markup into JSX and
   substituting each marked position with that slice's actual component; see
   `build-state-change`/`build-state-view`'s page-composition step for the full procedure.
8. **A screen's lane is reflected in the folder.** The actor row (lane) a slice's screen is placed
   in on the board — e.g. "Admin" vs. "Customer" — becomes a folder segment between context and
   slice: `src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/`. Resolve it via
   `mcp__eventmodelers__get_board_outline` on the screen's chapter (returns `{id, type, title,
   lane}` per node); see `build-state-change`/`build-state-view` Step 2. Omit the segment only for
   the rare slice with no screen at all.
9. **Every component is testable in isolation, with samples.** A component must render sensibly
   with no data (an empty/background state, not a crash), and must be exercisable with no real
   backend running. Every slice ships a colocated `samples/sample-<N>.json` per numbered scenario
   (`sample-1.json`, `sample-2.json`, ...) — for a STATE_VIEW component, shaped exactly like the
   row(s) its `queryReadModel` call returns; for a STATE_CHANGE component, a full set of prop
   values. `src/lib/api.ts`'s `postCommand`/`queryReadModel` are mock-aware: set
   `VITE_DATA_MODE=mock` and every read is served from `samples/sample-<VITE_MOCK_SAMPLE>.json`
   instead of Supabase, and every command POST resolves locally instead of hitting the network —
   flipping one env var is the "switch between samples" mechanism, nothing per-component to wire.
   The same number across different components' samples represents one coherent scenario across
   the app, not an arbitrary per-component index. See `build-state-change`/`build-state-view`'s
   samples step for the full convention.

10. **The first slice also builds the base page.** `src/App.tsx` ships as the Vite demo. When the
    slice being built is the first one in the project (no other folder under `src/slices/`), replace
    it with a minimal base page rendering that slice's page or component and delete the demo-only
    files; no router, no new dependency. Later slices never touch `src/App.tsx`. See
    `build-state-change` Step 8 / `build-state-view` Step 7.
11. **Every slice loads its screen's styles.** The mockup's classes are meaningless without the CSS
    framework the board renders them with. Each slice detects it (`cssFrameworks`, else the classes
    in `meta.pages`; none → Vite's default stays as is), makes sure `index.html` loads it, and neutralises the Vite demo
    `src/index.css` if it's still there — automatically, idempotently, so an existing project heals
    on its next build. Never hand-write CSS to imitate a framework. See `build-state-change` Step 7 /
    `build-state-view` Step 6.

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project learnings. It is generated from the learnings recorded so far — record a new one with `npx @eventmodelers/cli learn "<one terse line>" --topic <topic>`, never by editing the file.

When working from a queued task, invoke the `update-slice-status` skill with `InProgress` status before doing anything else. When the task request names the slice to build (a run-loop build), the run loop has already set it to `InProgress` and pushes the final status itself — do not call `update-slice-status`; record the outcome with `npx @eventmodelers/cli slice-status <status>`.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do NOT invent, assume, or guess any field or logic not present in the slice definition.**

**Default: make a reasonable assumption and build the slice.** If a detail is unclear or missing (an example value, a field type, a status mapping, a referenced event that isn't modeled yet, ...), pick the most sensible interpretation from `slice.json`, its specifications and the surrounding model, build it, and record each assumption in one line as a code comment. Ambiguity alone is never a reason to stop. **Only if the slice literally cannot be built** — nothing runnable can be produced even with sensible assumptions — invoke `/request-feedback` with the specific question; it posts the question as a comment on the slice and marks it `Blocked`. That must be the absolute exception; a `Blocked` slice should mean "impossible without a human", never "the agent preferred to ask".

**Exception: a missing `apiEndpoint`** (no backend endpoint/table decided yet) is a partial version of
this — flag it, but don't fully stop. `build-state-change`/`build-state-view` Step 1 cover the exact
mechanics: post a comment on the slice and mark it `Blocked` (same as `request-feedback`), but then
keep going — build the slice normally against a provisional mock path/table name with meaningful
sample data. The slice ends this run `Blocked` (step 6 below does not flip it to `Done`), but the code
is there, mocked, ready to be pointed at the real API once one exists.

When asked to build a slice, always follow this flow:

1. Read the slice definition from `.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json`.
   **If `slice.json` is missing, or has no `commands`, `events`, `readmodels`, `screens` or `processors` (only id/title/status/sliceType/contextName), it is a summary stub, not an empty slice — never conclude "nothing to build" from it.** Run `/load-slice` with the slice's `sliceId` to pull the full definition from the board and re-read `slice.json`. Only a slice that is still empty after that full fetch is genuinely empty.
2. Determine the slice type from `sliceType`:
   - **`STATE_CHANGE`** → invoke `/build-state-change`
   - **`STATE_VIEW`** → invoke `/build-state-view`
   - **`AUTOMATION`** → not this stack's job (no UI counterpart) — invoke `request-feedback`
     rather than building it; it belongs to whichever backend stack is installed alongside this one
3. Invoke the matching skill and follow its instructions completely. Do not deviate.
4. **UI baseline gate**: run `npx @eventmodelers/cli ui-baseline check` first and act only on its verdict — `UNCHANGED` means skip all UI work; `NO_BASELINE`/`UNKNOWN` mean one full screen diff and every `codeGen.uiPrompts` entry; `CHANGED` names the elements that changed, were added or removed (work on exactly those) and flags `SCREEN_CHANGED` (re-fetch the screen node and adjust the components to it), `ELEMENTS_CHANGED` (diff slice.json against the code) and `PROMPTS_CHANGED` (apply the printed prompts). Details in `lib/prompt.md`, Step 4. After the checks pass and before committing, run `ui-baseline record`.
5. **Verify against slice.json**: After the skill completes, check that every command field, event field, and specification in slice.json appears in the implementation — specifications are read (Step 3a of the build skill) to understand how the UI should behave and present outcomes; the business logic lives in the backend and is not re-implemented here. No invented fields — if it is not in slice.json, it must not be in the code.
6. Run `npm run build` and `npm run lint` (both must pass clean), then the slice's own tests only, if any exist.
7. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done` — **unless** the
   matching build skill flagged a missing `apiEndpoint` and already marked the slice `Blocked`
   (Step 1 exception above); in that case, commit as normal but leave the status `Blocked`.

After you are done, automatically run the tests for the slice that was edited.

## Example Slice Structure

```
src/lib/supabase.ts                                # Supabase client singleton — imported ONLY by api.ts
src/lib/api.ts                                     # postCommand/queryReadModel + auth headers + mock-mode switch (shared, not per-slice)
src/lib/<CrossCutting>Provider.tsx                  # only for concerns every slice might need (session, theme, ...)
src/pages/<ScreenTitle>.tsx                         # only when >1 slice shares a screen title — composes their components
src/App.tsx                                        # base page — replaces the Vite demo when the first slice is built, untouched afterwards
src/slices/<contextSlug>/<laneSlug>/<sliceFolder>/
  <CommandTitle>.tsx                                # STATE_CHANGE slice — component (logic inline by default)
  use<CommandTitle>.ts                              # only if the logic was genuinely worth splitting out
  <CommandTitle>Context.tsx                         # only if sibling components must share state
  <ReadModelTitle>.tsx                              # STATE_VIEW slice — component (logic inline by default)
  samples/
    sample-1.json                                   # one numbered scenario per file — props (STATE_CHANGE) or query result (STATE_VIEW)
    sample-2.json
```

Everything under one `<sliceFolder>/` is deletable as a unit — nothing outside it should import
from it except the parent that renders the slice's top-level component, or `src/pages/` when this
slice's screen is composed into a shared page.

`contextSlug`/`sliceFolder` are derived exactly as in the `load-slice` skill, and `laneSlug` per
guideline 8 above — so a slice's frontend code nests one level deeper than the staging data at
`.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json` (which has no lane concept), rather
than mirroring it 1:1.
