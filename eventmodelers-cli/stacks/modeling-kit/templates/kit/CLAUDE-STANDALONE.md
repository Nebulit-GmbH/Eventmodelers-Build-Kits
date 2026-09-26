# Standalone board-change turns

**Read this file only in a `standalone=on` session, and only once the first turn whose first
line is `BOARD_CHANGE` or `BOARD_REVIEW` actually arrives.** It is a one-time read like
`.agent-modeling-kit/CLAUDE.md` itself — don't re-read it on later self-directed turns, don't
read it at all in a `standalone=off` session, and don't read it "to be prepared" while handling
a prompt turn. Nothing in here loosens what you may do on a prompt turn: the fill-in licence
below belongs to turns nobody asked for, and a prompt turn that has this file in its context is
exactly how it starts doing more than it was asked.

Everything else — the connect/resolve rules, the Skill Selection table, the Progress Entry
Format — stays in `.agent-modeling-kit/CLAUDE.md` and still applies.

These turns come in two shapes, and both are self-directed — nobody asked you for anything:

```
BOARD_CHANGE board_id=<uuid> organization_id=<uuid> seq=118..124 events=7 nodes=3
changed:
- 9f3c…: node:created, node:changed (4×)
- a12b…: node:changed (2×) — possibly your own earlier write
- c771…: node:deleted
```

```
BOARD_REVIEW board_id=<uuid> organization_id=<uuid> idle_for=900s
changed: nothing — the board has been quiet.
```

**The change list is a notification, not the work item.** It tells you that something
happened and which corner of the board to look at first — nothing more. It is not a task
list, not a boundary, and the last line of it is not "the" change to react to. A burst of
40 events on 6 nodes and a single `node:created` get the same treatment: you look at the
model, not at the event. A `BOARD_REVIEW` turn is the same job with no starting hint at all.
Nodes marked *possibly your own earlier write* are changes that landed while you were
working or just after — usually your own echo, so weigh them accordingly, but don't assume:
a human may well have been editing at the same time.

**There is no `prompt_id` in these turns — never call `/update-prompt-status` in one** (not
`IN_PROGRESS`, not `DONE`; the "exactly two calls per turn" rule is about prompt turns only).
There is nothing to sanitize either — a board change is not user text.

Steps:

1. **Get the whole picture, not just the changed nodes — in two reads, not twenty.** The
   whole `changed:` list goes into **one**
   `mcp__eventmodelers__get_nodes { boardId, nodeIds: [...], projection: "line" }` (REST:
   `POST .../nodes/query` with `"projection": "line"`), and
   the area around it into **one** `get_board_outline` per chapter those nodes land in — the outline is the
   only read that carries slice statuses; `line` gives ids, names, types and attribute names, nothing more (cell names come from the outline).
   Drop `projection` only if you need field types, examples or descriptions of those nodes. That pair is your
   orientation — and you pay for a chapter's half of it **once per session**: the `SESSION_START` warm-up
   deliberately read no chapter at all, so the first turn that touches one fetches its outline and keeps it,
   and every later turn works from that copy, re-reading only where this turn's `changed:` list says it moved
   on. A chapter nothing has changed in is a chapter you never read. Widen out from it to what the nodes sit in — their cell, their slice, the
   chain they belong to, the timeline around them — and spend a full-`meta` `get_nodes` only
   on the handful you conclude you are actually going to touch. One `get_node` per changed
   node, or a second outline call for a chapter you already read this turn, is the same
   fetch paid for twice (see `connect` Step 5). Then judge the board as a whole: run `/analyze-existing-model` once per session to get that picture and
   keep it in mind across turns, refreshing it when a turn's changes invalidate it. On a
   `BOARD_REVIEW` turn that model-wide picture *is* the starting point.
   **What you read here is what you hand down in step 3.** Index it and keep it: every fact
   an agent needs about its target — title, type, cell, fields, neighbours — is already in
   this read, and re-fetching it once per agent is the single largest avoidable cost in a
   fan-out turn.
2. **Decide what the model needs — plural, and not necessarily where the change was.** List
   the candidate contributions you can actually see evidence for, each with its own target
   (node/cell/slice) and the skill that does it. A changed node is a reason to look; it is
   not automatically the thing to work on, and work you spot two slices away counts just as
   much. The usual candidates:
   - an EVENT/COMMAND/READMODEL with fields but no example data → `/examples`
   - a COMMAND or READMODEL with no specs on it — no GWT scenarios, no storyline →
     `/eventmodeling-elaborating-scenarios`
   - a field added to one element that its chain neighbours are missing → `/attributes`
   - an empty SCREEN/HTML_SCREEN node → `/html-screen`
   - a timeline element that clearly should be sliced and isn't →
     `/eventmodeling-slicing-event-models`
   - a gap or unhandled case that raises a real business question → one QUESTION comment via
     `/handle-comment` with `action=place`
   Nothing is a candidate when it's cosmetic (a node moved, resized or renamed), when the
   target already has the thing you'd add, when it's inside something you yourself just
   wrote, or when the element is still visibly half-finished in itself (a placeholder name,
   no fields yet — there is nothing to fill in). An empty candidate list is a perfectly good
   outcome — see step 8.

   **Fill it in now, or ask first? — there are only these two tiers.**

   *Fill-in work — just do it, on this self-directed turn, without asking.* Every candidate above is additive,
   scoped to one element or one chain, and leaves the human's structure exactly as they built
   it: examples, specs, an attribute along a chain, a screen, one question comment. This is
   what a standalone session is *for* — the human models the shape, you fill in the detail
   behind them while they keep going. A node created sixty seconds ago is the **best** target
   for it, not a reason to wait: they placed a READMODEL with fields and moved straight on to
   the next column, and its specs and example data are precisely what they didn't stop to
   write. All of it is cheap to undo — one gesture on the canvas, or one prompt — so guessing
   slightly wrong costs far less than a board that stays empty while the agent watches.

   *Board-wide or structural work — name it in a comment, then get on with the fill-in work.*
   Sweeping every chapter at once, renaming, re-shaping or deleting anything, moving slice
   statuses, reordering a timeline: post one comment saying what you'd run and why, and spend
   the turn on tier one instead. Never make the structural move on your own initiative.

   **Freshness is not a reason to hold back, and neither is an unanswered question.** The CLI
   already waited for the board to go quiet before handing you this turn — a debounce after
   the last event, the echo window, and a minimum gap between turns — and that *is* the
   mid-edit guard. Do not add a second one on top of it: "the human is still working" describes
   every good standalone turn, not an exception to it. Equally, a question you posted on an
   earlier turn parks the one structural sweep you asked about and nothing else. It never
   becomes a standing hold on fill-in work, and you never wait across turns for an answer —
   nobody reads your turn output, only the board.
3. **Spawn a subagent for each piece of work that needs doing — and only where one does.** The
   analysis in steps 1–2 is yours: you look at every entry in `changed:` yourself, in the
   context of the model, and decide what (if anything) needs to happen. Then, for each
   candidate that survived that judgment, dispatch one subagent via the `Agent` tool, **with
   all of them in a single message** so they run in parallel. Entries that need nothing spawn
   nothing; a turn where nothing needs doing spawns nothing at all and ends in a `NOOP`. What
   you must never do is work the candidates one after another in your own turn, or pick one
   out of five and drop the rest — nine events on three nodes that each need something are
   three agents working at once. You analyse and coordinate; the agents do the work.
   Each subagent prompt must be self-contained, because a subagent is a fresh session that
   inherits none of this one's state:
   - `token=`, `org=`, `baseUrl=` from this session's first message plus `board=<board_id>`,
     marked as **already resolved and verified**, and an explicit instruction *not* to invoke
     `/connect`: all four inline satisfy that skill outright at its Step 0, so an agent that
     runs it anyway pays for a config-file walk and a verify call to be told what you just
     told it — times the number of agents you dispatched;
   - `board_id`, plus the exact target ids (`node_id`/`cellName`/`timelineId`/slice) it owns
     — never "the node that changed";
   - **the board state you already read, inline.** For each target: its id, title and type,
     its cell (column/row), its `meta.fields` as you loaded them, its column's `sliceStatus` (from the outline), and the
     neighbours that bear on the work (the event a read model follows, the chain a field has
     to travel, the persona and values other elements already use). All of it is sitting in
     your step-1 read. An agent handed bare ids has exactly one way to recover it — fetch the
     board again — so leaving it out doesn't save the read, it multiplies it. Hand over the
     extract and say what it is: *this is the board state as of this turn; work from it, and
     read the board only to re-check a node immediately before you write to it.*
   - what you concluded in step 2: the specific piece of work, and enough of the surrounding
     model for the agent to do it well;
   - the one skill to invoke, from the Skill Selection table in `.agent-modeling-kit/CLAUDE.md`,
     and the same rule that applies to you: invoke the skill, don't substitute raw MCP calls;
   - the questioning rule: nobody is there to answer, so it must never ask interactively (no
     `AskUserQuestion`, even where a skill lists it) — it posts a comment on its target and
     continues with the best reading of the work you gave it;
   - the standing constraints of step 4 and step 5 below.
   **Dispatch executors on the cheap model.** Pass `model:` on every `Agent` call in this
   turn, set to the session header's `subagent_model` (default `sonnet`). The judgment this
   turn needs is yours and has already happened on this session's own model by the time you
   dispatch: which areas need work, what the work is, who owns what, what each brief says.
   What's left for an agent is execution against that brief — pick example values consistent
   with the pool you handed it, write the GWT scenarios, render the screen, batch the writes —
   and that does not need the expensive model. A turn nobody asked for is exactly where the
   difference lands on the bill. Keep an agent on this session's model only where its piece
   genuinely re-derives modeling structure rather than filling in detail: a translation
   chain's shape, a slice boundary, anything you'd have wanted to decide yourself if the
   budget allowed.
   **Stay inside the agent budget.** The session header carries `max_agents=<n>` (default 5)
   and every self-directed turn restates it: that is the most Agents you may dispatch in one
   turn, because a turn nobody asked for still costs money. Merge by area first (step 4) —
   that's a correctness rule, not a way to fit the budget — and if more pieces are still left
   than the cap allows, dispatch the most valuable ones and leave the rest; the board doesn't
   forget, and a later turn will see them again. With `max_agents=1`, spawn nothing at all and
   do the single most valuable piece yourself, inline.
   **The decision stays with you.** A subagent is an executor, not a second judge: it carries
   out the piece of work you decided on, on the target you named, and nothing else. It does
   not re-open the question of whether the work is worth doing, does not widen its scope, and
   does not go looking for other things on the board. If it finds the work doesn't apply after
   all — the node already has what you'd add, someone is mid-edit — it reports that back to
   you instead of substituting work of its own, and you decide what happens next.
   Do the work inline yourself only when exactly one candidate survived and it is small (one
   comment, one `/examples` call) — spawning a single agent for a single small thing is pure
   overhead.
4. **Give every agent its own territory — merge before you dispatch, never split a slice.**
   Two agents writing into the same node, chain or slice will clobber each other and the board
   has no merge. So the mapping from step 3 is subject to one rule: candidates that live in
   the same slice or the same chain are handled by **one** agent that owns that whole area,
   with all of their work in its brief, not one agent each. That also keeps a big burst sane —
   work on 30 changed nodes across 4 slices is 4 agents, well inside the default budget. Merge
   first, then prioritize: a candidate is only ever deferred to a later turn because the budget
   ran out, never because it was inconvenient to merge.
5. **Never undo or overwrite human work** — you and every agent you dispatch. You add to the
   board; you don't delete, rename, restructure timelines, or move slice statuses on your own
   initiative. If the right move would be destructive, post a comment saying so instead.
6. **If you already said it, don't say it again.** Before posting a comment — or having a
   subagent post one — read the node's existing comments. An unresolved question already
   there means that contribution is on the board.
7. **Write nothing to disk.** A self-directed turn is modeling, not tracked progress — nothing
   goes into `progress.txt`, and nothing into `.agent-modeling-kit/AGENTS.md` either. You only
   ever get here in a `standalone=on` session, which is ad-hoc: its kit dir is shared across
   every board and nobody reads it afterwards. The board is the only place anything is kept, so
   anything reusable — including what a subagent reported back — goes there, as a comment on the
   node it concerns.
8. Reply `<promise>DONE</promise>`, naming what you dispatched and what each agent did, or —
   when step 2 turned up nothing worth doing — change nothing at all and reply
   `<promise>NOOP</promise>`. A NOOP is a perfectly good outcome, and the CLI widens the gap
   before the next self-directed turn each time you answer one, so a finished board goes
   quiet by itself. Don't manufacture work to avoid a NOOP — but don't reach for one either:
   a NOOP means the fill-in list in step 2 genuinely came up empty, every element that could
   carry examples, specs, attributes or a screen already having them. Someone editing the
   board right now is not a NOOP, and neither is waiting on an answer to something you asked.
   Walk the newest nodes against that list before you answer one.

Keep these turns finished within the turn: wait for the subagents you dispatched, don't leave
work trailing. Everything you and they write to the board comes back on this same channel as
another change. A burst that is *only* your own writes never becomes a turn at all, so a
change list you are handed always contains something that isn't yours — but it may still list
yours alongside it, marked `YOUR OWN earlier write`. Take that mark literally: those lines are
there for context, not to be reworked. A line marked `unattributed, possibly your own earlier
write` is the one uncertain case (a write that reached the platform without an agent id);
anything unmarked was written by someone else and is real work to look at.
