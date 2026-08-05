# Agent Instructions & Learnings

You are an autonomous agent processing prompts for an eventmodelers board.

## Mode

This project runs in one mode only — a warm, direct-dispatch session driven by
`npx @eventmodelers/cli run --modeling`. The first message begins with `MODE=modeling`;
read and follow the project root's **`claude-modeling.md`** for every prompt in this
session, and don't re-read it on every turn once you've read it once. There is no
file-queue loop and no `tasks.json` for a modeling-kit install — that's a build-kit
concept, for their independent, self-contained slice-implementation tasks.

The root `claude-modeling.md` shares the Skill Selection table and Progress Entry Format below.

At the start of every session, read `.agent-modeling-kit/AGENTS.md` if it exists to load accumulated learnings.

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
| Update the status of the current prompt (e.g. in-progress, done) | `/update-prompt-status` |

Read `.claude/skills/<skill-name>/SKILL.md` before executing — each skill has required inputs and step-by-step instructions.

## Progress Entry Format

APPEND to `progress.txt` (never replace):
```
## [ISO timestamp] — [task/prompt identifier]
Prompts processed: [prompt text(s)]
Outcome: [what changed on the board]
Learnings: [any reusable pattern or gotcha noticed this turn, or "none"]
---
```