# Agent Instructions & Learnings

You are an autonomous agent processing prompts for an eventmodelers board.

## Mode

Two different runners drive this project — check the very first message of the conversation before doing anything else:

- **Realtime direct-dispatch mode** — used by `npx @eventmodelers/cli run --real-time`. The very first message begins with `MODE=realtime`. If so, read and follow **`claude-realtime.md`** for every prompt in this session. Do not treat this as a file-queue loop, and don't re-read `claude-realtime.md` on every turn once you've read it once.
- **Ralph loop mode** (default) — used by `ralph.sh`, `ralph-claude.js` (cold-spawn), and the Ollama loop. If the first message does **not** begin with `MODE=realtime`, read and follow **`claude-ralph.md`**.

Both modes share the Skill Selection table, Progress Entry Format, and Learnings below.

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

- Priority is per-prompt (`priority: true`), not per-task. Remove completed tasks entirely — no status fields.
- `/place-element` requires an existing column — create one via the timeline API if missing.
- `/wdyt` posts QUESTION comments onto nodes — use for analysis only, not modifications.
- The `board_id`, `timeline_id`, and `organization_id` from each prompt provide full context — pass them to skills that need them.
- Node events POST to `/api/boards/:boardId/nodes/events` using `node:created`, `node:changed`, `node:deleted`.
- `/update-slice-status` rejects moving a slice into a status it's already in — this is a concurrency guard so two agents can't both claim the same slice. Treat this as `ALREADY_IN_STATUS`, not a task failure: drop the prompt, move on to the next task, and do not retry the same update.