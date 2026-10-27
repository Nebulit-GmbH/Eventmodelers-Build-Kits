# `eventmodelers prototype`

A local, clickable prototype of one context, built from the board's model, changed with prompts, synced back on request.

```bash
eventmodelers init --prototype                      # installs the skills, asks for the board credentials (like init --modeling)
claude                                              # then, in Claude Code: /local-prototype   — you run this yourself
eventmodelers prototype                            # serve and watch (/local-prototype only builds; run this, or `eventmodelers run --prototype`, yourself)
eventmodelers prototype fetch --context "Orders"    # fetch one context (the skill does this when there is no local model)
eventmodelers prototype sync [--dry-run] [--yes]    # write pending changes back to the board, on request
eventmodelers prototype remove [--discard]          # delete .prototype/, the skills and the CLAUDE.md block (never .slices/)
```

`/local-prototype` uses the model files already on disk when there are any, and only fetches when there are none. Prompting happens in Claude Code, never inside this command, which never starts Claude. A prompt goes through two skills: `local-prototype-model` edits the model, `local-prototype-build` rebuilds the changed slices; the running command notices the file changes, the browser reloads; the board only follows when you run `prototype sync`.

## Principle

**The prototype is a reflection of the model.** The JSON (and the local screens) is the source of truth; `index.html` is derived and disposable. Skills installed into `.claude/skills/` (plus `connect`) and announced in `CLAUDE.md` (between `eventmodelers-prototype` markers): `prototype` (entry), and

1. `local-prototype-model` — prompt → edits of the slice JSON and the HTML screens, carried through the chain.
2. `local-prototype-build` — JSON → slice blocks → `.prototype/index.html`; only slices whose hash changed.

## On disk

| | |
|---|---|
| `.slices/<context>/<slice>/slice.json` | the model — edited; the usual `.slices/` that `fetch` writes, only this prototype's context is used |
| `.prototype/screens/<node id>/` | `screen.json` + `page-N.html`, one folder per screen — edited |
| `.prototype/baseline/<slice id>.json` | the model as last fetched or synced — never edited; `sync` diffs against it |
| `.prototype/work/`, `index.html`, `vendor/` | build output and the page's libraries (downloaded from the app once) |

## Sync

Compares each `slice.json` with its baseline. Written in one `node:changed` batch: an element's `fields` and `description`, and an HTML screen's `pages` (a screen edited under `.prototype/screens/` is remembered against what the fetch wrote — `baseline/screens.json` — and compared with the board's pages, never overwritten over a board change). Listed as not synced: new/removed elements, renames, wiring, changes on linked copies, scenarios and storylines, sketches. An attribute the board changed since the fetch is a conflict and is never overwritten.

## Removing the feature

`eventmodelers prototype remove` cleans a project. To delete the feature itself: this folder, `test/prototype-local.test.js`, and in `cli.js` the import, the `registerPrototype(...)` call and the `--prototype` option with its one-line delegate in `init`.

## An empty prototype

`eventmodelers init --prototype --empty` creates a prototype with no board: one slice "Hello World" with its page, already built (`empty.js`), plus the
skills and the CLAUDE.md block. Credentials and a board come later (the `connect` skill); an existing local model is never touched.

## The player and feedback

**The agent only makes local changes.** The board's own MCP write tools (`create_slice`, `place_element`, `submit_node_events` … 33 of them) are denied in the folder's `.claude/settings.local.json` (written by `init` / `re-init`, removed by `prototype remove`); reads (`get_*`, `list_*`, `validate_*`) and the CLI commands stay. The board is written only when changes are executed — by `prototype sync`, the Sync button, or `run --prototype --sync` — in order and with the conflict check.

The header has a **Jump to Board** link that opens the board of this folder's config in EM Studio on eventmodelers.ai (`https://app.eventmodelers.ai/?board=<id>`; the app host is derived from the configured API host). No config, no link — an empty prototype has no board.

`eventmodelers run --prototype [--port <n>]` (or `prototype`) serves the page inside the board app's own player — the
`PrototypeModal`, feedback toggle/composer/list, replay and replay bar, built from the app's source into `host/dist/` (`MIRO_APP=<path to
miro-eventmodeling> node extensions/prototype/host/build.mjs`; only login, chat and storage are replaced, in `host/stubs/`).

- **The player controls the agent through events** (`control.js`, the same event store the build kits use: `.prototype/events/` + `events.log`).
  Saving a feedback comment → `FeedbackRecorded` (stored locally at once; there is no Apply or Submit button locally), Sync → `SyncRequested`,
  Fetch → `FetchRequested`, Rebuild → `RebuildRequested`. When the agent has a question (`changes translated --ask '{"question","options"}'`) the pill turns orange; clicking it opens a modal with the question, the options to click and a field for an answer of your own, which is recorded as `FeedbackAnswered` and translated like a feedback; **Discard** records `FeedbackDiscarded` and removes the feedback's change files that were not executed yet. The agent records `ControlClaimed` / `ControlProcessed` (applied | needs-you |
  failed), so what was processed is in the log too: a request is open until a `ControlProcessed` refers to it, and nothing is done twice. The buttons
  show the outcome.
- **Multi-stage update — feedback → changes → execution.** Saving records `FeedbackRecorded`. The next iteration **translates** it (the one judgment, a
  model turn): each comment becomes **changes** in `.prototype/changes/` (next to `events/`, one global order with them — one counter numbers both). A
  change says what to change in which node, slice or the board, and carries the **full instructions** to execute: the complete `node:changed` event
  (the very one `prototype sync` writes) or the complete board tool call (an eventmodelers MCP tool; never a destructive one — those are questions).
  Then the changes are **executed one by one in order**, no agent: applied to the local model and the page rebuilt. **`--sync` is only whether the
  remote model is updated: with it the changes are written to the board right away; without it they stay local until the player's Sync button (or
  `prototype sync`) requests it** — that executes every change not yet synced against the board, in order (conflicts are never forced), then syncs
  the rest of the model's differences. All of it can happen in one iteration. A slice created by a tool call brings a screen with no design ("Untitled screen — design pending"): once the model is fetched the loop finds such screens and designs them locally in one agent turn (`local-prototype-model`, the `html-screen` skill, the look of the existing screens) — they reach the board as the screen's pages with the sync (at once with `--sync`). Independent of `--sync`, the loop keeps the prototype in line with the
  slices: when they changed and held still (15 s) it rebuilds the stale ones; Rebuild builds from the local slices; **Fetch** takes the board's latest slice
  definitions in (never over unsynced local edits) and the page follows.
- **Who reads them:** `eventmodelers run --prototype` is the agent loop: each iteration it reads the log. Sync and Rebuild are done right away (a sync
  with nothing else open the loop runs itself); feedback is translated by a model turn, its changes executed, the stale slices rebuilt by a second turn.
  The agent is one warm Agent Client Protocol session (the build kits' `acp-session.js`): claude by default through the `claude-agent-acp` adapter,
  `--agent <name>` or `--acp-cmd "<command>"` for another; one process for the life of the loop, the conversation reset every 8 turns. As everywhere ACP
  is used, permission requests are answered with "allow". Without the loop, every Claude Code run in the folder checks `prototype events --pending`
  first (rule in CLAUDE.md) and works through the requests with `/local-prototype-control`.
- `prototype events [--pending] [--type t]` lists them (also `eventmodelers events` in a prototype folder); `prototype events claim <id>` and
  `prototype events processed <id> --outcome … --note …` are what the agent records; `prototype board` prints what a board tool call needs that the model lacks (board, the context / timeline = chapter id, slice ids) and `prototype tools [name]` the board's tools with their exact input schema — the translator looks these up instead of asking; `prototype changes [--pending]` lists the changes, `changes add / translated`
  record the translation, `changes run [--board]` executes them, `changes submit` writes the ones applied locally to the board. `eventmodelers re-init` in a prototype folder (or re-running `init --prototype`) refreshes the skills, the
  CLAUDE.md block and the page libraries and leaves `.prototype/` (model, events) alone; no questions, credentials as they are (`--force` asks again).
