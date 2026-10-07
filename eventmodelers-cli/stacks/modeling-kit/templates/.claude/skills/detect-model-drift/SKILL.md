---
name: detect-model-drift
description: Find where the code has moved away from the event model since the last analysis — reads the baseline commit from each chapter's first-column note (Analysis history), takes every commit since then as the changes made, and reports how the changed code now differs from the board (fields, specifications/tests, screens, edges, elements, slices). Changes on the board are out of scope — the model leads, the code follows. `--branch <name>` checks that branch's history instead of the current one. Read-only; every finding comes with a suggested fix the user confirms first.
---

# Detect Model Drift

**Drift is a change in the code that the model doesn't reflect.** People model first and then have an agent build it, so a difference that comes from the board (a field renamed on the board, a new slice not built yet) is planned work, not drift, and this skill ignores it. What it looks for is the other direction: someone changed the code by hand (a manual commit, a hotfix, a refactoring) and the board no longer describes what the code does.

So the skill looks at **the code changes since the last analysis**, nothing else:

1. the baseline is the commit of the last row in the chapter note's *Analysis history* (first column of the chapter),
2. every commit since then (plus uncommitted changes) is a change that was made,
3. for each change, compare what the code now does with what the board says. The differences are the drift.

## Step 0 — Is there a code base with history?

**Before anything else — before `connect`, before reading the board — resolve the directory to check**: `$EVENTMODELERS_CODE_DIR` if it is set (the agent runs from the global install and was started inside that directory — treat it as the repository root for every step below, not the current directory), otherwise the current directory.

- It must contain source code (e.g. `src/`, `.build-kit/`, a `package.json`, `pom.xml`, `build.gradle`, `*.csproj`, or similar). If it does not (an empty folder, a modeling-only workspace holding just `.claude/`, `.eventmodelers/` or `.agent-modeling-kit/`), **stop and answer in one or two plain sentences**, e.g.:
  > Model drift can't be detected here — there is no code to compare the board against. Run this in the code base that implements the model.
- It must be a git repository (`git rev-parse --is-inside-work-tree`). If it is not, stop the same way: *"Drift is detected from the git history since the last analysis, and this code base has no git history. Run `/analyze-code-base` for a full analysis instead."*

Do not connect, do not read the board, and do not produce a report when either check fails.

**With `--branch <name>`** (see Step 1), check that the branch exists: `git rev-parse --verify <name>`, else `git fetch origin <name>` and `git rev-parse --verify origin/<name>`. Use whichever resolves as `REF`. If neither does, stop in one sentence (*"There is no branch `<name>` in this repository."*). Without `--branch`, `REF` is `HEAD`, and uncommitted changes in the working tree count too.

---

> **Once Step 0 passes**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available. See `learn-eventmodelers-api` for the curl fallback.

**This skill never changes the code**, and it changes the board only for what the person confirms — plus the one *Analysis history* row of Step 7.

---

## Step 1 — Parse arguments and resolve scope

From `$ARGUMENTS` and the prompt context, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `timelineId` | `context.timelineId` of the prompt (overrules the prompt's own `timeline_id`), or a timeline/chapter named in the text | every chapter on the board |
| `contextName` | a bounded context named in the text | all contexts |
| `sliceTitle` | a single slice named in the text | all slices in scope |
| `branch` | `--branch <name>` in `$ARGUMENTS`, or a branch named in the text | the current branch (`HEAD` + working tree) |
| `since` | `--since <commit>` in `$ARGUMENTS`, or a commit named in the text | the baseline of Step 2 |

---

## Step 2 — Find the baseline (per chapter)

Every chapter carries its own baseline. For each chapter in scope:

1. `get_board_outline { boardId, chapterId }` and take the **first column's** MARKDOWN node in a `feedback` lane — the chapter note (`Legacy Sources — <Chapter>` when `/analyze-code-base` wrote it). Read it with `get_node` → `meta.description`.
2. Find its `## Analysis history` table and take the **Commit** of the **last row**. Strip a `+dirty` suffix (and note it: the files dirty back then are changed files too). Save it as `BASE`.
3. Check it: `git cat-file -e <BASE>^{commit}` and `git merge-base --is-ancestor <BASE> <REF>` — the baseline must be in this branch's history.

The rest of the note is context for judging findings too — *Where this flow lives* says which folders belong to the chapter, *Chapter decisions* and *Not modeled* say what is deliberately different or left out.

**No usable baseline** — no first-column note, no *Analysis history*, `no git`, or a hash that is unreachable or not an ancestor (rebased/squashed history): **don't fall back to comparing the whole board against the whole code.** Ask once which commit to start from, offering the most likely one: the newest commit recorded anywhere on the board for that chapter (an `Implementation — <Slice>` evidence note's **Commit**, a column note), or else the last few entries of `git log --oneline -10 <REF>`. A `since` argument answers this up front and overrules the note's baseline.

Chapters with the same baseline share one git read in Step 3.

---

## Step 3 — Collect the changes since the baseline

For each distinct `BASE`, list the commits and walk them **one by one, oldest first** — never judge from the net diff `<BASE>..<REF>` alone:

```bash
git log --reverse --format='%h %ad %an %s' --date=short <BASE>..<REF>   # the commits, oldest first
git show --name-status --format= <sha>                                  # the files one commit touched
git show <sha> -- <file>                                                # that commit's change to one file
git diff <sha>..<REF> -- <file>                                         # what happened to a file after a given commit
git status --porcelain && git diff HEAD                                 # without --branch: uncommitted changes too
```

Why per commit: when the range contains the commit that **created** a file (e.g. the build kit's `feat: <Slice>`), the net diff shows the file only as "added" with its final content, and a later hand edit (a renamed field, a removed check) disappears inside it — attributed to the build. Walking the commits keeps them apart. Never `git checkout`/`git switch` — read other refs with `git show <REF>:<path>`; the working tree may hold someone's uncommitted work.

**Sort per file, not per commit.** One commit can mix kit or tooling files with real code (e.g. a commit that installs a kit *and* renames a field) — the noise files of that commit are dropped, its code files still count:

| Group | Examples | Handling |
|-------|----------|----------|
| **Behavior** | controllers/handlers, services, entities/aggregates, events, projections/queries, schema & migrations, validation, templates/UI, tests | compared in Step 5 |
| **Noise** | dependency bumps, build/CI config, gradle/maven wrappers, formatting-only diffs, docs, `.build-kit/`, `.claude/`, `.agent-modeling-kit/`, `.eventmodelers/`, `.mcp.json`, `CLAUDE.md`, `progress.txt`, generated files | listed in the report footer as *not relevant*, never a finding |

**Build-kit commits vs. hand-made commits.** A commit is the build kit's only if an `Implementation — <Slice>` evidence note names its sha, or — without evidence notes — its subject is `feat: <Slice Name>` for a slice on the board. It implemented the board, so its files are the **as-built state**: compare it cheaply against that slice only. Every other commit — including any commit after it that touches the same files — is a **hand-made change** and the main subject of this skill: for each file the build kit wrote, the drift candidates are `git diff <buildSha>..<REF> -- <file>`, attributed to the later commits.

No behavior changes since the baseline → report *"No code changes since `<BASE>` (<date of that row>) that affect the model"*, do Step 7, and stop.

---

## Step 4 — Map the changes to the board

For every behavior change, find the slice(s) and element(s) it belongs to. Use, in this order:

1. **`Implementation — <Slice>` evidence notes** (build kit, `Implementation` feedback lane, one per slice column): their *Element → Code*, *Fields*, *Specifications → Tests* and *Files* tables map code back to `ref:<nodeId>`s directly.
2. **`.build-kit/ARCHITECTURE.md` → Slice map**, if present: entry point, persistence, read/query, tests and shared seams per slice.
3. **The chapter note's** *Where this flow lives*, and the column decision notes' `Source` references (paths with line numbers).
4. Names: a command/event/read model/field whose name (or code name) appears in the changed code.

Then read the model **only for the slices you hit**: `get_slice_data { boardId, contextName, sliceId?, format: "toon" }` (full data: fields with types and `idAttribute`, dependencies, specifications, screens), and `get_node` for single elements. Don't read the rest of the board.

A change that maps to no slice is itself a candidate finding — new behavior the board doesn't have (Step 5, *Element* / *Slice*). If it falls inside a chapter's *Where this flow lives* folders, it belongs to that chapter; otherwise say which chapter it most likely belongs to, or that it needs a new one.

---

## Step 5 — Compare the changed code with the board

Go change by change. Read the code **as it is at `REF`** (not just the diff hunk) for the elements the change touches, and compare it with what the board says about those elements. Every finding records: **kind**, **commit(s)** (short sha + subject + author), **file(s)** with line, **slice**, **element** (board `nodeId` where there is one), **what the board says**, **what the code now does**.

| Kind | A change in the code that … |
|------|------------------------------|
| **Fields** | adds, removes or renames a field/parameter/column on a command input, a persisted state (event) or a query result; changes its type, nullability/required-ness, or which field identifies the entity (`idAttribute`) |
| **Rules / specifications** | adds, removes or changes a validation, a guard, an error case or a default — or a test (given/when/then) — so that the board's GWT scenarios no longer describe the behavior |
| **Screens** | changes a UI template/component/route so that what it shows (read-model fields) or submits (command fields) differs from the board's SCREEN and its edges |
| **Edges** | makes a handler persist/emit something the board doesn't connect, a query read data the board doesn't wire in, a reaction (listener, job) trigger or issue something new — or removes such a connection |
| **Element** | adds a new command/state change/query/reaction, or removes or renames one the board has |
| **Slice** | adds a whole new feature (entry point + persistence/query) that is no slice on the board, or removes one the board says is `Done` |

Rules for judging:

- **Only changes since the baseline.** Code that was already different from the board at `BASE` is not this run's drift (the last analysis accepted it) — unless a change since then touched it.
- **Ignore everything that changed only on the board.** A board field the code never had, a `Planned` slice with no code, scenarios added after the build — that is planned work for the build kit, not drift. Don't report it, not even as a footnote.
- **A change that brings the code closer to the board is no finding** (e.g. a fix that finally implements a modeled scenario). Mention it in the summary at most.
- Don't flag what the chapter note's *Chapter decisions* / *Not modeled* or a column decision note explain as intended.
- No framework noise: generated ids, metadata/envelope fields, serialization annotations, test helpers, logging, refactorings that keep behavior (rename of a private method, extract class).
- **One difference, one finding**: a field renamed in the controller, the entity, the column and the template is one finding listing the chain, at the element where it starts.

---

## Step 6 — Propose the fix, show the findings, act only on confirmation

**The code change is the newer decision**, so the default fix is to **update the model** to describe what the code does now. The alternative is to treat the code change as a mistake and have the build kit bring the code back to the board.

| Finding | Recommended fix | Alternative |
|---------|-----------------|-------------|
| Field, rule/spec, screen, edge or element changed in code | **Model**: `/attributes` (fields), `/timeline` / `/place-element` (elements, edges), `/eventmodeling-elaborating-scenarios` (rules → GWT), `/html-screen` / `/storyboard-screen` (screens) | **Code**: `/update-slice-status` → `Planned` so the build kit rebuilds it from the board |
| New feature in code, no slice on the board | **Model**: place its elements, then `/eventmodeling-slicing-event-models` | **Code**: remove it — a decision for a human, never done from here |
| Board says `Done`, the code was removed | **Model**: remove the slice, or set it back to `Planned` if it is still wanted | — |

Recommend the alternative instead only when the change is evidently accidental (a typo like `custoemrId`, a debugging leftover, a disabled test) — say why.

**A model fix always includes the existing screens.** When a field, command or read model changes on the board, every SCREEN/HTML_SCREEN that shows or submits it changes with it — list each affected screen in the same finding (follow read model → screen and screen → command edges) and update it in place (`/html-screen` with its `nodeId`, `/storyboard-screen`). Never create a new screen next to an outdated one. **Never edit the code from this skill.**

Nothing is modified until the person answers.

### In a chat (`CHAT_SESSION_ID` is set)

Post **one** `post_chat_message` with a `tasks` snippet — the findings *and* the question which fixes to apply. Name the range in `text`, so the answering turn can read it back for Step 7:

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "sessionId": "<CHAT_SESSION_ID>",
  "text": "Since the last analysis (a1b2c3d → 9c1e2f0, 3 commits) the code changed in 2 places the board doesn't show. Tick the fixes to apply.",
  "snippet": {
    "kind": "tasks",
    "headline": "Apply these fixes?",
    "submitLabel": "Apply",
    "tasks": [
      { "id": "d:model:<nodeId>:field:chipId", "title": "Rename field “microchipNumber” to “chipId” on Register Microchip and Microchip Registered", "description": "9c1e2f0 “chip id” renamed it in Microchip.kt and the controller after the slice was built — the board still says microchipNumber", "nodeId": "<nodeId>" },
      { "id": "d:code:<sliceId>:rule:uniqueness", "title": "Rebuild “Register Microchip” — the uniqueness check was removed in code", "description": "Sets the slice back to Planned", "nodeId": "<sliceId>" }
    ]
  }
}
```

- `title` is the proposed fix, one sentence, plain language. `description` names the commit (sha, subject, author) and what differs.
- `id` is `d:<model|code|decide>:<nodeId>:<kind>[:<detail>]` — the answering turn remembers nothing, so it must carry the direction and target. Put **every** finding in the one snippet (it pages itself at 5).
- Zero findings: a one-line text reply, no snippet, then Step 7.

The answer comes as a `CHAT` turn (`Please do these:` + ticked titles or ids). Read the snippet back with `get_chat_session`, match what was ticked, and create **one prompt** per direction: model fixes → *"Apply these model-drift fixes: `<id> | <title>` per line"*; code fixes → set each slice to `Planned`. Unticked fixes are declined — drop them. Then Step 7.

### Without a chat

Print the report below, every finding as a `- [ ]` checkbox carrying its proposed fix, and ask which to apply. Wait for the answer, act on it, then Step 7.

Name each slice and element as `[<title>](ref:<nodeId>)` (the slice border's id for a slice); code that has no node stays plain text.

```
## Model Drift — <scope: board | timeline "<title>" | context "<name>">
Changes: <BASE> (<date>, last analysis) → <REF short sha><, branch <name>><, + uncommitted> · <n> commits, <n> files with behavior changes    Analysed: <ISO timestamp>

### Fields
- [ ] [<slice>](ref:<sliceBorderId>) / [<element>](ref:<nodeId>): board says `microchipNumber`; `9c1e2f0 chip id` renamed it to `chipId` after the build (`7e3d1a2 feat: Register Microchip`) — `Microchip.kt:27`, `RegisterMicrochipController.kt:41`, both tests → rename the field on the command, the event and the screen

### Rules / Specifications · Screens · Edges · Elements · Slices
- [ ] ...

### Summary
<2–3 sentences: what changed in the code since the last analysis, how much of it the board is missing, the one fix worth doing first.>
Commits: <sha subject — one line each; mark build-kit commits>
Not relevant: <noise commits/files>
```

Omit empty sections. Say plainly when nothing drifted.

---

## Step 7 — Move the baseline forward

Once the person has answered (or there was nothing to report), append **one row** to the *Analysis history* of every chapter in scope (`node:changed` on that note's `meta.description` — never edit or drop earlier rows), so the next run starts from here:

```
| 4 | 2026-10-07 | `9c1e2f0` | drift check since `a1b2c3d` | `Microchip.kt`, `RegisterMicrochipController.kt` | 2 findings: 1 model fix applied, 1 declined |
```

- **Commit** is `REF`'s short sha; add `+dirty` when uncommitted changes were part of the check. With `--branch`, write `<sha> (<branch>)`.
- A declined finding is accepted as intended — that is why the baseline still moves past it; record it in the row so it can be found later.
- A chapter without a chapter note: don't create one here — say in the report that `/analyze-code-base` would add it, and that the next drift check needs `--since` until then.
- If the person never answers, the baseline stays where it was — the same changes come up again next time.

---

## Learnings

- Drift = code changed, board didn't. Board-only changes are planned work for the build kit — never report them.
- The baseline is the last *Analysis history* row of the chapter's first-column note; the changes are `git log/diff <BASE>..<REF>` plus uncommitted work. No baseline → ask for a starting commit, never fall back to a whole-board comparison.
- The code change is the newer decision: recommend updating the model, unless the change is evidently accidental.
- Map changes to the board through the `Implementation — <Slice>` evidence notes and the Slice map first, names last; read only the slices hit.
- Walk the commits one by one and sort per file: a net diff hides a hand edit inside a file the build kit created in the same range, and one commit can mix kit-install noise with real code changes.
- A build-kit commit (evidence note names its sha, else `feat: <Slice>`) is the as-built state; every later change to its files is a hand-made change.
- No git history → no drift detection; say so in one line and stop (Step 0).
- `--branch` reads the code via `git show <REF>:<path>` — never check it out, the working tree may hold someone's uncommitted work.
- Every completed run appends one *Analysis history* row; an unanswered run doesn't move the baseline.
- `.build-kit/.slices` is no evidence of what the code was built from: every fetch, `/load-slice` and runner loop rewrites it.
