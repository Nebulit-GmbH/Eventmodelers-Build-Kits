---
name: prototype
description: Build a clickable, event-sourced prototype of one context (a MODEL_CONTEXT or a timeline's effective context) as a single HTML page the platform serves — React standalone, no build step, no server logic. Built slice by slice — one block per slice, each with a hash of its slice — so a re-run regenerates only the slices that changed on the board. Screens become tabs (one per screen name) rebuilt 1:1 from the board's HTML screens or sketches; each read model is one component, each command the inputs and button that fire it; events are recorded in an in-browser event store and can be browsed; logic and todo lists follow the GWT scenarios, which also run as an in-page check; automations appear in their own tab when their todo list has items. Read-only on the board. Use for "build a prototype of X", "make the Registration context clickable", "update the prototype".
---

# Prototype — one context, clickable in the browser

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools for reading. The curl fallback is in `references/api-fallback.md`.

**The result is one file**, `<out>/index.html` (default `out` = `prototypes/<context-slug>/`, `context-slug` = kebab-case name). The board app shows it in a sandboxed iframe (the ▶ button on each timeline), and the libraries it loads come from the app's `public/vendor/` (React 18.3.1, ReactDOM, Babel standalone 7.24.7, the CSS frameworks the HTML screens use). Nothing else is needed at run time: the page compiles its own JSX, keeps its events in the browser, checks its own scenarios on load and shows any failure as a red banner.

It is put together from:

| Part | What it is | Who writes it |
|---|---|---|
| `assets/index.template.html` | the page: platform library tags, the prototype kit (hooks, tabs, event browser, automations tab, simulate/specs/clock panel) and the loader | fixed — never edited per prototype |
| `assets/runtime.js` | event store, command bus, automation runner, scenario runner, slice registry | fixed — pasted in by `assemble` |
| **one slice block per slice** | everything of one slice: its command / read model / automation, its scenarios, its part of the screen | **you**, only for new and changed slices — contract in `assets/slices.example.html` |

`assets/prototype.mjs` does the bookkeeping: `status` fetches the context, hashes every slice and says which slices are new, changed, unchanged or removed; `assemble` builds the page from the template, the runtime and the blocks; `upload` hands it to the platform (`POST …/prototype/<context id>`), which sanitizes it, gzips it and stores it per effective context at `<board id>/<context id>.gz` in the organization's storage. It runs where you run (the CLI agent), never in the page. `<skill-dir>` below is the folder this SKILL.md is in (usually `.claude/skills/prototype`).

**Every run ends with an upload.** The ▶ player only plays what the platform stores — a page that exists only in `<out>` is invisible to everyone, and opening it from disk doesn't work either (its libraries come from the app's `/vendor/`). So a run is done when `upload` has printed where the platform stored the page, never before; there is no "open the local file instead".

**This skill never writes to the board.** Gaps it runs into go into the report, not onto the board.

**Faithfulness is the point.** People check the model by using the prototype, so it behaves as the board says. Implement as much of the logic as the board defines — from the scenarios first, then fields, names and descriptions — and nothing it doesn't: a rule nobody modelled is not enforced, and a button the board doesn't wire to anything stays visible but says it is not modeled.

---

## Step 1 — Which context

From `$ARGUMENTS`: the context (a MODEL_CONTEXT name or a timeline name) and optionally `out=<dir>`. Also optionally `more-questions asked=<id,id,…>` (the player's **Add more questions** button): see Step 5b.

The unit is the **effective context**: a timeline assigned to or connected with a MODEL_CONTEXT belongs to that context; a timeline with neither is its own context. Either name returns the whole effective context — every timeline in it, each slice carrying its `chapter`.

**Pass the id, not the name, whenever you have it** — the turn's `timelineId` (or a MODEL_CONTEXT's id) goes straight into `--context "<id>"`. A chapter may have no name at all; never rename a chapter to make the lookup work, and never ask about it.

No context given, or a name that matches nothing: list the options once —

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "MODEL_CONTEXT", "projection": "line" }
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER", "projection": "line" }
```

— and ask: in a chat turn with a `poll` snippet whose options are complete `/prototype <name>` messages, in a terminal in text. One context per run.

---

## Step 2 — What changed

```bash
EM_TOKEN="$TOKEN" node <skill-dir>/assets/prototype.mjs status \
  --base "$BASE_URL" --org "$ORG_ID" --board "$BOARD_ID" --context "<CONTEXT>" --out <out>
```

(`TOKEN` from `connect` — when it is the `$EVENTMODELERS_TOKEN` reference, pass `EM_TOKEN="$EVENTMODELERS_TOKEN"`; never write the token on the command line itself.)

Per slice, the hash covers its elements with their fields and dependencies, its scenarios and storylines, and the content of its screens (HTML pages and marks, or the sketch) — not its status, assignee, ticket or comments, so moving a slice to Done rebuilds nothing. The hashes are compared with those on the blocks of the prototype the platform stores for this context — the page itself is the memory, no other state is kept — so a run in another chat session, folder or machine still rebuilds only what changed. `status` downloads it itself; the page never passes through you. Only when the platform has none yet does it fall back to a local `<out>/index.html` (an earlier run whose upload failed); `baseline` in `status.json` says which it was (`platform` / `local` / `none`).

`<out>/.work/status.json` carries the context's id (`contextId` — the MODEL_CONTEXT or timeline the name matched; the platform resolves a timeline to its effective context when storing) and lists every slice with `state` (`new` / `changed` / `unchanged`), its `hash`, `order` and `sliceType`, plus `removed` slices and the CSS framework the screens use. The blocks of unchanged slices are already copied to `<out>/.work/slices/<slice id>.html`.

**Nothing new or changed and nothing removed** → the local page is up to date, but that says nothing about the platform's copy (an earlier run may have stopped before uploading). Skip writing blocks (Steps 3–5) but still run `assemble` and **Upload** in Step 6 — `assemble` takes the template and runtime fresh from the skill, so a kit fix to the harness reaches the page even when the board didn't change — then report.

A change in one slice can matter to another (a renamed event field that a read model in another slice reads): that slice's own JSON changes with it, so it is flagged too. Build only what is flagged.

---

## Step 3 — Read the flagged slices

For the new and changed slices only, **one call for all of them** — never one call per slice:

```
mcp__eventmodelers__get_slice_data { "boardId": "<BOARD_ID>", "contextName": "<CONTEXT>", "sliceIds": ["<id>", …], "format": "json" }
```

No `projection`: each slice comes with its fields **and** its specs.

- the slice's elements → `sliceType`, `commands[]`, `events[]`, `readmodels[]`, `screens[]`, `processors[]` (automations), each element with `fields[]` (`type`, `example`, `generated`, `idAttribute`, `cardinality`, `subfields`, `mapping`), `description` and `dependencies[]` (`INBOUND`/`OUTBOUND`) — the wiring SCREEN → COMMAND → EVENT → READMODEL → SCREEN / AUTOMATION → COMMAND.
- its specs → `specifications[]` (`given` / `when` / `then` with example values; a rejection is a `then` step of type `SPEC_ERROR` whose `description` is the message; `expectEmptyList` on read-model steps) and `storylines[]`.

**Screens.** For each of the slices' screens read its own node — `linkedId` when set (a copy can carry its own marks), else `id` — all of them in one call: `mcp__eventmodelers__get_nodes { "boardId", "nodeIds": [...] }`. `HTML_SCREEN` → `meta.pages`, `meta.marks`, `meta.fields`. `SCREEN` → `mcp__eventmodelers__get_image_snapshot_description { "boardId", "nodeId" }` for its sketch `{ elements }` (grid vocabulary in `storyboard-screen`); none (an uploaded screenshot) → the screen's fields are all there is.

**Copies.** An element with `elementCopy: true` is a linked copy (its `id` is the original's). It is defined by the slice that owns the original, never twice. An EVENT whose original lives in another context, or that no COMMAND in this context produces, is an **external event**.

---

## Step 4 — The logic, from the scenarios

Write each flagged slice's logic before its UI. Names are the board's titles without spaces (`Register Customer` → `RegisterCustomer`); field names verbatim. Every element belongs to exactly one slice: a command to its state-change slice, a read model to its state-view slice, a todo list and its automation (and the automation's command, when it has no slice of its own) to the automation slice.

**Analyse the scenarios first** — they are the logic. Line up all of the element's scenarios and read them together: what the `given` events have in common, what makes the `then` differ. Then implement what they show, as completely as they allow:

**Commands** — `decide(history, cmd, ctx)` returns the events or calls `EMRuntime.reject('<message>')`.
- Each scenario with a `SPEC_ERROR` is a rule: reject exactly the `given` situation, with its `description` as the message. Scenarios producing different events from different histories are branches of `decide`. A command without rejection scenarios never rejects — not even empty input.
- Event data: each event field from the command field of the same name or its `mapping`; `generated` values here — ids `ctx.uuid()`, timestamps `ctx.now.toISOString()`; values the command doesn't carry but the history does (the email of a `customerId`) from the history, filtered by the `idAttribute` the scenarios use.

**Read models** — `initial`, `evolve(state, event)` per INBOUND event, optional `query(state, params)`.
- The scenarios say which event adds, changes or removes what: compare their `given` sequences with the expected rows. Field names and the `description` fill in only what no scenario shows.
- `cardinality: "List"` / list-shaped scenarios / `listElement` → an array of rows; otherwise one object, `null` before its first event. `params` scopes a query to what the screen selected.

**Todo lists and automations.** A todo list is the read model an automation works off. **How an item gets onto the list and off it comes from the todo list's scenarios** (given the triggering event → the item is listed; given the event the automation's command records as well → the list is empty) and, failing those, from the events the board connects: the INBOUND event that triggers the automation adds the item, the event its command records removes it.
- Automation entry: `readModel`, `todo(result, ctx)` (the items to act on now — for a time-based one, those due at `ctx.now`), `process(item, ctx)` → `{ effect?, command: { type, data } }`, `trigger: 'auto'` or `'schedule'` (description or scenarios tie it to time), `external: true` when the command calls the outside world (send a mail, charge a card — the `effect` text appears in the outbox, the command records the outcome as if the call succeeded).
- Automations run when someone presses **Run** in the Automations tab (or with *run automatically* switched on). They only appear there while their todo list has open items — so a todo list that never empties is a bug the prototype makes visible.

**External events** — `externalEvents: [{ type, from, fields: [{ name, type, example }] }]` on the slice that consumes them; the simulate panel records them, which is how translation automations get triggered.

**Specs — every scenario and every storyline of the slice**, one entry each:

| Scenario | Spec entry |
|---|---|
| `when` COMMAND, `then` events | `kind: 'command'`, `given`, `when`, `then` |
| `then` `SPEC_ERROR` | `kind: 'command'`, `error: '<description>'`, no `then` |
| `then` READMODEL | `kind: 'readmodel'`, `readModel`, `given`, `expect` (`[]` when `expectEmptyList`) |
| todo list with the automation's command expected | `kind: 'automation'`, `automation`, `given`, `expectCommands` |
| storyline | walk the beats, accumulating EVENT beats as `given`; a COMMAND beat with its events → a `command` spec, a READMODEL beat with examples → a `readmodel` spec |

Example values become typed data (`Int`/`Double` → numbers, `Boolean` → booleans, list fields → arrays of objects from `subfields`). Leave out of `then`/`expect` what the domain generates (ids, timestamps not named by the scenario) — only what an entry names is compared.

---

## Step 5 — The slice's part of the screen

**Screens are tabs, one per screen name.** Slices whose screens share a name contribute to the same tab, in timeline order — so a screen shown in three slices with three different marks is one tab with three parts. A slice declares its part as `screens: { '<Screen Title>': { actor: '<lane>', part: Component } }`.

**Read the screen HTML for what belongs to this slice:**
- **a read model is one component** — the region of the screen that shows its data (a table, a card, a summary). The mockup's example values are replaced by `useReadModel('<ReadModel>', params)`; repeated example rows become one row mapped over the result; an empty result shows an empty state, never the sample rows.
- **a command is its inputs plus the button that fires it** — inputs bound to the command's fields (by the screen's `meta.fields`, else label ↔ field name; controlled state, examples as `placeholder`), the button named like the command (or the screen's only primary button) calling `useCommand('<Command>').run(form)`; on success `useNav().go('<next screen title>')` — the next screen of this actor in timeline order. Show `.error` next to the button.
- **marks decide when the screen is shared**: the marked element is this slice's part. Unmarked and shared: this slice takes the elements bound to its own command or read model.
- a button inside a list row navigates with the row's ids (`go('<title>', { orderId })`) or issues that row's command with them.
- a button the model gives no meaning to: kept as designed, `onClick={() => notModeled('<label>')}` (`const notModeled = useNotModeled()`), and listed in the report.

**HTML screens — 1:1**: translate the slice's region of `meta.pages` into JSX without redesigning it (`class` → `className`, `for` → `htmlFor`, style strings → objects, void elements closed). Several pages → a step-through with local `page` state. **Sketch screens — redrawn**: a 1000×800 relative container, each element absolutely positioned at `gridX*20`/`gridY*20` (`gridWidth*20` × `gridHeight*20`) — `rectangle` → `div`, `headline`/`text` → text at its `fontSize`, `button` → `<button>`, `input` → `<input placeholder>`, `image` → a filled box, `line`/`circle` → inline SVG — then wired the same way.

Automation slices usually have no screen part — the Automations tab shows them.

---

## Step 5b — The questions (afresh on every run)

The prototype also **asks**: a guided tour through the screens, one `?` tag per question on the element it is about, a Next button leading from question to question — also onto another screen. This is how the people playing it tell us what the screens do (what is stored, what happens next, which rules apply). **What to ask, in which order and in which words: `eventmodeling-workshop-questions`** — read it, don't improvise a catalog.

**Regenerate the questions on every run, from the model as it is now** — also when every slice is `unchanged`, and never copied from the stored page: a question that was answered by the model since, or points at an element that is gone, must not come back. Write them to `<out>/.work/questions.json` (`assemble` embeds them; without the file the page asks nothing), an array in tour order:

```json
[{ "id": "save-note-action", "screen": "Activity Composer", "ref": "text:Save note", "category": "action",
   "text": "What happens when someone saves a note?",
   "setup": { "spec": "<title of a scenario>" } }]
```

- `screen` is a tab title (a screen name from Step 5); `ref` the element: `text:<its visible text, label or placeholder>` — preferably this, so a question never depends on markup inside a slice block — or a `data-em-ref="…"` value you put on the element in a block you are rewriting anyway. `id` unique and **derived, never invented**: `<screen>-<element text>-<category>` as a slug (e.g. `activity-composer-save-note-action`) — the same element and category get the same id on every run even when you reword `text`; the player remembers answered ids, so a changed id makes the customer answer the same question twice. A question the model now answers (the scenario, field or screen exists) is **left out**, not kept. `category` and `text` from the catalog; `setup` optional (see there; `spec` must name a scenario in `specs`, `assemble` checks).
- **Guide along the timeline, as strictly as possible:** the tour follows the event model left to right — slices by their `order` in `status.json`, inside a slice the elements in timeline order (screen → command → event → read model → the next slice's screen), so Next never jumps back to an earlier part of the story. Depart from it only when unavoidable (a situation a later slice creates is a `setup`, not a reason to reorder). **Drive it forward**: at most two questions per screen, a `next` question after every action ("what happens after this?"), and at the end of the timeline one open question about what follows (`eventmodeling-workshop-questions`, "always ask what comes next") — never a tour that circles the same few screens. Keep it to the questions that matter, and set the scene (`setup`) wherever the question is about a situation.

**`more-questions` (next round).** Without it a rebuild writes the same ids again, and the player hides every one already answered — so a rebuild never brings anything new. With `more-questions asked=<ids>` write the full tour as usual **plus a next round**: new questions whose id is **not** in `asked` — never reuse an id: an id in `asked` is a question already put to the people, and the player would hide the new one as answered. A new question on an element and category that already has one (another angle) gets the derived id plus a round suffix (`…-action-2`, then `-3`); check every id you write against `asked` and against the others in the file. Go deeper than the first round — `rule`, `example`, `who`, `time`, `view` for the elements the happy path showed to be risky, and elements no question touched yet — still only what the model does not answer, still one per element that matters most. Keep the earlier questions in the file (answered ones are hidden by the player, open ones stay open). If the model leaves nothing worth asking, say so in the report rather than inventing questions.

## Step 6 — Write the blocks, assemble, check

Write each new or changed slice to `<out>/.work/slices/<slice id>.html`, exactly in the shape of `assets/slices.example.html`:

- one `<script type="text/plain" data-em-slice="<slice id>" data-em-title="<slice title>" data-em-hash="<hash from status.json>">` element whose body ends with one `EMRuntime.defineSlice({ id, title, order, commands, readModels, automations, externalEvents, specs, screens })` call; `order` from `status.json`;
- JSX and modern JavaScript; React hooks as `React.useState`; `useCommand`, `useReadModel`, `useNav`, `useNotModeled` are globals;
- never the text of a closing script tag inside the block, not even in a string or comment.

Then:

```bash
node <skill-dir>/assets/prototype.mjs assemble --out <out>
```

It refuses to write the page while a flagged slice has no block, a block's hash doesn't match, or a block contains a closing script tag. Removed slices simply drop out. The template and the runtime are always taken fresh from the skill, so kit fixes reach every prototype on its next run.

**Upload — always, right after `assemble`** (the check below runs against the uploaded page):

```bash
EM_TOKEN="$TOKEN" node <skill-dir>/assets/prototype.mjs upload \
  --base "$BASE_URL" --org "$ORG_ID" --board "$BOARD_ID" --out <out>
```

It prints where the platform stored the page and anything its sanitizer removed. If it fails, read the error and fix the cause (an expired token → run `connect` again; a 4xx naming the page → fix the block) and upload again. Only when it still fails, report the failure with the platform's error as the outcome of the run — not the local file as a substitute. A generated page loads scripts and stylesheets only from `/vendor/` and has no inline event handlers, so normally nothing is removed — if something is, a block broke the contract (a CDN link, an `onclick` attribute instead of a JSX `onClick`); fix that block, assemble and upload again.

**Check in the browser.** Every check runs in the page: the scenarios on load (red banner listing each failing scenario with expected vs. actual), each slice block compiling on its own (a broken block shows a banner naming its slice; the rest keeps working), and each part rendering inside its own error boundary. If a browser automation MCP (Playwright, Puppeteer, Chrome DevTools) is connected, open the page where the platform serves it (or any server that provides `/vendor/…`), confirm there is no banner, and fire the first tab's main command. A failing scenario means the logic is wrong — fix the block, never the scenario. Two scenarios that contradict each other: keep the one that fits the rest of the model, drop the other from `specs` and report it. Without a browser you cannot see the banner — say in the report that the scenarios were not run.

---

## Step 7 — Report

In a few lines:
- that it is uploaded — where the platform stored it (`upload` prints the path) — and that it plays with the ▶ button on any of the context's timelines (the player sandboxes the page without storage, so the event log lives until the player closes — *Copy log* / *Paste log* keep or move a session, *Reset* clears it).
- what this run did: `N` slices built (new / changed), `M` unchanged and kept, `K` removed — and the totals: tabs, commands, read models, automations by kind, external events to simulate, scenarios and whether they pass.
- the gaps found, one line each with the element: buttons not modeled, commands nothing issues, read models nothing shows or nothing feeds, screen fields without a read model, todo lists whose scenarios never remove an item, contradictory scenarios, mixed CSS frameworks (`mixedFrameworks` in `status.json`). These are findings about the model — offer `/wdyt` or the matching modeling skill; don't fix the board from here.

In a chat turn this report is the reply (`post_chat_message`, `replyTo` = this turn's `message_id`) **and always carries the prototype as a `prototype` snippet**, so the person can try it right there — with Restart, and Full screen for the board's player:

```json
{ "kind": "prototype", "timelineId": "<contextId from status.json>", "title": "Prototype · <CONTEXT>", "caption": "<N> tabs · <S> scenarios" }
```

Only after `upload` succeeded — without a stored page the snippet shows "No prototype has been built for this yet". Never send the page itself as `html`: an assembled prototype is far over the snippet's 60000 characters. In a terminal there is no snippet: name the ▶ button on the context's timelines instead.

Never hand-edit a block in the assembled page and expect it to survive: the board is the source, and the next run regenerates any slice whose hash changed.
