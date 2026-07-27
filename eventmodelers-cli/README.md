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
```

`init-modeling` isn't a stack — it's the option for when you don't want a backend scaffolded at all, just the skills and the agent loop.

The installer prompts for your API token, Organization ID (and Board ID, for the four backend stacks) from [app.eventmodelers.ai/account](https://app.eventmodelers.ai/account).

## What gets installed

```
your-project/
├── .build-kit/                    ← agent runner (name is .agent-modeling-kit/ for the modeling-kit stack)
│   ├── .eventmodelers/
│   │   └── config.json            ← your token + org/board (gitignored)
│   ├── ralph-claude.js            ← realtime agent + task loop
│   ├── ralph-ollama.js            ← same, via local Ollama
│   ├── ralph.sh                   ← bash-only loop (no realtime)
│   └── lib/                       ← stack-specific agent prompts + helpers
├── .claude/
│   └── skills/                    ← eventmodelers skills for Claude Code
├── src/ … (or the stack's own layout)
└── CLAUDE.md                      ← agent instructions
```

The four backend stacks (`node`, `supabase`, `axon`, `cratis-csharp`) also scaffold a real project skeleton into your project root (`templates/root/`) — source layout, build files, migrations, etc. `modeling-kit` only installs skills + the agent loop, with no backend opinion.

### Installing skills globally

By default, skills are copied into the project's own `.claude/skills/`. Pass `--global` to `init` or `init-modeling` to install them into `~/.claude/skills/` instead — available in every project without re-running the installer each time:

```bash
npx @eventmodelers/cli init-modeling --global
```

Everything else (the kit dir, project scaffold, credentials, MCP registration) still targets the current directory as usual — `--global` only changes where skills land.

## Claude execution & config resolution

During install you can optionally point the agent at a local LLM server (vLLM, Ollama) instead of the default Claude Code endpoint, and/or pin a specific model:

```
🧠 Configuring Claude execution (optional)...
  ● None — use the default Claude Code endpoint
  ○ Local vLLM   (http://localhost:8000)
  ○ Local Ollama (http://localhost:11434)
  ○ Custom…
```

Both are stored alongside your credentials in `<kit-dir>/.eventmodelers/config.json`:

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

`init`, `status`, and `config` all resolve config the same way: they walk up from the project root looking for a `.eventmodelers/config.json` in a parent directory (shared defaults), then layer the kit dir's own `<kit-dir>/.eventmodelers/config.json` on top (project-specific overrides) — any field the project config also sets wins.

This means you can keep one shared config above all your checkouts and only override what's actually per-project — typically just `boardId`:

```
~/.eventmodelers/config.json                                    ← shared: organizationId, token, baseUrl
~/projects/checkout-app/.build-kit/.eventmodelers/config.json    ← { "boardId": "<checkout-app-board>" }
~/projects/billing-app/.build-kit/.eventmodelers/config.json     ← { "boardId": "<billing-app-board>" }
```

Running any command from inside `~/projects/checkout-app` resolves `organizationId`/`token`/`baseUrl` from `~/.eventmodelers/config.json` and `boardId` from the project's own file — switch to `~/projects/billing-app` and only the board changes. `npx @eventmodelers/cli status` and `npx @eventmodelers/cli config` both list every file that contributed, in override order, so you can see exactly where each value came from.

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

`--config <path>` points every command at an explicit `config.json`, bypassing the kit-dir/parent-directory resolution entirely:

```bash
npx @eventmodelers/cli --config ../shared/config.json status
```

Run `npx @eventmodelers/cli config` at any time to see the fully resolved config (file + env overrides merged, token masked).

### MCP for other harnesses

The installer always writes the MCP server into `.claude/settings.json` for Claude Code. For other coding agents it follows the same principle [Playwright MCP](https://playwright.dev/mcp/installation) uses per client — one shared server, but a different registration mechanism per harness: a real CLI install command where one exists, and printed manual steps where it doesn't (no risky guessing at unverified config-file formats):

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
| `/place-element` | Place commands/events/read models on the board |
| `/learn-eventmodelers-api` | Full API reference for agent use |
| `/attributes` | Add/rename attributes across a chain of elements |
| `/examples` | Add example data to element fields |
| `/update-slice-status` | Update slice status on the board |
| `/load-slice` | Persist board slices to disk (backend stacks) |
| `/build-state-change`, `/build-state-view`, `/build-automation`, `/build-webhook` | Implement a slice's command/view/automation/webhook (backend stacks) |

Which skills install depends on the chosen stack — see `stacks/<name>/templates/.claude/skills/`.

## Commands

```bash
npx @eventmodelers/cli init --stack <name>   # scaffold a stack + install + configure (alias: install)
npx @eventmodelers/cli init-modeling         # skills + agent loop only, no backend scaffold (alias: modeling)
npx @eventmodelers/cli run                   # start the agent loop (ralph-claude.js) from the installed kit dir
npx @eventmodelers/cli run --ollama          # same, via local Ollama (ralph-ollama.js)
npx @eventmodelers/cli run --bash            # bash-only loop, no realtime (ralph.sh)
npx @eventmodelers/cli stacks                # list available stacks
npx @eventmodelers/cli status                # check what's installed
npx @eventmodelers/cli config                # print the fully resolved config (file + env), token masked
npx @eventmodelers/cli uninstall             # remove the installed kit dir
```

`run` is a thin dispatcher — it just finds the installed kit dir (whatever it's named for the stack) and execs the runner file already sitting in it. The agent loop's actual logic stays in the scaffolded `<kit-dir>/`, not in this package, since you (and the agent itself, via `AGENT.md`) may customize those files per project.

`--config <path>` and `--print` are global flags accepted by every command. `--print` skips the "connect MCP globally?" prompt during install and just prints the `claude mcp add` command instead of running it — combined with the env vars above, `--print` makes `init` fully non-interactive:

```bash
EVENTMODELERS_ORGANIZATION_ID=... EVENTMODELERS_BOARD_ID=... EVENTMODELERS_TOKEN=... \
  npx @eventmodelers/cli --print init --stack node
```

## Adding a stack

Each stack lives under `stacks/<name>/templates/` with `.claude/` (skills), `root/` (spread into the project root), and either `build-kit/` (backend stacks) or `kit/` (modeling-only) for the agent runner. Files identical across all backend stacks live once in `shared/build-kit/` and get layered in automatically — only put stack-specific overrides under `stacks/<name>/templates/build-kit/`.

## Contributors

| Contributor | Contribution |
|-------------|-------------|
| [Yordis Pietro](https://github.com/TrogonStack/trogonai) | All `eventmodeling-*` skills |