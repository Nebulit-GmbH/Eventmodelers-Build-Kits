---
name: start-vibe-session
description: Start a vibe-coding session — check the setup, bring model and code in step before any work, then work model first. Run it yourself at the first request of every session in a folder with a .vibe/ directory (the CLAUDE.md rule says so), and for "start vibe session", "start vibe coding", "sync the code with the model before we begin".
---

# Start a vibe session

Vibe coding here means: the code is changed by hand or with Claude Code, and the event model on the board is kept in step — changes are detected as drift and translated into it. This skill gets a session to a clean start. It decides nothing about modeling — `vibe-control` and `vibe-translate` do the per-change work, and `analyze-code-base` (run by the person, an interview) analyses a module.

## 1. Is it set up?

- `.vibe/` is found from here (`{{CLI}} vibe baseline show` works). If not: tell the person to run `eventmodelers init --vibe-coding` and stop.
- Run `connect` (credentials, `BOARD_ID`) if not connected. Prefer the `mcp__eventmodelers__*` tools; say so if they are not available.
- `{{CLI}} vibe baseline show` lists the analysed chapters. **None at depth ≥ 1**: nothing is governed yet. Tell the person to run `/analyze-code-base` for the module they want to start with — only analysed modules are governed — and ask whether to carry on without the model meanwhile.

## 2. Bring model and code in step — before any work

```bash
{{CLI}} vibe check --json        # every changed file in the working tree
```

- `drifted` — code changed in a governed chapter since its last analysis (a hand edit, a commit made outside this flow). Ask once, naming the chapter and the files: *translate it onto the model now?* Yes → `vibe-translate` for that chapter. No → leave it; it stays drifted and is asked about again when the chapter is touched. If the person would rather re-analyse the chapter fully, that is `/analyze-code-base` (theirs to run).
- `uncovered` — in no analysed chapter. Do not ask about each file: one question per entry in `questions` (analyse first / continue without / never ask for this folder), recorded with `{{CLI}} vibe answer`. A clean working tree has nothing to ask.
- `free`, `governed` — nothing to do.

## 3. Report, then work model first

One short message: the governed chapters, what was translated, what is still open. Then, for the rest of the session, every change goes through `vibe-control` around the code: find the target code, `vibe check` it before touching it, ask when it is not `governed`, model the change first, then change the code to match (`vibe-translate` is only the catch-up for drifted code).

Nothing is ever written into the source code, and the board's `Legacy Sources` notes are views of `.vibe/baseline/` — never edit or read them for state.
