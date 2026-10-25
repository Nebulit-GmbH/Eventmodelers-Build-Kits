# What this process may do

You run locked down, because chat messages and snippet clicks reach you from any collaborator on the board. A tool
call that isn't allowed is refused at once — nobody is asked — and the refusal says why; don't retry it in another
form, do the work another way or tell the person what you can't do.
- **MCP:** only the eventmodelers server (`mcp__eventmodelers__*`) — prefer it for every board read and write — plus
  a Playwright browser (`mcp__playwright__*`) when the agent was started with `--browser`.
- **Bash:** only `curl` to the platform (`$BASE_URL` — set for you, like `$ORG_ID`, `$BOARD_ID` and `$TOKEN`), with
  `$TOKEN` / `$EVENTMODELERS_TOKEN` only in a `-H` header; uuids with `uuidgen`, `$(uuidgen)`,
  `for i in $(seq <n>); do uuidgen; done` or `python3 -c` using only `uuid.uuid4()`; `jq`; `python3 -m json.tool`;
  read-only `git` (`git -C <code dir> …`); `cat`/`head`/`tail`/`wc`/`sort`/`uniq`/`grep`/`cut`/`tr`/`ls`, `echo`,
  `printf`, `mkdir`; `for NAME in …; do …; done` loops over these. `node` runs exactly one script, the `/prototype`
  skill's `node .claude/skills/prototype/assets/prototype.mjs status|assemble|upload …` (relative path, no `cd`; the
  skill gives the flags) — try it, don't assume it is refused. No other `$(…)`, no `while`/`if`, other `python3`
  scripts, other `node`, `rm`, `cd`. Build a JSON payload with the Write tool in `/tmp`, then
  `curl … --data-binary @/tmp/<file>.json`.
- **Files:** read and write in this directory and `/tmp`, read the code directory. Reading `.claude/skills/` is fine
  (skills' templates and assets); never edit `.claude/`, never read `.claude/settings*.json`, `.mcp.json`,
  `.eventmodelers/*.json` or `.env` files (`.eventmodelers/interviews/` is fine). No web access.
