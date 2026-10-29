---
name: vibe-translate
description: Translate a code change inside an analysed chapter onto the event model on the board, without an interview, then move the chapter's baseline. Use after a vibe-coded change in a governed chapter, or to catch up on drift — "sync the code change to the model", "translate this change", "update the model from the code".
---

# Vibe translate — a code diff, onto the board

`analyze-code-base` builds a model from code through an interview. This skill does the small, unattended version for **one governed chapter and only what changed**. It owns nothing of the modeling rules — read and follow, don't restate:

- `analyze-code-base` — *Reading the sources — four lenses* and *From code to elements — the mapping rules* (a persistence write is an event, an inbound call a person triggers is a screen + command, …) and *Recording decisions*.
- `eventmodeling-core-rules` (once per session), then the skill each change belongs to: `eventmodeling-identifying-inputs` / `-identifying-outputs`, `-designing-automation-chains`, `-translating-external-events`, `-elaborating-scenarios`. Placement and edits: `place-element`, `timeline`, `attributes`, `examples`; the board's MCP tools first (`connect`, `learn-eventmodelers-api`).

## Steps

1. **What changed.** `{{CLI}} vibe baseline show "<chapter>" --drift` lists the chapter's files that are not what its last analysis row says. Read the diff of exactly those files (`git diff <commit> -- <file>` for the commit in the last row; a new file is read whole). Nothing else.
2. **Map each change** through the four lenses and the mapping table to what it does to the model: a new field on an event/command/read model, a renamed one, a new element, a new rule for a scenario, a removed one. A pure refactoring with no business effect changes nothing — say so and skip to step 5.
3. **Write it to the board**, carried through every connected element in the same pass (a field added to a command goes through its event and read models — `attributes`). Obvious typos and wrong flags are fixed directly, not asked. **Never invent to fill a gap, and never interview**: if a change is ambiguous in a way the model cannot settle, in an interactive run ask the person; in an unattended run post a QUESTION comment on the most relevant node (`handle-comment`) and continue with the most defensible reading, saying so. A new chapter-wide decision or a code-vs-business term goes into the baseline's `decisions` (step 4), with its `path:line` source.
4. **Record the pass.** New or moved folders, key classes, decisions: `{{CLI}} vibe baseline write --chapter "<title>" --pass "sync" --scope "<files>" --result "<what changed>" --json '{…only the fields that changed…}'`; when nothing but the code moved: `{{CLI}} vibe baseline advance --chapter "<title>" --result "<what was translated>"`. Either appends the history row at the current commit and file hashes.
5. **Render the note.** The board's `Legacy Sources — <Chapter>` note (column 0, Decisions lane of the chapter) is a view of the baseline file: `{{CLI}} vibe baseline render --chapter "<title>"` prints its markdown — put it into the node's `meta.description` with a `node:changed`. The file drives the note, never the reverse.
6. **Check.** `{{CLI}} vibe check <the files> --json` must now say `governed`.

The code is already written, so **no slice goes to `planned`** and nothing is rebuilt — the model is updated to describe the code, and slice statuses stay as they are.
