# `eventmodelers vibe`

Model first, code second: a requested change goes onto the event model on the board before the code follows, however the request is phrased. Code changed by hand outside that flow is caught as drift and translated onto the model. No build kit needed.

```bash
eventmodelers init --vibe-coding                     # .vibe/, the skills, the CLAUDE.md block — no build kit needed
claude                                               # then /analyze-code-base — you run this yourself, one module (chapter) at a time
                                                     # each session then starts with a drift sweep by itself (/start-vibe-session re-runs it by hand)
eventmodelers vibe check [paths…] [--json]           # is this code covered? governed | drifted | uncovered | free, and the questions to ask
eventmodelers vibe baseline write|advance|render|show   # the per-chapter analysis log (what analyze-code-base and every sync write)
eventmodelers vibe answer --folder <p> --answer analyse|continue|ignore
eventmodelers vibe events                            # the control log
eventmodelers uninstall --vibe-coding                    # same as `vibe remove`: delete .vibe/, the vibe skills and the CLAUDE.md block
```

## Principle

**Scope is per chapter.** Only the folders of chapters analysed at depth ≥ 1 are governed, so a module of a huge code base can be opted in on its own. There is **one** `.vibe/`, in the directory `init` ran in; every command finds it by walking up, so a run inside a deeply nested module uses the same one, and folder paths are relative to its root.

**The file drives the board, never the reverse.** `.vibe/baseline/<chapter>.json` is the analysis log. `analyze-code-base` (when `.vibe/` exists) appends its history row there and renders the board's `Legacy Sources — <Chapter>` note from it (`vibe baseline render`); nothing parses the note back. Nothing is written into the source code, and the check needs no board and no network.

**Never a hard stop — a question.** Changing code that is `uncovered` (no analysed chapter, or milestones only) or `drifted` (changed since the chapter's last row) makes the agent ask: analyse it first (you run `/analyze-code-base`), continue without the model this time, or never ask about this folder. Only `ignore` is remembered. A change in a governed, in-sync chapter needs no question: it is modeled on the board first, the code follows, then `vibe baseline advance` moves the baseline (`vibe-translate` is the catch-up for drifted code). No slice goes to `planned` — the code already exists.

**A build kit is optional.** Only for a change that starts on the board: with `.build-kit/` present, `vibe-control` models it, sets the slices to `planned` (never an `InProgress` one) and the build agent builds it. Its commits would then show up as drift — accepting them (`vibe baseline accept --files`) is not built yet.

## On disk

| | |
|---|---|
| `.vibe/baseline/<chapter>.json` | `{ chapter, depth, runningUi?, folders{api,persistence,tests,ui}, notModeled[], decisions[], history[{ date, commit, dirty, pass, scope, result }] }` — written by the CLI, never by hand |
| `.vibe/events/`, `events.log` | the control log (`CoverageQuestioned`, `CoverageAnswered`, `CodeSynced`), the same store the build kits and the prototype use |
| `.claude/skills/vibe-control`, `vibe-translate` | the flow; plus the modeling skills they hand work to (`analyze-code-base`, `eventmodeling-*`, `place-element` …) |

A history row's `commit` + `dirty` (content hash of every file that differed from the commit) say exactly which state of the folders was analysed. Drift is a file whose content is not what the last row says — committed since, edited, new or deleted — so an edit that was translated and advanced is known, and the next edit is drift again. Git is required.

## Not built, on purpose

No unattended loop (`run --vibe`). Vibe coding is interactive, so the flow is skills: `start-vibe-session` brings model and code in step at the start of every session (the CLAUDE.md rule has the agent run it itself; `/start-vibe-session` re-runs it by hand), `vibe-control` asks before each change, `vibe-translate` writes it onto the board through the MCP tools. A skill cannot force the per-change check — the CLAUDE.md rule does that. The agent's board write tools are not denied here (the prototype denies them because it executes recorded changes in order).

## Removing the feature

`eventmodelers uninstall --vibe-coding` (or `vibe remove`) cleans a project. To delete the feature itself: this folder, `test/vibe-local.test.js`, and in `cli.js` the import, the `registerVibe(...)` call, the `underVibe` check in the init-required hook, `installKit`, and the `--vibe-coding` options with their one-line delegates in `init` and `uninstall`.
