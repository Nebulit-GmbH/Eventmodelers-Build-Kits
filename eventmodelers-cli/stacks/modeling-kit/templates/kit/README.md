# .agent-modeling-kit

Ralph's runtime directory for modeling-only projects — skills + agent loop, no backend scaffold.

## Quick start

```bash
# Claude (default)
node .agent-modeling-kit/ralph-claude.js

# Local Ollama model — run `ollama serve` first
OLLAMA_MODEL=qwen3.5:9b node .agent-modeling-kit/ralph-ollama.js

# Bash-only loop (no realtime)
.agent-modeling-kit/ralph.sh

# Custom project directory (defaults to the parent of .agent-modeling-kit)
node .agent-modeling-kit/ralph-claude.js /path/to/project
```

## Files

**Entry points** (top level):

| File | Purpose |
|------|---------|
| `ralph-claude.js` | Runs the task loop using Claude Code as the executor |
| `ralph-ollama.js` | Runs the task loop using a local Ollama model |
| `ralph.sh` | Shell-based loop — alternative to the JS entry points |
| `realtime-agent.js` | Standalone realtime agent — only needed to run it in a separate terminal |

**Internals** (`lib/`):

| File | Purpose |
|------|---------|
| `lib/ralph.js` | Shared library — realtime agent + task loop; imported by the entry points |
| `lib/ollama-agent.js` | Ollama executor — called by `ralph-ollama.js`, can also run manually |
| `lib/agent.sh` | Thin shell wrapper around `claude` — called by `ralph.sh` |

## How it works

Modeling-only mode is a single phase: whenever `tasks.json` has entries, the loop runs
Claude (or Ollama) against the task, following the instructions in the project root
`CLAUDE.md` — read `.agent-modeling-kit/tasks.json`, pick the highest-priority task, run
the matching skill (`/timeline`, `/place-element`, `/storyboard`, ...), then remove the
completed task. There is no build-a-slice-into-code phase — that's what the backend
stacks (`node`, `supabase`, `axon`, `cratis-csharp`) add on top of this.

## Running the realtime agent separately

```bash
# Terminal 1 — realtime agent only
node .agent-modeling-kit/realtime-agent.js

# Terminal 2 — loop only (poll tasks.json without the realtime subscription)
.agent-modeling-kit/ralph.sh
```

## Ollama configuration

```bash
OLLAMA_MODEL=qwen3.5:9b         # model to use (default: qwen3.5:9b)
OLLAMA_URL=http://host:11434   # Ollama server URL (default: http://localhost:11434)
```

## Config

Credentials are stored in `.agent-modeling-kit/.eventmodelers/config.json` (written by `eventmodelers init-modeling`):

```json
{
  "organizationId": "...",
  "boardId": "...",
  "token": "...",
  "baseUrl": "https://api.eventmodelers.ai"
}
```

Claude skills live in `.claude/skills/` and are available inside any Claude Code session started from the project root.
