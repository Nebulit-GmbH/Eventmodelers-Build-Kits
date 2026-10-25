# Project Configuration

This project can have more than one eventmodelers agent kit installed at once — typically
one backend stack plus the modeling kit, working side by side on the same board. Each
installed kit ships its own CLAUDE.md with that kit's own responsibilities. Check which
of these exist in this project and read whichever are present, following all of them
together:

- `.build-kit/CLAUDE.md` — building this project's backend from board slices
- `.agent-modeling-kit/CLAUDE.md` — designing and updating the event model board itself

Neither is guaranteed to exist — this file is installed once, up front, before either kit
is known to be present.

`.agent-modeling-kit/CLAUDE-PROMPTS.md`, `CLAUDE-CHAT.md`, `CLAUDE-STANDALONE.md` and `references/` are
deliberately *not* in that list: each kind of turn a modeling session gets (a prompt, a chat message, a
self-directed board change) has its steps in its own file, which the agent reads itself when the first turn of
that kind arrives. `CLAUDE-STANDALONE.md` in particular licenses work nobody asked for, which is right for
self-directed turns and wrong everywhere else — leave it alone otherwise.