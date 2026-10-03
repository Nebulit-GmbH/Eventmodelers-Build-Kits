---
name: detect-architecture-drift
description: Compare the event model on the board with the code in this repository and report where they have drifted apart — fields on commands/events/read models, specifications vs tests, screens, edges, slices missing in code, and slices in code that the model doesn't have. Read-only; every finding comes with a suggested fix the user confirms first.
---

# Detect Architecture Drift

## Step 0 — Is there a code base?

Drift is the gap between the board and the code, so it can only be detected where code exists. **Before anything else — before `connect`, before reading the board — resolve the directory to check**: `$EVENTMODELERS_CODE_DIR` if it is set (the agent runs from the global install and was started inside that directory — treat it as the repository root for every step below, not the current directory), otherwise the current directory. Check that it is a code base: it contains source code (e.g. `src/`, `.build-kit/`, a `package.json`, `pom.xml`, `*.csproj`, `build.gradle`, or similar project files with slice/command/event/projection code).

If it is not (an empty folder, a modeling-only workspace holding just `.claude/`, `.eventmodelers/` or `.agent-modeling-kit/`), **stop and answer in one or two plain sentences**, e.g.:

> Architecture drift can't be detected here — there is no code to compare the board against. Run this in the code base that implements the model.

Do not connect, do not read the board, do not produce a report or snippet, and do not offer other fixes.

---

> **Once Step 0 passes**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available. See `learn-eventmodelers-api` for the curl fallback.

The board is the intended design, the code is what was built. Over time the two part ways: someone edits a handler without touching the model, someone renames a field on the board after the slice was built. This skill finds those places and proposes how to close each gap. **It never changes the board or the code** — it reports, and only acts on what the person confirms.

---

## Step 1 — Parse arguments and resolve scope

From `$ARGUMENTS` and the prompt context, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `timelineId` | `context.timelineId` of the prompt (overrules the prompt's own `timeline_id`), or a timeline/chapter named in the text | whole board |
| `contextName` | a bounded context named in the text | all contexts |
| `sliceTitle` | a single slice named in the text | all slices in scope |

**If a timeline is in focus, only that timeline's slices are compared** — both on the board side and, through the slice → code mapping of Step 3, on the code side. Code that belongs to no slice in scope is not reported as "additional" in a scoped run; say so in the report footer instead of guessing.

---

## Step 2 — Read the model (once)

Cheapest read first, once per run:

```
mcp__eventmodelers__list_slices   { "boardId": "$BOARD_ID" }
mcp__eventmodelers__get_slice_data { "boardId": "$BOARD_ID", "contextName": "<CONTEXT>", "format": "toon" }
```

Use the **full** slice data (no `projection`): you need fields with types and `idAttribute`, dependencies (the edges), specifications, storylines and screens together. If the scope is a timeline, pass its title as `contextName` and keep only slices whose `chapter` is that timeline.

Call `validate_model { boardId, chapterId }` for a scoped timeline — it already lists structural gaps on the board side (zero/multi-issuer commands, sourceless read models, missing scenarios). Those are model problems, not drift: mention them in one line, don't duplicate them as findings.

Index the result in memory: per slice → commands, events, read models, screens, automations, specifications, dependencies.

---

## Step 3 — Understand the code

The code base is the directory resolved in Step 0 (`$EVENTMODELERS_CODE_DIR`, else the current directory) — every path below is relative to it, and it may hold any stack. Find out which, don't assume.

1. Read `.build-kit/CLAUDE.md` (and `.build-kit/AGENTS.md` if present) — its *Structure* section says where slices live and how they're named (e.g. `src/slices/{slice}/` for Node, `src/main/java/.../slices/{context}/{slice}/` for Axon).
2. If `.build-kit/.slices/<context>/<slice>/slice.json` exists, it is the snapshot the code was **last built from** — useful for telling "the code changed" apart from "the model changed since the build" (see Step 5).
3. Without a build kit, infer the layout from the repo (folders named after slices, `*Command*`, `*Event*`, projection/read-model files, route/UI files). If you cannot find any slice structure, stop and tell the user what you looked at — do not fabricate a mapping.

Build a **code inventory** per slice folder: the command type and its fields, the events it emits and their fields, read-model/projection types and fields, the screens/components/routes wired to it, tests and what they assert, and what each handler/projection/automation reads and writes.

Map slice → code folder by name (ignore case, spaces and the `slice:` prefix, same slug rule as `load-slice`). A slice with no matching folder, or a folder with no matching slice, is itself a finding (5a/5b).

Read only the slice folders in scope. Shared event/type folders are read only for the events the in-scope slices reference.

---

## Step 4 — Compare

Work slice by slice. Every finding records: **kind**, **slice**, **element** (board `nodeId` where there is one), **what the model says**, **what the code says**.

| Kind | Look for |
|------|----------|
| **Slice missing in code** | Slice on the board in status `Planned`/`InProgress`/`Done`… with no code folder. Status `Created`/`Planned` is expected not to have code yet — report only slices the board calls `Done`/`Review`. |
| **Slice only in code** | Code folder shaped like a slice (command handler, projection, automation) with no slice on the board. |
| **Fields** | On every COMMAND, EVENT and READMODEL: a field only in the model, a field only in the code, a name that differs (case or typo), a type that differs, `idAttribute` vs `@TargetEntityId`/event tag/aggregate key mismatch, optional vs required. |
| **Specifications** | A model GWT scenario with no test asserting it; a test (given/when/then) with no matching model scenario; a scenario whose events/fields no longer match the code. Storylines are narrative — compare their beats only for elements that no longer exist. |
| **Screens** | A SCREEN on the board with no UI counterpart; a UI screen/route/component wired to a slice's command or read model that the board doesn't show; a screen whose displayed read-model fields or submitted command fields differ from the model's dependencies. |
| **Edges** | Model dependency with no code counterpart, and the reverse: command → event (handler emits it), event → read model (projection consumes it), read model → screen, event → automation → command. A handler that emits an event the model doesn't connect, or a projection subscribing to events the model doesn't wire in. |
| **Elements** | An event/command/read model present on one side only, or a rename (same fields, different name). |

Rules for judging, in order:

- **Obvious typos and clearly wrong flags are one finding with a direct fix** (`custoemrId` in the code vs `customerId` on the board; `idAttribute: false` on the entity's own id) — name the correct side, don't ask which it is.
- **Direction matters.** A mismatch with no earlier evidence has no "right" side: propose the fix in the direction the evidence points (see Step 5), and say when it is a judgement call.
- Don't report framework noise: generated ids, metadata/envelope fields, serialization annotations, test fixtures' helper types, routes when the slice has no screen.
- Don't flag what is clearly intentional (an internal slice with no screen; a read model used only by another read model).
- Report each underlying difference **once**, at the element where it starts; a renamed field shows up on the command and the event and the read model — that is one finding listing the chain, not three.

---

## Step 5 — Decide the direction, propose the fix

For every finding, pick who should move:

| Evidence | Fix goes to | How it's done |
|----------|-------------|---------------|
| Code differs from `.build-kit/.slices` snapshot, board still equals the snapshot | **Model** — the code moved on deliberately | Skill that changes the board: `/attributes` (fields), `/timeline` / `/place-element` (elements), `/eventmodeling-elaborating-scenarios` (specs), `/storyboard-screen` or `/html-screen` (screens) |
| Board differs from the snapshot, code still equals it | **Code** — the model moved on | Set the slice back to `Planned` with `/update-slice-status` so the build kit picks it up again and diffs code against `slice.json` |
| Both moved, or no snapshot | **Judgement call** — present both options, recommend one | Recommend by which side is more specific/complete |
| Slice only in code | **Model** | Add the slice, via `/eventmodeling-slicing-event-models` after placing its elements |
| Slice missing in code, board says `Done` | **Model status** (it isn't done) | `/update-slice-status` → `Planned` |

Never propose "fix the code" by editing it from this skill — code changes belong to the build kit (`/update-slice-status` → `Planned`).

---

## Step 6 — Show the findings; act only on confirmation

Nothing is modified until the person answers.

### In a chat (`CHAT_SESSION_ID` is set)

Post **one** `post_chat_message` with a `tasks` snippet — the list of findings *and* the question which fixes to apply (same mechanics as `/wdyt` Step 4.0):

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "sessionId": "<CHAT_SESSION_ID>",
  "text": "Found 6 places where the model and the code differ in Registration. Tick the fixes to apply.",
  "snippet": {
    "kind": "tasks",
    "headline": "Apply these fixes?",
    "submitLabel": "Apply",
    "tasks": [
      { "id": "d:model:<nodeId>:field:customerId", "title": "Rename field “custoemrId” to “customerId” on Register Customer", "description": "Code has customerId — model has a typo", "nodeId": "<nodeId>" },
      { "id": "d:code:<sliceId>", "title": "Rebuild “Cancel Order” — the board added the field “reason” after it was built", "description": "Sets the slice back to Planned", "nodeId": "<sliceId>" }
    ]
  }
}
```

- `title` is the proposed fix, one sentence, plain language. `description` says what differs (model vs code). `nodeId` is the element or slice border to jump to.
- `id` is `d:<model|code|decide>:<nodeId>:<kind>[:<detail>]` — the answering turn remembers nothing, so it must carry the direction and target. Put **every** finding in the one snippet (it pages itself at 5).
- Zero findings: a one-line text reply, no snippet. Then **end the turn.**

The answer comes as a `CHAT` turn (`Please do these:` + ticked titles or ids). Read the snippet back with `get_chat_session`, match what was ticked, and create **one prompt** per direction: model fixes → *"Apply these model-drift fixes: `<id> | <title>` per line"*; code fixes → set each slice to `Planned`. Unticked fixes are declined — drop them.

### Without a chat

Print the report below, with every finding as a `- [ ]` checkbox carrying its proposed fix, and ask which to apply. Wait for the answer.

Name each slice and element as `[<title>](ref:<nodeId>)` (the slice border's id for a slice). The terminal shows the title, and once the report is in a board note or an element description, a click zooms the canvas to it (see `/learn-eventmodelers-api` *Linking to elements in markdown*). A slice that exists only in code has no node, so it stays plain text.

```
## Architecture Drift — <scope: board | timeline "<title>" | context "<name>">
Compared: <n> slices on the board, <n> slice folders in code    Analysed: <ISO timestamp>

### Slices
- [ ] <slice> — in code, not on the board → add it to the model
- [ ] [<slice>](ref:<sliceBorderId>) — board says Done, no code → set back to Planned

### Fields
- [ ] [<slice>](ref:<sliceBorderId>) / [<element>](ref:<nodeId>): model `customerId: String`, code `custoemrId` → fix model typo

### Specifications / Screens / Edges
- [ ] ...

### Summary
<2–3 sentences: how far apart they are, which direction the drift mostly runs, the one fix worth doing first.>
Not checked: <what was out of scope or unreadable>
```

Omit empty sections. Say plainly when nothing drifted.

---

## Learnings

- No code base in the working directory → drift can't be detected; say so in one line and stop (Step 0).
- Read-only until confirmed — the report is the product; the fixes run as separate, ticked work.
- A scoped run (timeline in focus) never reports "slice only in code" for code outside the scope.
- One difference, one finding: follow a rename along the chain instead of listing it per element.
