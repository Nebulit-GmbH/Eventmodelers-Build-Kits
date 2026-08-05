# @eventmodelers/cli

One CLI, real-time Claude agent, and skill kit for the [Eventmodelers](https://eventmodelers.ai) platform — pick a stack, scaffold it, connect it to a board.

## Quick start

```bash
npx @eventmodelers/cli init
```

Running without `--stack` shows an arrow-key picker. Or go straight to a stack:

```bash
npx @eventmodelers/cli init --stack node            # Node.js / TypeScript
npx @eventmodelers/cli init --stack supabase         # Supabase
npx @eventmodelers/cli init --stack axon             # Axon Framework (Java/Kotlin)
npx @eventmodelers/cli init --stack cratis-csharp    # Cratis (.NET/C#)
npx @eventmodelers/cli init-modeling                 # skills + agent loop only, no backend scaffold
npx @eventmodelers/cli init --build-kit              # blank build-kit scaffold for a stack not built into this CLI yet
```

`init-modeling` isn't a stack — it's the option for when you don't want a backend scaffolded at all, just the skills and the agent loop. `init --build-kit` isn't one of the four either — it installs the same `.build-kit/` + skills shape as a real stack, but with TODO-marked placeholders instead of real content, for integrating a stack this CLI doesn't support yet (see "Adding a stack" below).

The installer prompts for your API token, Organization ID (and Board ID, for the four backend stacks) from [app.eventmodelers.ai/account](https://app.eventmodelers.ai/account).

`init`/`init-modeling` scaffold and configure credentials, but don't register the MCP server — run that as a separate step once you're ready to connect a harness:

```bash
npx @eventmodelers/cli init-mcp
```

## What gets installed

```
your-project/
├── .eventmodelers/
│   └── config.json                ← your token + org/board (gitignored) — shared by every kit in this project
├── .build-kit/                    ← agent runner (name is .agent-modeling-kit/ for the modeling-kit stack)
│   ├── ralph-claude.js            ← realtime agent + task loop
│   ├── ralph-ollama.js            ← same, via local Ollama
│   ├── ralph.sh                   ← bash-only loop (no realtime)
│   └── lib/                       ← stack-specific agent prompts + helpers
├── .claude/
│   └── skills/                    ← eventmodelers skills for Claude Code
├── src/ … (or the stack's own layout)
└── CLAUDE.md                      ← agent instructions
```

Installing both a build stack and `init-modeling` into the same project reuses this one `.eventmodelers/config.json` — run whichever `init` command second and it finds the existing config already satisfies the required fields and skips straight past the credential prompt.

The four backend stacks (`node`, `supabase`, `axon`, `cratis-csharp`) also scaffold a real project skeleton into your project root (`templates/root/`) — source layout, build files, migrations, etc. `modeling-kit` only installs skills + the agent loop, with no backend opinion.

### Installing skills globally

By default, skills are copied into the project's own `.claude/skills/`. Pass `--global` to `init` or `init-modeling` to install them into `~/.claude/skills/` instead — available in every project without re-running the installer each time:

```bash
npx @eventmodelers/cli init-modeling --global
```

Everything else (the kit dir, project scaffold, credentials, MCP registration) still targets the current directory as usual — `--global` only changes where skills land.

## Bridging to another spec framework

If you drive development with a different spec/task framework (Spec Kitty today; more later) instead of build-kit's own code generation, a **bridge** kit keeps that framework's artifacts in sync with the board instead of writing application code:

```bash
npx @eventmodelers/cli init --bridge --target spec-kitty
npx @eventmodelers/cli bridge
```

`init --bridge` installs a `.bridge-kit/` (mirrors `.build-kit/`'s realtime + task-queue loop) plus only the skills for the chosen `--target` (`shared/bridge/<target>/`) — a `spec-kitty` bridge never installs Kiro's skills, and vice versa. `bridge` starts the loop: on every board slice change (not just "Planned", unlike build-kit), it regenerates that framework's spec artifacts from the current board state. It doesn't build code and doesn't claim slices.

For `spec-kitty`, that sync is deterministic and stops well short of writing Spec Kitty's own artifacts — `lib/adapters/spec-kitty-adapter.js` fetches full slice detail and restates it as a plain markdown mission brief (one section per slice, its scenarios verbatim, nothing invented), then calls `spec-kitty intake --force` to install it at `.kittify/mission-brief.md`. It deliberately doesn't create the mission, write `spec.md`, or author work packages — Spec Kitty's own `/spec-kitty.specify` → `/spec-kitty.plan` → `/spec-kitty.tasks` pipeline does that, because those steps need real judgment (work package boundaries, which files a WP owns, which agent profile fits) that only makes sense with actual codebase context, which this adapter doesn't have. What it replaces is Spec Kitty's *interactive discovery interview*: `/spec-kitty.specify`'s own "Brief Context Detection" step reads `.kittify/mission-brief.md` when present and extracts requirements from it instead of asking the user, so the event model — not a live Q&A — becomes the input. No LLM call happens in this adapter's own path, and `bridge` picks it automatically whenever a target has one (`--claude` forces the Claude runner instead). Targets without a static adapter yet fall back to Claude re-running `bridge-<target>-specify`; pass `--ollama` for the local-Ollama runner instead (same caveat as build-kit's `--ollama`: `lib/ollama-agent.js` is shared as-is).

Don't want the standing loop at all? `fetch` can call the same adapter for a single one-shot sync, no `.bridge-kit/` install required:

```bash
npx @eventmodelers/cli fetch --context Ticketing --spec-kitty
```

Either way, `spec-kitty init` (Spec Kitty's own project setup) has to have already been run in the project root — the adapter checks for `.kittify/` first and stops with the exact command to run if it's missing, rather than failing deep inside a cryptic `spec-kitty` CLI error. After the sync, run `/spec-kitty.specify` in your coding agent to turn the brief into an actual mission (the plain `spec-kitty specify` CLI command only scaffolds — brief detection is in the agent-driven prompt).

### Overriding the executor with a hook

Claude is only the default — some teams don't want an AI agent in this loop at all, e.g. they'd rather just commit + push the board export and let a CI pipeline own the actual translation. `--hook` replaces the AI executor with an arbitrary shell command, run once per batch of slice changes:

```bash
npx @eventmodelers/cli init --bridge --target spec-kitty --hook "git add .slices && git commit -m sync && git push"
npx @eventmodelers/cli bridge
```

`init --bridge --hook` persists the command to `.bridge-kit/bridge.json` — a plain, **committed** file (unlike `.eventmodelers/config.json`, which is gitignored for credentials) since the hook is project policy meant to be shared by every teammate and CI runner, not per-machine state. `bridge --hook "<command>"` overrides it for a single run without touching that file. Only one executor runs per invocation — `--ollama`, `--hook`, and `--claude` are mutually exclusive.

The hook command runs with `BRIDGE_TASK_COUNT`, `BRIDGE_SLICE_ID`/`_TITLE`/`_STATUS` (the most recent change in the batch), and `BRIDGE_BATCH_FILE` (path to the full batch as JSON) in its environment. It's invoked once per batch, not once per slice — any change that arrives while the hook is still running is left queued for the next batch rather than dropped.

## Claude execution & config resolution

During install you can optionally point the agent at a local LLM server (vLLM, Ollama) instead of the default Claude Code endpoint, and/or pin a specific model:

```
🧠 Configuring Claude execution (optional)...
  ● None — use the default Claude Code endpoint
  ○ Local vLLM   (http://localhost:8000)
  ○ Local Ollama (http://localhost:11434)
  ○ Custom…
```

Both are stored alongside your credentials in the project root's `.eventmodelers/config.json`:

```json
{
  "organizationId": "...",
  "boardId": "...",
  "token": "...",
  "anthropicBaseUrl": "http://localhost:8000",
  "model": "claude-sonnet-5"
}
```

Beyond the one-time install bootstrap, each stack's own `ralph.js`/`ralph-claude.js` governs how config is re-read at runtime — check `<kit-dir>/lib/` for the specifics of the stack you installed.

### Hierarchical config resolution

`init`/`init-modeling` write credentials to the project root's `.eventmodelers/config.json` by default — that's why a build stack and `init-modeling` in the same project automatically share one file instead of each holding their own copy.

`init`, `status`, and `config` all resolve config the same way: they walk up from the current directory looking for a `.eventmodelers/config.json` in an ancestor directory (shared defaults), then layer the installed kit dir's own `<kit-dir>/.eventmodelers/config.json` on top, if one exists there (a per-kit override) — any field that file also sets wins. If that walk reaches the filesystem root without finding anything, `~/.eventmodelers/config.json` is checked once more as a last resort — this matters for projects that don't live under `$HOME` at all (e.g. `/tmp/foo`), which the walk-up would otherwise never reach.

That walk-up (plus the home-dir fallback) means you can keep one shared config above all your checkouts and only override what's actually per-project — typically just `boardId`. The easiest way to set that shared file up is:

```bash
npx @eventmodelers/cli init-config --global   # writes organizationId + token to ~/.eventmodelers/config.json
```

```
~/.eventmodelers/config.json                                    ← shared: organizationId, token
~/projects/checkout-app/.eventmodelers/config.json               ← { "boardId": "<checkout-app-board>" }
~/projects/billing-app/.eventmodelers/config.json                ← { "boardId": "<billing-app-board>" }
```

Running any command from inside `~/projects/checkout-app` resolves `organizationId`/`token` from `~/.eventmodelers/config.json` (`baseUrl` defaults to `https://api.eventmodelers.ai` if nobody sets it) and `boardId` from the project's own file — switch to `~/projects/billing-app` and only the board changes. `npx @eventmodelers/cli status` and `npx @eventmodelers/cli config` both list every file that contributed, in override order, so you can see exactly where each value came from.

`init-config` (without `--global`) is the same credential-only flow targeted at the current directory — useful when you want to (re)configure credentials without re-running a full `init`/`init-modeling` install:

```bash
npx @eventmodelers/cli init-config                      # interactive, writes to ./.eventmodelers/config.json
npx @eventmodelers/cli init-config --board-id <uuid>     # non-interactive, just overrides one field
```

### Env vars and `--config` (scripted/CI installs)

Every config field can be set via an `EVENTMODELERS_*` env var instead of the interactive prompts — these always win over whatever's in `config.json`, so a fully env-driven install never prompts for credentials or Claude execution settings:

| Env var | Config field |
|---------|--------------|
| `EVENTMODELERS_ORGANIZATION_ID` | `organizationId` |
| `EVENTMODELERS_BOARD_ID` | `boardId` |
| `EVENTMODELERS_TOKEN` | `token` |
| `EVENTMODELERS_BASE_URL` | `baseUrl` |
| `EVENTMODELERS_ANTHROPIC_BASE_URL` | `anthropicBaseUrl` |
| `EVENTMODELERS_MODEL` | `model` |

```bash
EVENTMODELERS_ORGANIZATION_ID=... EVENTMODELERS_BOARD_ID=... EVENTMODELERS_TOKEN=... \
  npx @eventmodelers/cli init --stack node
```

`init`, `init-modeling`, and `init-config` also accept the same four fields as direct flags — handy for a one-off override without exporting env vars, and they win over both the config file and env vars:

```bash
npx @eventmodelers/cli init --stack node \
  --organization-id ... --board-id ... --token ... --base-url https://api.eventmodelers.ai
```

`--config <path>` points every command at an explicit `config.json`, bypassing the kit-dir/parent-directory resolution entirely:

```bash
npx @eventmodelers/cli --config ../shared/config.json status
```

Run `npx @eventmodelers/cli config` at any time to see the fully resolved config (file + env overrides merged, token masked).

### MCP for other harnesses

MCP registration is a separate step from `init`/`init-modeling` — run `init-mcp` whenever you're ready to connect a harness:

```bash
npx @eventmodelers/cli init-mcp
```

It writes the MCP server into `.claude/settings.json` for Claude Code. For other coding agents it follows the same principle [Playwright MCP](https://playwright.dev/mcp/installation) uses per client — one shared server, but a different registration mechanism per harness: a real CLI install command where one exists, and printed manual steps where it doesn't (no risky guessing at unverified config-file formats):

```
? Connect the MCP globally to another harness?
  ● Skip
  ○ Claude Code   claude mcp add eventmodelers --transport http <url>
  ○ VS Code       code --add-mcp '{"name":"eventmodelers","type":"http","url":"<url>"}'
```

Cursor and Windsurf don't have a safe scriptable install, so the installer prints their manual setup steps instead of writing anything. Pass `--print` to always print every harness's command/steps instead of prompting.

## Skills

Use skills in Claude Code with `/skill-name`:

| Skill | Description |
|-------|-------------|
| `/connect` | Set up board connection |
| `/timeline` | Live event storming facilitator |
| `/wdyt` | Business analyst review of your event model |
| `/storyboard` | Build a full visual storyboard |
| `/storyboard-screen` | Design individual wireframe screens |
| `/html-screen` | Design individual real HTML/CSS screens (explicit request only) |
| `/place-element` | Place commands/events/read models on the board |
| `/learn-eventmodelers-api` | Full API reference for agent use |
| `/attributes` | Add/rename attributes across a chain of elements |
| `/examples` | Add example data to element fields |
| `/update-slice-status` | Update slice status on the board |
| `/load-slice` | Persist board slices to disk (backend stacks) |
| `/build-state-change`, `/build-state-view`, `/build-automation`, `/build-webhook` | Implement a slice's command/view/automation/webhook (backend stacks) |

Which skills install depends on the chosen stack — see `stacks/<name>/templates/.claude/skills/`. `/connect`, `/learn-eventmodelers-api`, and `/update-slice-status` have no stack-specific content and install into every stack from `shared/skills/` instead.

## Commands

```bash
npx @eventmodelers/cli init --stack <name>          # scaffold a stack + install + configure (alias: install)
npx @eventmodelers/cli init --stack <name> --global # same, but skills go to ~/.claude/skills/ (every project)
npx @eventmodelers/cli init-modeling                # skills + agent loop only, no backend scaffold (alias: modeling)
npx @eventmodelers/cli init-modeling --global       # same, but skills go to ~/.claude/skills/ (every project)
npx @eventmodelers/cli init --build-kit             # blank build-kit scaffold (TODO placeholders) for a stack not built into this CLI yet
npx @eventmodelers/cli init-mcp                     # register the MCP server in .claude/settings.json (+ optionally another harness)
npx @eventmodelers/cli init-config                  # credentials only, no scaffold — writes ./.eventmodelers/config.json
npx @eventmodelers/cli init-config --global         # same, but writes organizationId + token to ~/.eventmodelers/config.json
npx @eventmodelers/cli run                          # start the agent loop (ralph-claude.js) from the installed kit dir
npx @eventmodelers/cli run --ollama                 # same, via local Ollama (ralph-ollama.js)
npx @eventmodelers/cli run --bash                   # bash-only loop, no realtime (ralph.sh)
npx @eventmodelers/cli listen                       # start the code-export listener (code-export.mjs) from the installed kit dir
npx @eventmodelers/cli listen --port 4000           # same, on a different port
npx @eventmodelers/cli fetch --context <name>                     # pull full slice detail for one context on the board into <kit-dir>/.slices/ (project root if no kit, or a modeling-kit, is installed)
npx @eventmodelers/cli fetch --context <name> --slice-id <id>     # same, then print just that slice
npx @eventmodelers/cli fetch --context <name> --slice-title <title> # same, then print just the slice matching this title
npx @eventmodelers/cli stacks                       # list available stacks
npx @eventmodelers/cli status                       # check what's installed
npx @eventmodelers/cli config                       # print the fully resolved config (file + env), token masked
npx @eventmodelers/cli uninstall                    # remove everything init/init-modeling installed
```

`run` is a thin dispatcher — it just finds the installed kit dir (whatever it's named for the stack) and execs the runner file already sitting in it. The agent loop's actual logic stays in the scaffolded `<kit-dir>/`, not in this package, since you (and the agent itself, via `AGENT.md`) may customize those files per project.

`listen` is the same kind of dispatcher, but for `<kit-dir>/code-export.mjs` — a local HTTP server (port 3001 by default) that the eventmodelers board UI posts slice/screen data to, which then gets written under `<kit-dir>/.slices/`.

`fetch` is the pull-based counterpart to `listen`: instead of waiting for the board UI to push data to a running listener, it calls `slicedata?contextName=<name>` for the required `--context` (full slice detail — commands/events/readmodels/screens/processors/specifications/comments), and writes the same `.slices/<context>/<slice>/slice.json`, `index.json`, and `context.json` layout — useful in CI or any context where nothing is listening on a port. It does not fetch screen images (those only arrive via `listen`'s push). Unlike every other command, `fetch` also works with no kit installed at all — it only needs credentials, not kit-specific files — and, unique to modeling-kit, writes `.slices/` to the project root instead of nesting it under `.agent-modeling-kit/`, since nothing reads it from there (modeling-kit has no `code-export.mjs`/`listen`). If credentials are missing, it prompts the same way `init-config` does. `--slice-id`/`--slice-title` still fetch and persist the whole context, then just print the one slice you asked about.

### Uninstall

Every `init`/`init-modeling` run writes an install manifest into `<kit-dir>/.eventmodelers/install-manifest.json` recording exactly what it put down. `uninstall` reads that manifest back and removes only:

- the kit dir (`.build-kit/` or `.agent-modeling-kit/`)
- the skills it copied — from `.claude/skills/` normally, or `~/.claude/skills/` if it was installed with `--global`
- the `eventmodelers` entry it added to `.claude/settings.json`'s `mcpServers`, if `init-mcp` was ever run for this project (the rest of that file, and the file itself, is left in place)

It deliberately **never** touches the root project scaffold (`package.json`, `src/`, `server.ts`, migrations, `docker-compose.yml`, etc.) — that's your actual application code, not tooling, so `uninstall` won't delete it even though `init` wrote it.

If a kit dir predates this tracking (no manifest present), `uninstall` falls back to only removing the kit dir itself and tells you so — any skills or MCP registration from that older install need to be cleaned up by hand.

Registering the MCP server with another harness (`claude mcp add`, `code --add-mcp`, or the manual Cursor/Windsurf steps) happens outside this project's files, so `uninstall` doesn't attempt to undo it — remove it yourself in that harness if you connected one.

```bash
npx @eventmodelers/cli uninstall                    # remove the one installed kit dir (errors if more than one is present)
npx @eventmodelers/cli uninstall --build-kit         # remove .build-kit/ specifically
npx @eventmodelers/cli uninstall --modeling-kit      # remove .agent-modeling-kit/ specifically
```

`--config <path>` and `--print` are global flags accepted by every command. `--print` skips the "connect MCP globally?" prompt during `init-mcp` and just prints the `claude mcp add` command instead of running it — combined with the env vars or direct flags above, `--print` makes both `init` and `init-mcp` fully non-interactive:

```bash
EVENTMODELERS_ORGANIZATION_ID=... EVENTMODELERS_BOARD_ID=... EVENTMODELERS_TOKEN=... \
  npx @eventmodelers/cli --print init --stack node
```

## Adding a stack

Each stack lives under `stacks/<name>/templates/` with `.claude/` (skills), `root/` (spread into the project root), and either `build-kit/` (backend stacks) or `kit/` (modeling-only) for the agent runner. Files identical across all backend stacks live once in `shared/build-kit/` and get layered in automatically — only put stack-specific overrides under `stacks/<name>/templates/build-kit/`. Skills with no stack-specific content (`connect`, `learn-eventmodelers-api`, `update-slice-status`) work the same way via `shared/skills/` — a new stack gets them for free without copying anything; add a skill there only once it needs a stack-specific fork.

`init --build-kit` (see above) installs exactly that layout into a real project — `.build-kit/CLAUDE.md`, `lib/prompt.md`, `lib/backend-prompt.md`, and `.claude/skills/build-{state-change,state-view,automation}/SKILL.md` — but with TODO-marked placeholders instead of real content, since there's no fixed backend to generate them from. Fill in the TODOs against the actual stack you're integrating (build/test commands, file layout, framework idioms) while building something real with it. Once it works, promote it to a first-class stack:

1. Copy `.build-kit/` → `stacks/<name>/templates/build-kit/`, `.claude/skills/build-*` → `stacks/<name>/templates/.claude/skills/`, and whatever `root/` scaffold you built → `stacks/<name>/templates/root/`.
2. Add an entry for `<name>` to the `STACKS` object in `cli.js` (`label`, `kitSubdir: 'build-kit'`, `kitDirName: '.build-kit'`, `useShared: true`, `needsBoardId: true`).
3. Add it to this README's stack list, the "What gets installed" section, and the `stacks` command's output (generated from `STACKS`, so nothing to add there beyond the entry itself).

## Contributors

| Contributor | Contribution |
|-------------|-------------|
| [Yordis Pietro](https://github.com/TrogonStack/trogonai) | All `eventmodeling-*` skills |