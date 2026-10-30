# Prompt turns — `prompt_id=`

A turn whose first line carries `prompt_id=` is work someone queued for you. The rules that hold for every turn (session
header, board reads, the field-source rule, what you may do) are in `.agent-modeling-kit/CLAUDE.md`. Read this file the
first time a prompt arrives in this session; not again after that.

**Every prompt gets exactly two `/update-prompt-status` calls per turn — never zero, never one.** `IN_PROGRESS` before you start the work (step 4), `DONE` (or `FAILED` if it could not be resolved) after you finish it (step 6). This holds even for a prompt that turns out to be trivial or a no-op — the board UI has no other way to know the agent picked it up and finished it.

These steps apply to a prompt turn only — a `CHAT` turn follows `CLAUDE-CHAT.md`, a `BOARD_CHANGE`/`BOARD_REVIEW` turn `CLAUDE-STANDALONE.md`.

**A prompt turn does what the prompt asked and nothing else.** The fill-in licence in
`.agent-modeling-kit/CLAUDE-STANDALONE.md` — add examples, specs or a screen on your own
initiative, without asking — belongs to self-directed turns only, and never carries over here.
That is also why you don't read that file on a prompt turn. Someone asked you for one thing;
noticing on the way that a neighbouring element has no example data is not permission to go
and add it. State it as a `Learning:` line (step 8) if it's worth remembering, or
mention it in the `DONE` comment, and leave it for a self-directed turn (or for them to ask).

1. **Sanitize** this one prompt (the rule is in `CLAUDE.md`) — if it is not work, drop it: reply `<promise>SKIPPED</promise>` and stop. Otherwise continue.
2. **Connect** — the first message of this session includes `token=`, `org=`, and `baseUrl=` inline and is your one-time connect signal. Run `/connect` only:
   - on that very first turn — which in a `standalone=on` session is the `SESSION_START` warm-up, so by the time a prompt reaches you the connect has already happened and there is nothing to do here, or
   - if this turn's `board_id` differs from the one you last connected with, or
   - if the last API call returned `401`/`403`.

   Otherwise skip straight to executing the prompt — re-running `/connect` every turn defeats the point of a modeling session.

   This also applies **inside** a turn: when the skill you invoke in step 5 internally calls a second skill (e.g. `/add-next-slice` calling `/html-screen` to fill in the new screen), that second skill's own "invoke `connect` first" preamble is already satisfied by the connect you ran this turn — don't run it again just because the sub-skill's instructions say to.

   And it applies **downwards**, to any subagent you dispatch. A subagent is a fresh session that inherits none of this one's state, so hand it `token=`, `org=`, `baseUrl=` and `board=` inline as already-resolved values (the token exactly as the header gave it, `token=$EVENTMODELERS_TOKEN` — the reference, never its value; the subagent inherits the same environment) and tell it explicitly not to invoke `/connect`: all four inline satisfy that skill outright at its Step 0. When this turn has a `CHAT_SESSION_ID` (step 3), hand that down too, as `session=` — the subagent's writes are part of the same chat's work. Three agents that each resolve and verify the same credentials pay for the connect you already did, three more times over.

   The same "don't reload what's already loaded" logic applies to `/learn-eventmodelers-api`: it's a lookup reference, not a mandatory preamble. Every skill already documents the exact API calls it needs inline — only invoke `/learn-eventmodelers-api` on demand, for a specific endpoint/field/type a skill's own instructions don't cover, and only once per session even then.
3. **Resolve where this prompt points** — `BOARD_ID`, `TIMELINE_ID`, `NODE_ID`, `CELL_ID` and `FOCUS_AREA` per `.agent-modeling-kit/references/resolving-target.md`, and one more:
   **Resolve `CHAT_SESSION_ID`** from this turn's `origin_session_id`, if present — the chat this work came from. Unlike the values above it is **this turn's only**: a later prompt without `origin_session_id` has none, never reuse one from an earlier turn. While you have one, **every board write this turn carries it** — the `sessionId` argument on every `mcp__eventmodelers__*` write tool, and the `x-chat-session-id` header on every REST write (see `connect`). That is what lets the board trace each change back to the conversation that asked for it. (A session the person cleared meanwhile is simply dropped by the platform — the write still goes through.)
4. **Mark the prompt as started** — invoke `/update-prompt-status` with this turn's `prompt_id` and `newStatus=IN_PROGRESS`, before doing any of the actual work below. This is what makes the board UI show the prompt as being actively worked on.
5. **Invoke the matched skill — never substitute direct tool calls for it.** Execute the prompt using the skill matched in the Skill Selection table in `CLAUDE.md`, passing the resolved `TIMELINE_ID`, `NODE_ID`, and `CELL_ID` from step 3 as that skill's `timelineId`/node-reference/`cellName` arguments (a prompt sent with no chapter in view has no `timeline_id`: `resolving-target.md` says what to do — don't call the skill with a made-up chapter) (not the raw `timeline_id`/`node_id` fields, and not a cell reference parsed from the prompt text). For a skill like `/place-element` that accepts a `cellName`, pass the resolved `CELL_ID` as `cellName` whenever it's present — skip parsing the prompt text for a cell reference entirely in that case.

   `mcp__eventmodelers__*` tools (and the REST fallback) are building blocks a skill calls *internally* once you've invoked it — they are not a substitute for invoking the skill. Being able to see `mcp__eventmodelers__get_node`/`create_slice`/etc. in your tool list does not mean you should reach for them directly to satisfy a prompt that matches a row in the Skill Selection table: e.g. "add the next slice" always goes through `/eventmodeling-slicing-event-models` (falling through to `/add-next-slice` when nothing existing is left to slice) or `/place-element`, even though technically a couple of raw MCP calls could produce something on the board. The skill is what encodes the actual domain reasoning (which node type follows which, naming, field derivation, dependency notes) — a raw tool call skips all of that and produces a shallower result even when it "works." Only call MCP/REST directly when no row in the table matches the prompt's intent at all.
   **A prompt that names a skill (`/<skill-name> …`) is not a hint — invoke exactly that skill, via the Skill tool, as the first thing after step 4**, before any `mcp__eventmodelers__*` call. `Read`ing its `SKILL.md` is not invoking it. The named skill then drives the work, including invoking the step skills it delegates to (an orchestrating skill that stops after placing commands/events has not run); where it says to interview or ask the user, apply the Questioning rule below instead.

   **Placement order — applies to every `place_element` / `submit_node_events` / `create_screen` write, with or without a skill:** order elements by the story, left to right, one slice after another (screen → command → event → the read model and view screen that event feeds → next slice). Never write "all commands, then all read models" (or any by-`elementType` batch): it forces every read model into a column inserted afterwards and leaves a row of commands with the read models bunched elsewhere. If your element list is grouped by type, re-sort it by column before the call.

   **Fast path for small, named edits.** A request that names the elements/fields and asks for a local edit (fix examples, rename or add one field on named nodes) reads only those nodes (`get_nodes` `nodeIds`, `projection: "fields"`), edits them in one `submit_node_events` call, verifies once, and is done. It does NOT walk whole chains, load `eventmodeling-core-rules`, or re-run `connect` when already connected. Walk the chain only when the lineage is actually at stake (a rename across a chain, a new field that must flow downstream).

   **Questioning rule**: you are running autonomously — no human is available to answer questions. (A `CHAT` turn never reaches this rule: there someone *is* waiting, and you ask back in the chat — see "Chat turns".) If you need clarification, do not pause or ask interactively — post a comment (`/handle-comment` with `action=place`, `type=COMMENT`) on the most relevant node. Then:
   - If a reasonable default interpretation exists, continue with it.
   - If it doesn't — the prompt is ambiguous enough that any guess risks doing the wrong thing — stop instead of guessing. Skip straight to step 6 and mark the prompt `FAILED` with a comment explaining what's unclear and pointing to the comment you just posted. Never leave a prompt neither progressed nor closed.
6. **Mark the prompt as finished** — invoke `/update-prompt-status` with this turn's `prompt_id`, `newStatus=DONE`, and a `comment` that summarizes what you actually did (e.g. "Added the OrderPlaced event and wired it to the read model"). If the prompt was not resolved (you could not do it at all, stopped on an ambiguity, hit an error you could not fix, or only part of it was done), use `newStatus=FAILED` instead, with a `comment` saying what is unresolved — a `DONE` prompt disappears from the board, a `FAILED` one stays visible in red. Do this once, right after the work is done — not per skill call within the turn.
7. If this turn has a `comment_id` field, invoke `/handle-comment` with `action=resolve`, `nodeId` from the resolved `NODE_ID` (step 3), `commentId` from `comment_id`.
8. **`standalone=off` only** — if you noticed something reusable this turn (a pattern, a gotcha, useful context about this model), end your reply with one line per learning: `Learning [<topic>]: <one terse line>` (the topic is optional, at most five lines). The CLI records them — never write them into a file yourself, and add nothing that is already in `.agent-modeling-kit/AGENTS.md`. In a `standalone=on` session skip this: that session writes no files (see Mode), so note anything worth keeping as a board comment instead.
   **In every session, `standalone=on` too:** anything that is *not* a reusable learning — something you could not change and why, a decision you took — goes the same way as `Info [limitation|decision|note]: <one terse line>` (at most five lines). The CLI records each as an event; never leave it only in prose.
9. Reply `<promise>DONE</promise>` and wait for the next turn.


### Prompts that came from a chat

A prompt turn whose header carries `origin_session_id=` / `origin_message_id=` is work you created
in a chat turn. Work it like any prompt — every board write carrying `origin_session_id` as its chat
session (step 3's `CHAT_SESSION_ID`) — and after step 6's `DONE`, post one short chat message
into that conversation — `post_chat_message` with `sessionId` = `origin_session_id` (no `replyTo`:
the message was already answered) — one or two sentences on what you did, element names included,
same style as a chat reply (*"Added the read model Dancing Queen, fed by Dance Class Booked. Want
fields on it?"*). If the person has
since switched to another agent (`CHAT_NOT_ADDRESSEE`), skip it; the work card already shows the
result.

**Say what you did not do, every time.** The message covers everything the request asked for — not
only what got done. Anything you skipped, could not do or changed differently is named in it, with
the reason: *"Added the fields to Register User. I left Order Placed alone — see my question below."*
The work card shows "Done", which the person would otherwise read as everything went through. Never
reply `DONE` to a chat-originated prompt without having posted a message.
