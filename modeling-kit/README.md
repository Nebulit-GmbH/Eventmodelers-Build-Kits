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

## Claude execution & config resolution

### Custom Anthropic endpoint / model

During install you can optionally point the agent at a local LLM server (vLLM, Ollama) instead of the default Claude Code endpoint, and/or pin a specific model. The installer shows an arrow-key select:

```
🧠 Configuring Claude execution (optional)...
  ● None — use the default Claude Code endpoint
  ○ Local vLLM   (http://localhost:8000)
  ○ Local Ollama (http://localhost:11434)
  ○ Custom…
```

Pick an option, then optionally enter a model (e.g. `claude-sonnet-5`). Both are stored alongside your credentials in `.agent-modeling-kit/.eventmodelers/config.json`:

```json
{
  "organizationId": "...",
  "token": "...",
  "anthropicBaseUrl": "http://localhost:8000",
  "model": "claude-sonnet-5"
}
```

You can edit this file by hand at any time — `ralph-claude.js` re-reads it on every run. When `anthropicBaseUrl` is set it's exported as `ANTHROPIC_BASE_URL` for the `claude` process; when `model` is set it's passed as `claude --model <model>`. Omit or delete either field to fall back to the default Claude Code setup.

### Hierarchical config resolution

`.eventmodelers/config.json` is resolved by walking from `.agent-modeling-kit/` up through every parent directory, merging fields as it goes:

- A value set by a **closer** (more specific) directory always wins over one set farther up.
- The walk stops as soon as `token`, `organizationId`, and `baseUrl` are all resolved — it won't keep climbing just to find `anthropicBaseUrl`/`model`.
- `anthropicBaseUrl`/`model` are picked up along the way if a directory the walk passes through happens to set them, but they never force the walk to continue further up.

This lets you keep a shared base config higher up the tree (org token, `anthropicBaseUrl`, `model`) while each project only overrides what's specific to it:

```
~/workspace/.eventmodelers/config.json                              ← shared: token, organizationId, anthropicBaseUrl, model
~/workspace/project-a/.agent-modeling-kit/.eventmodelers/config.json  ← project-specific overrides, if any
```

If a project's own config already has everything needed to connect, the walk stops there and the shared config higher up is never read.

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
