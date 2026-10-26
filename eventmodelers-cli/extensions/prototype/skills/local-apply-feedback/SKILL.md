---
name: local-apply-feedback
description: Translate the feedback recorded in the local prototype player (FeedbackRecorded events) into executable changes — node events and board tool calls, each saying exactly what to change in which node, slice or the board — and record them in .prototype/changes/. This is the one judgment in a multi-stage update; running the changes needs no agent. Invoked by local-prototype-control for each FeedbackRecorded request; also for "/local-apply-feedback", "apply the feedback", "what feedback is there".
---

# Apply feedback — comments in the browser → executable changes

People give feedback in the prototype player (`{{CLI}} run --prototype`): the feedback button, click an element, comment — saving a comment records it at once as a `FeedbackRecorded` event in the control log (`.prototype/events/`) — stored locally, nothing else happens in the browser. A multi-stage update turns it into changes:

1. **Recorded** — the player wrote `FeedbackRecorded`.
2. **Translated** — *this skill*: every comment becomes one or more **changes** in `.prototype/changes/` (next to `events/`, one global order). A change is something that can simply be **executed**: a `node:changed` event (the very event `prototype sync` would write) or a board tool call. The translation is the crux — it is the only step that needs judgment.
3. **Executed** — `{{CLI}} prototype changes run` runs the changes one by one in order, no agent: each is applied to the local model (then the page is rebuilt, `local-prototype-build`) and, with `--board`, written to the board. **Without `--board` the changes stay local** — recorded in `.prototype/changes/` and applied to the model — **until `prototype sync`** (or the player's Sync button) executes them against the board, one by one, in order. `run --prototype --sync` writes them to the board right away.

This skill does stage 2 and never edits the model itself — the changes do, when executed. The prototype stays a reflection of the model.

## Steps

1. **Read it.**
   ```bash
   {{CLI}} prototype events --pending --type FeedbackRecorded
   ```
   When the request names event ids, only those. Each event's `data` is `{ name, events, feedbacks }`; each of the `feedbacks` has `id`, `comment` (what is wanted), `element` (`path`, `tag`, visible `text`, its `html`) and `trail` — `screen` (tab title), `slice` / `sliceTitle` (the slice whose part was clicked), `interactions` (what the person clicked and typed, oldest first) and `events` (the session's event log: the state they saw). None open: say so and stop.
2. **Find the place.** The slice and node live in `.slices/<context>/<slice>/slice.json` (by `trail.sliceTitle`; else by the screen's title in the slices' `screens[]`); screens in `.prototype/screens/`. The element tells you where on the screen, the comment what is wanted. Group comments that touch the same node.
3. **Never ask for what you can look up.** You have the `connect` skill — the connection to the board (token, board, API host in `.eventmodelers/config.json`; invoke `connect` when `prototype board` says there are no credentials) — and the fetched slices. **Reading** the board is yours to do; **writing** to it is not: that happens when the changes are executed, in order. the board's ids (board, the context / timeline = chapter id, every slice's id) are in `{{CLI}} prototype board`; the exact input of any board tool is in `{{CLI}} prototype tools <name>` (`prototype tools` lists them) — look them up (the CLI uses the connection `connect` set up) and write the call. "The chapter id is not in the local model" or "which tool input?" is never a question for the person. A question is only for a real choice (what the person wants, which of several readings), never for information the CLI gives you.
4. **Changes follow the event modeling rules.** What the board gets must be a valid event model, not just something that fits. The rules are the `eventmodeling-*` skills installed next to this one — **read `eventmodeling-core-rules` before you record a change that adds, removes or rewires anything** (a slice, a command, an event, a read model, an automation, a scenario), and the one for what you add: `eventmodeling-designing-automation-chains` for an automation, `eventmodeling-slicing-event-models`, `eventmodeling-identifying-inputs` / `-outputs`, `eventmodeling-information-completeness` (every field has a known source), `eventmodeling-elaborating-scenarios` (every slice has its scenarios), `eventmodeling-translating-external-events`. You read them for the rules; their steps that write to the board are not yours to run — you express the result as changes. The ones that decide most requests:
   - **Every automation needs a todo-list read model** — a list-shaped read model (`listElement`) in the column before the automation, **opened** by the event(s) that make work outstanding and **closed** by the event the automation's own command produces; the automation reads it and issues its command. "When X happens, send an email" is therefore **several changes, in order**: the todo-list read model (fed by X's event), the automation with its command and its resulting event, the wiring between them, and the scenarios of the new slices — never just an automation and a command.
   - **A new slice brings a screen that has no design** ("Untitled screen — design pending" on the board). You cannot design it in the same translation — its node does not exist until `create_slice` has run. The next steps do it: execute, fetch (the new slice and its screen arrive), then design the screen locally (`local-prototype-model`, following `html-screen` and the look of the existing screens) and sync it as the screen's pages. In `run --prototype` the loop does all of that in the same iteration; by hand: `prototype changes run --board`, `prototype fetch`, design, `prototype sync`.
   - Commands, events and read models carry only fields with a known source; names follow the rules (events in past tense, commands as verbs …); a new slice gets its scenarios.
   - A change that would break a rule is not recorded: it is made right, or asked about (step 7).
   Run the checklist (`eventmodeling-validating-event-models-checklist`) over what you are about to record before `changes translated`.
5. **Sort every comment:** *clear* (says what the result should be — apply it to the element they clicked, however badly worded), *a real choice* (no result named, contradictory, a rule nobody modelled, beyond this model), or *not a change* (praise, a question). Only a real choice is a question: never guess, never ask about a clear one.
6. **Translate each clear comment into changes** and record each:
   ```bash
   claim first:  {{CLI}} prototype events claim <feedback event id>
   {{CLI}} prototype changes add --from <feedback event id> --json '<change>'
   ```
   You write changes with this command (and only with it — never into `.prototype/changes/` by hand): it checks the names against the model, fills in the ids, numbers the change in the global order and stores it. A big value — a screen's pages — does not belong in a shell argument: write the change as JSON to a file (`.prototype/work/change.json`) and pass `--file .prototype/work/change.json`, or pipe it to stdin with a heredoc.
   A change carries the **full instructions**: what to change for each node, slice or the board, and the complete thing to execute — the whole `node:changed` event (its id is the change's id) or the whole tool call. You give a shorthand and the change is stored in full:
   ```json
   {
     "summary": "Rename the list-name field's label to “Name of your list”",
     "scope": "node",                                            // node | slice | board
     "target": { "sliceTitle": "Create Todo List", "nodeTitle": "New List", "nodeType": "HTML_SCREEN" },
     "action": "edit-text",                                      // one verb: edit-text, set-description, add-field, remove-field, rename, add-scenario, add-slice …
     "change": { "details": "…", "before": "List name", "after": "Name of your list" },
     "feedbackItem": "<feedback id>", "comment": "<the comment>",
     "exec": { "kind": "node:changed", "attribute": "fields", "value": [ …the WHOLE new list of fields… ] }
   }
   ```
   - **`exec.kind: "node:changed"`** — for a change of a node's `fields` or `description` (a node that owns its node, not a linked copy): `{ "attribute": "fields", "value": … }` is stored as the full event `{ id, eventType: "node:changed", nodeId, changedAttributes: ["meta.fields"], meta: { fields: … } }`. The value is the **whole new value** of that attribute, built from the node as it is in `slice.json` now. Several comments on one attribute are **one** change with the merged value. The names are checked against the model; the ids are filled in.
   - **`exec.kind: "tool-call"`** — everything else the board can do through its tools: `{ "tool": "add_scenario", "input": { … } }` is stored as `{ call: { name, arguments } }` (`create_slice`, `update_slice_status`, `add_comment` … — the eventmodelers MCP tool names; `boardId` is filled in when executed). Look the tool's input up before you write it; an input that is wrong fails when executed, and the change is recorded failed.
   - **Never destructive.** A change that deletes or clears something on the board is not recorded: ask instead (step 7). `delete_node`, `clear_cell`, `delete_column`, `remove_lane` are refused.
   - **A screen's text, label, layout** (a comment about what the page shows) is a `node:changed` of the screen's **`pages`**: `{ "attribute": "pages", "value": [ …the WHOLE list of pages, each the page's complete html… ] }`, scope `node`, target the screen node (`nodeType` HTML_SCREEN). Build the value from the current `.prototype/screens/<id>/page-N.html` with the change made, markup and classes kept. `pages` is a change of its own — the command's `fields` are another. When a feedback adds a field to a command and the screen should show it, that is two changes: the command's `fields` and the screen's `pages`.
   - Anything the board cannot take yet (a sketch's drawing, linked copies) is not a change: say so in the summary and ask.
   - **Order is the order you record them in** (global, shared with the events): record a change before the one that builds on it.
7. **Record that you are done translating:**
   ```bash
   {{CLI}} prototype changes translated <feedback event id> --ask '{"question":"Which currencies?","options":["EUR only","EUR and USD"]}' --ask '…'
   ```
   Questions are the real choices of step 5, each with **2–3 concrete options** ("Reject a 4th list — Given 3× TodoListCreated … Then rejected …"). `--question "<text>"` is for a question with no options (free text only). The player shows the open questions in a **modal** behind the orange "Feedback needs you" pill: options to click, a field for an answer of the person's own, and Discard. A feedback with no changes and only questions is fine; one with neither is recorded processed (`events processed … --outcome applied --note "nothing to change"`). When a person is here you may also ask in the session (`AskUserQuestion`); unattended, the questions stay on the request — it ends `needs-you` after its changes ran.
8. **Then, in a session with a person:** `{{CLI}} prototype changes run` (add `--board` only when they asked for the board to be changed too), then `local-prototype-build` to rebuild what changed. In `run --prototype` the loop does both right after you (and, with `--sync`, writes the changes to the board too).

**Answers.** When the person answers the questions in the player, a `FeedbackAnswered` event is recorded: `data: { ref, answers: [{ question, text, answer }] }`, `ref` the original `FeedbackRecorded` event (read its comments with `events --type FeedbackRecorded`). A question the person left blank was left to you: decide it from what you have, or ask it again with `--ask`. An answer in their own words counts as much as an option. Translate it like any feedback — the answer is what was missing: record the changes with `changes add --from <the FeedbackAnswered event id>`, then `changes translated <that id>` (new questions again with `--ask`). If the person *discards* a feedback, nothing is left to do: `FeedbackDiscarded` removes its changes that were not executed yet.

**Report:** one line per comment — which changes it became (`seq`, summary), or the question.

Never edit `.prototype/events/` or `.prototype/changes/` by hand. Never record a change you cannot say exactly: if you cannot name the node and the new value, it is a question.
