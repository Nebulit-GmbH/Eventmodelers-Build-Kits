This project is **vibe-coded with the event model kept in step**: the code is changed by hand (or with Claude Code), and changes are translated into the event model on the board — they are detected as drift and synced, never left to rot. Only modules that were analysed (`/analyze-code-base`, one chapter at a time) are governed; their analysis log is `.vibe/baseline/`. Start a session with `/start-vibe-session`.

**Before you change any code**, run `{{CLI}} vibe check <the files you are about to change> --json` (find the target code first; with no paths it checks every changed file). Then follow `vibe-control` (`/vibe-control`):

- `governed` — the chapter is analysed and unchanged since: change the code as asked, then translate it (below).
- `drifted` — an earlier change was never translated onto the model: ask whether to translate it first (`vibe-translate`) or carry on.
- `uncovered` — **do not just carry on and do not stop dead: ask the person** — analyse it first (they run `/analyze-code-base` for that chapter themselves; it is an interview), continue without the model this time, or never ask about this folder. Record the answer with `{{CLI}} vibe answer`.
- `free` — not modeled; change it as asked.

**After a change in a governed chapter**, translate the diff onto the board with `vibe-translate`, then `{{CLI}} vibe baseline advance --chapter "<title>"`. The analysis log lives in the baseline file; the board's `Legacy Sources` note is rendered from it (`vibe baseline render`) — never edit the note by hand and never read it back. Nothing is ever written into the source code for this.
