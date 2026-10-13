---
name: prototype
description: Build a clickable, event-sourced prototype of one context (a MODEL_CONTEXT or a timeline's effective context) that runs straight from disk in the browser — React standalone, no build step. The board's HTML screens are rebuilt 1:1 (sketch screens redrawn from their sketch), every button issues the command it is wired to, read models are projected live from an in-browser event store, automations run on their own, the board's GWT scenarios are the business rules and run as an in-page spec suite. Read-only on the board. Use for "build a prototype of X", "make the Registration context clickable", "can we try this out in the browser?".
---

# Prototype — one context, runnable in the browser

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. The curl fallback for every read is in `references/api-fallback.md`.

The result is a folder with three files that open with a double-click — no server, no `npm install` (plus a one-line `package.json` that only the node spec run needs, Step 4). `<skill-dir>` below is the folder this SKILL.md is in (usually `.claude/skills/prototype`):

| File | What it is | Who writes it |
|---|---|---|
| `runtime.js` | event store (localStorage), command bus, automation runner, spec runner | **copied verbatim** from `assets/runtime.js` — never edited |
| `domain.js` | the context's business logic: one decider per command, one projection per read model, one entry per automation, every scenario as a spec | generated (Step 4), contract in `assets/domain.example.js` |
| `index.html` | React 18 + Babel standalone, the rebuilt screens and the fixed prototype chrome (event log, automations, simulated external events, specs, clock) | `assets/index.template.html`, with the screens filled in (Step 5) |

**This skill never writes to the board.** It reads one context and turns it into code. Gaps it runs into (a button nothing is wired to, a rule with no scenario) go into the report, not onto the board.

**Faithfulness is the point.** The prototype is how people check the model by using it, so it must behave exactly as the board says — no more. A rule nobody modelled is not enforced; a button the board doesn't wire to anything stays visible but tells the user it is not modeled. Never "improve" a screen or add validation the scenarios don't state.

---

## Step 1 — Which context

From `$ARGUMENTS`: the context (a MODEL_CONTEXT title or a timeline title) and an optional `out=<dir>` (default `prototypes/<context-slug>/` in the working directory, `context-slug` = kebab-case title).

The unit is the **effective context**: a timeline assigned to or connected with a MODEL_CONTEXT belongs to that context, and a timeline with neither is its own context. Passing either name to `get_slice_data` returns the whole effective context — every timeline in it, each slice carrying its `chapter`.

No context given, or a name that matches nothing: list the options once and ask —

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "MODEL_CONTEXT", "projection": "line" }
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER", "projection": "line" }
```

In a chat turn ask with a `poll` snippet whose options are complete `/prototype <name>` messages; in a terminal ask in text. One context per run — a whole board is several prototypes.

---

## Step 2 — Read the context

Two reads cover the model; run them in parallel:

```
mcp__eventmodelers__get_slice_data { "boardId": "<BOARD_ID>", "contextName": "<CONTEXT>", "projection": "fields", "format": "json" }
mcp__eventmodelers__get_slice_data { "boardId": "<BOARD_ID>", "contextName": "<CONTEXT>", "projection": "specs",  "format": "json" }
```

- `fields` → per slice: `sliceType`, `chapter`, `commands[]`, `events[]`, `readmodels[]`, `screens[]`, `processors[]` (automations), `actors[]`, each element with `fields[]` (type, `example`, `generated`, `idAttribute`, `cardinality`, `subfields`, `mapping`) and `dependencies[]` (`INBOUND`/`OUTBOUND` with `elementType`/`title`) — the wiring: SCREEN → COMMAND → EVENT → READMODEL → SCREEN/AUTOMATION → COMMAND.
- `specs` → per slice: `specifications[]` (GWT: `given`/`when`/`then` steps with field examples; a rejection is a `then` step of type `SPEC_ERROR` whose `description` is the rule's message; `expectEmptyList` on read-model steps) and `storylines[]`.

**Copies.** An element with `elementCopy: true` is a linked copy: its `id` is the original's, `linkedId` its own node. Model each element **once**, by `id`; a copy only tells you where else it is used. An event whose original lives in another context is an external event (Step 3).

**Order.** For each chapter in the response, `mcp__eventmodelers__get_board_outline { "boardId", "chapterId" }` gives the column order — the order screens appear in the navigation and the order the flow runs. The lane a screen sits in is its actor (`lane` on the element).

**Screens.** Collect every screen's node id — `linkedId` when set (a copy can carry its own marks), else `id` — and read the full records in one call:

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "nodeIds": ["<screen ids>"] }
```

- `HTML_SCREEN` → `meta.pages` (one HTML fragment per page), `meta.marks`, `cssFrameworks` (`bulma` when empty), `meta.fields`.
- `SCREEN` (sketch) → load its sketch: `mcp__eventmodelers__get_image_snapshot_description { "boardId", "nodeId" }` → `{ elements: [...] }` on the 50×40 grid (the vocabulary is in `storyboard-screen`). No description (an uploaded screenshot): use the node's image URL if the record carries one, plus a generated form/list from the screen's fields.

Read nothing else. Element descriptions and comments are in the `fields` response already when present and are implementation hints (sort order, filtering, what a field means).

---

## Step 3 — Classify

Build these lists before writing code; they become the report's counts.

| Kind | How to recognise it | In the prototype |
|---|---|---|
| **Command** | every COMMAND in the context | `Domain.commands[<Title>]`, issued by its screen's button or its automation |
| **Read model** | every READMODEL | `Domain.readModels[<Title>]`, fed by its INBOUND events |
| **Todo list** | a READMODEL with an OUTBOUND dependency to an AUTOMATION (or `todoList: true`) | a read model whose `query` returns the open items |
| **Automation — internal** | AUTOMATION whose todo list and command are both in this context | `trigger: 'auto'`, runs as soon as its todo list has items |
| **Automation — outside world** | the command calls something outside the system (send mail, charge card, call an API — title/description say so) | `trigger: 'auto'`, `process` returns an `effect` (shown in the outbox) and the command that records the outcome as if the call succeeded |
| **Automation — scheduled** | description/scenarios tie it to time ("daily", "after 14 days", a deadline field) | `trigger: 'schedule'` — runs on *Run now* or when the clock is advanced; its todo list compares against `ctx.now` |
| **External event** | an EVENT no COMMAND in this context produces (no INBOUND COMMAND dependency in scope), or whose original is in another context | `Domain.externalEvents[]` with its fields and examples — the *simulate* panel records it |

Translation automations (external event → todo list → internal command) are ordinary internal automations once the external event is simulated — that is how "running the automations as much as possible" covers the outside world.

---

## Step 4 — Write `domain.js`

Follow `assets/domain.example.js` exactly — same wrapper, same keys. Names are the board's titles with spaces removed (`Register Customer` → `RegisterCustomer`); field names are the board's, verbatim.

**Commands** — `decide(history, cmd, ctx)` returns the events the board connects this command to (OUTBOUND EVENTs), or `reject('<message>')`.
- Event data: each event field from the command field of the same name, or its `mapping`; a `generated` field is created here — ids with `ctx.uuid()`, timestamps with `ctx.now.toISOString()`; values the command doesn't carry but the history does (a customer's email looked up by `customerId`) come from the history.
- **Every rule is a scenario.** For each `specifications[]` entry with a `SPEC_ERROR`, add the check that rejects exactly the `given` situation, with the scenario's `description` as the message. Scenarios producing different events from different histories are branches of `decide`. A command without rejection scenarios never rejects — not even for empty input.
- `history` is the whole log. Filter it to what the rule is about (events with the same `idAttribute` value), as the scenario's `given` reads.

**Read models** — `initial`, `evolve(state, event)` for each INBOUND event, optional `query(state, params)`.
- Output fields are the read model's fields, verbatim. `cardinality: "List"` / `listElement` / a list-shaped scenario → an array of rows (`list: true`); otherwise one object, or `null` before its first event.
- How an event changes the state comes from the read model's scenarios first, then field names and `description`. `params` scopes a query to what the screen selected (a `customerId` from the previous screen).
- A todo list keeps the items still to be done: added by the triggering event, removed by the event its automation's command records.

**Automations** — `readModel` (its todo list), `trigger`, `todo(result, ctx)` (the items to act on now — for scheduled ones, the items that are due at `ctx.now`), `process(item, ctx)` → `{ effect?, command: { type, data } }`.

**External events** — `{ type, from, fields: [{ name, type, example }] }`; `from` is the original's context or the swimlane it comes from.

**Specs — every scenario and every storyline**, one entry per scenario:

| Scenario | Spec entry |
|---|---|
| `when` is a COMMAND, `then` events | `kind: 'command'`, `given` = the given events' examples, `when` = command examples, `then` = expected events |
| `then` is `SPEC_ERROR` | `kind: 'command'`, `error: '<description>'`, no `then` |
| `then` is a READMODEL | `kind: 'readmodel'`, `readModel`, `given`, `expect` = the read model step's examples (`[]` when `expectEmptyList`) |
| a todo list feeding an automation, with events given and the automation's command expected | `kind: 'automation'`, `automation`, `given`, `expectCommands` |
| storyline | walk the beats in order, accumulating EVENT beats as `given`; each COMMAND beat followed by its events becomes a `command` spec, each READMODEL beat with examples a `readmodel` spec |

Example values become typed data (`Int`/`Double` → numbers, `Boolean` → booleans, list fields → arrays of objects from `subfields`). Leave out of `then`/`expect` every value the domain generates (ids and timestamps not given by the scenario) — the runner only compares what an entry names.

Run the specs now, before any UI:

```bash
cp <skill-dir>/assets/runtime.js <out>/runtime.js
# Pins <out> to CommonJS: under a "type": "module" package.json further up, node would load
# runtime.js as an ES module, run no specs and still exit 0.
echo '{ "type": "commonjs" }' > <out>/package.json
node <out>/runtime.js <out>/domain.js
```

The run must end with `N/N specs pass` — no such line means no spec ran, whatever the exit code. Every spec must pass. A failing spec means the domain is wrong — fix `domain.js`, never the spec. If two scenarios contradict each other so that no decider can satisfy both, keep the one that matches the rest of the model, drop the other from `specs`, and report the contradiction.

---

## Step 5 — Rebuild the screens in `index.html`

Copy `assets/index.template.html` to `<out>/index.html`, set `<title>` to the context name, replace the `@@CSS_FRAMEWORK@@` comment with the one stylesheet the screens use (if they mix frameworks, the most common one, and report it), and replace `const SCREENS = [];` in the `@@SCREENS@@` region with the screen components and the registry. Touch nothing else in the template — the chrome and the hooks are shared by every prototype.

**One component per distinct screen title.** A title is a page: several slices that show the same screen with different marks are one component, each marked part wired to its own slice. Registry entries `{ id, title, actor, slices, component }`, in timeline order; `actor` is the screen's lane.

**HTML screens — 1:1.** Translate every page of `meta.pages` into JSX without redesigning it: `class` → `className`, `for` → `htmlFor`, `style` strings → objects, void elements closed, comments removed. Same headings, same labels, same buttons in the same places. A screen with several pages is a step-through: local `page` state, the buttons that advance (`Next`, `Continue`) move to the next page, the last page's button issues the command.

**Sketch screens — redrawn.** A sketch becomes a 1000×800 relative container scaled to fit, each element absolutely positioned at `gridX*20`/`gridY*20` (`gridWidth*20` × `gridHeight*20`): `rectangle` → `div` with fill/border, `headline`/`text` → text at its `fontSize`, `button` → a real `<button>`, `input` → a real `<input placeholder>`, `image` → a filled box, `line`/`circle` → an inline SVG overlay. Colors map to the sketch palette names as CSS colors. Then wire it like an HTML screen.

**Wiring** — only through the template's hooks:

| On the screen | Wired to |
|---|---|
| an input | the command field it captures — matched by the screen's `meta.fields` name, else by label ↔ field name; controlled `useState` initialised empty (the example values belong in `placeholder`) |
| the button named like the command (or the only primary button on a screen with one OUTBOUND command) | `const register = useCommand('RegisterCustomer')`; `onClick` → `register.run(formData)`; on success navigate to the next screen in the flow (the next screen in timeline order for this actor); show `register.error` next to the button |
| displayed data (a value, a table, a list) | `useReadModel('<ReadModel>', params)` — the read model whose title the field's `mapping` names, or the screen's INBOUND READMODEL. The mockup's example values are replaced by the read model's; repeated example rows become one row template mapped over the result; an empty result shows an empty state, never the mockup's sample rows |
| a button inside a list row (Open, Edit, Confirm) | navigates with the row's id fields as `params` (`go('<screen id>', { orderId })`), or issues that row's command with them |
| a button the model gives no meaning to | kept as designed; `onClick={() => notModeled('<label>')}` (`const notModeled = useNotModeled()`) — and listed in the report |

Generated command fields (ids) are not inputs: the decider creates them. Values a screen got from the previous one come from `useNav().params`.

**Syntax check** the screens before you hand it over — Babel only complains in the browser:

```bash
sed -n '/<script type="text\/babel"/,/<\/script>/p' <out>/index.html | sed '1d;$d' > <scratchpad>/app.jsx
npx --yes esbuild@0.24.0 <scratchpad>/app.jsx --loader:.jsx=jsx --log-level=error > /dev/null
```

If a browser automation MCP (Playwright, Puppeteer, Chrome DevTools) is connected, also open `file://<out>/index.html`, click through the first screen's main command, and confirm the event appears in the log and the console has no errors.

---

## Step 6 — Report

Tell the person, in a few lines:
- the path and how to run it — open `<out>/index.html` in a browser (it loads React and the CSS framework from a CDN, so it needs internet once); events persist in the browser per context, *Reset* in the event log clears them.
- what is in it: screens (HTML / redrawn sketches), commands, read models, automations by kind (internal / outside world / scheduled), external events to simulate, and `N/N specs pass`.
- the gaps found while building, each one line with the element: buttons not modeled, commands no screen or automation issues, read models nothing displays or that have no source events, screen fields with no read model, contradictory scenarios, a mixed CSS framework. These are findings about the model — offer `/wdyt` or the matching modeling skill to close them; don't fix the board from here.

In a chat turn this report is the reply (`post_chat_message`, `replyTo` = this turn's `message_id`); the prototype itself stays on disk.

Re-running the skill on the same context regenerates `domain.js` and `index.html` from the board and recopies `runtime.js` — the board is the source, so never hand-edit a generated prototype and expect the change to survive.
