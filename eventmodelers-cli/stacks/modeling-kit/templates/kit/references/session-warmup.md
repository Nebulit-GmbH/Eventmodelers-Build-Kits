# Session warm-up — `SESSION_START`

In a `standalone=on` session the CLI sends one extra turn the moment the process comes up,
before anything has been asked of you. Its first line is `SESSION_START board_id=… organization_id=…`
and it carries the `MODE=modeling` session header. It exists so the setup every turn needs is
already done when the first real turn arrives: nobody waits on `/connect` and a board read while
their prompt sits there.

On that turn, and only that turn:

1. Read this file (your one-time read) and `.agent-modeling-kit/AGENTS.md` if it exists.
   **Don't** read `.agent-modeling-kit/CLAUDE-STANDALONE.md` — that one still waits for the
   first actual self-directed turn.
2. Run `/connect` with the header's `token=`/`org=`/`baseUrl=` and the turn's `board_id`. This
   is the session's one-time connect; step 2 of `CLAUDE-PROMPTS.md` then applies unchanged, which means no later
   turn runs `/connect` again unless the board changed or an API call came back `401`/`403`.
3. Learn **which chapters exist** — one `get_chapter_bounds` gives every chapter's id and title —
   and stop there. Do **not** read any chapter's contents on this turn: a board of a dozen chapters
   read up front is a minute and a dollar spent before anyone has asked for anything, and most of
   what comes back is never used. A chapter is read on the first turn that has business in it (one
   `get_board_outline` — the only read that carries slice statuses; `get_nodes` with `projection: "line"`
   gives just ids, names, types and attribute names) and **kept** from then on — that
   growing set of read chapters is this session's board picture: columns, elements, slice statuses.
   Later turns answer from it instead of re-reading, and refresh only the part a change invalidated.

It is not a prompt turn and not a self-directed one: there is no `prompt_id` (so no
`/update-prompt-status` — the "exactly two calls per turn" rule is about prompt turns), nothing
to sanitize, no learnings, no subagents, and **nothing is written to the board** — no nodes,
no comments, no slice statuses. Reply `<promise>READY</promise>` with a one-line summary of the
board and wait.

A `standalone=off` session gets no `SESSION_START` turn; there the session header rides the first
prompt turn as it always has, and `/connect` happens there.
