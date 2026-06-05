# @eventmodelers/agent-modeling-kit

Real-time Claude agent + skill kit for the [Eventmodelers](https://eventmodelers.ai) platform.

## Quick start

```bash
npx @eventmodelers/agent-modeling-kit install
```

The installer will prompt for your API token and Organization ID from [app.eventmodelers.ai/account](https://app.eventmodelers.ai/account).

## What gets installed

```
your-project/
├── .agent-modeling-kit/          ← all agent files (created by install)
│   ├── .eventmodelers/
│   │   └── config.json           ← your token + org (gitignored)
│   ├── realtime-agent/           ← Node.js agent (Supabase Realtime)
│   ├── ralph.sh                  ← agent loop
│   └── agent.sh                  ← claude runner
├── .claude/
│   └── skills/                   ← eventmodelers skills for Claude Code
└── CLAUDE.md                     ← agent instructions
```

## Running the agent

Run both in separate terminals from your project root:

```bash
# Terminal 1 — realtime agent (listens for prompts → writes tasks.json)
cd .agent-modeling-kit/realtime-agent && npm run dev

# Terminal 2 — agent loop (reads tasks.json → runs claude in project root)
cd .agent-modeling-kit && ./ralph.sh
```

The loop skips when `tasks.json` is empty. Claude always runs in your project root so it can access your full codebase.

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

## Commands

```bash
npx @eventmodelers/agent-modeling-kit install    # install + configure
npx @eventmodelers/agent-modeling-kit status     # check what's installed
npx @eventmodelers/agent-modeling-kit uninstall  # remove installed files
```

## Contributors

| Contributor | Contribution |
|-------------|-------------|
| [Yordis Pietro](https://github.com/TrogonStack/trogonai) | All `eventmodeling-*` skills |
