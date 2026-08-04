# Agent Instructions & Learnings

You are an autonomous agent processing prompts for an eventmodelers board.

## Mode

This project runs in one mode only — a warm, direct-dispatch session driven by
`npx @eventmodelers/cli run --modeling`. The first message begins with `MODE=modeling`;
read and follow **`claude-modeling.md`** for every prompt in this session, and don't
re-read it on every turn once you've read it once. There is no file-queue loop and no
`tasks.json` for a modeling-kit install — that's a build-kit concept, for their
independent, self-contained slice-implementation tasks.

`claude-modeling.md` shares the Skill Selection table, Progress Entry Format, and Learnings below.

## Skill Selection

| Intent | Skill |
|--------|-------|
| Add, rename, or reorder events on a timeline | `/timeline` |
| Place a COMMAND, READMODEL, or EVENT at a position | `/place-element` |
| Generate a full storyboard with multiple screens | `/storyboard` |
| Design or update a single wireframe screen | `/storyboard-screen` |
| Design or update a single real HTML/CSS screen (explicit request only) | `/html-screen` |
| Business analysis, gap spotting, posting questions | `/wdyt` |
| Analyse the existing model structure, slice coverage, element counts | `/analyze-existing-model` |
| Look up any API endpoint or element type | `/learn-eventmodelers-api` |
| Add or rename an attribute across a chain of elements | `/attributes` |
| Add or improve example data on element fields | `/examples` |
| Update the status of a slice (e.g. done, in-progress) | `/update-slice-status` |

Read `.claude/skills/<skill-name>/SKILL.md` before executing — each skill has required inputs and step-by-step instructions.

## Progress Entry Format

APPEND to `progress.txt` (never replace):
```
## [ISO timestamp] — [task/prompt identifier]
Prompts processed: [prompt text(s)]
Outcome: [what changed on the board]
---
```

---

## Learnings

- `/place-element` requires an existing column — create one via the timeline API if missing.
- `/wdyt` posts QUESTION comments onto nodes — use for analysis only, not modifications.
- The `board_id`, `timeline_id`, and `organization_id` from each prompt provide full context — pass them to skills that need them.
- Node events POST to `/api/boards/:boardId/nodes/events` using `node:created`, `node:changed`, `node:deleted`.
- `/update-slice-status` rejects moving a slice into a status it's already in — this is a concurrency guard so two agents can't both claim the same slice. Treat this as `ALREADY_IN_STATUS`, not a task failure: drop the prompt, move on to the next task, and do not retry the same update.
- macOS/BSD `date` silently ignores GNU-only format specifiers like `%N`/`%3N` (sub-second precision) instead of erroring — it prints the literal characters, producing a malformed timestamp that only fails downstream. Don't shell out to `date` for sub-second precision; use `$(( $(date +%s) * 1000 ))` for whole-second-in-ms, or a runtime call (`Date.now()`, `process.hrtime()`) instead.
- Before retrying a failed shell command a second time, diagnose why it failed (e.g. a GNU/BSD flag mismatch) rather than re-running it unchanged — repeating the same command produces the same failure and just burns retries.