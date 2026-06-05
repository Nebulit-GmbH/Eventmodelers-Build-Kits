# .build-kit

Ralph's runtime directory. Contains the agent loop, realtime subscription, prompts, and Claude skills.

## Quick start

```bash
# Claude (default)
node .build-kit/ralph-claude.js

# Local Ollama model — run `ollama serve` first
OLLAMA_MODEL=qwen3:8b node .build-kit/ralph-ollama.js

# Custom project directory (defaults to the parent of .build-kit)
node .build-kit/ralph-claude.js /path/to/project
```

## Files

**Entry points** (top level):

| File | Purpose |
|------|---------|
| `ralph-claude.js` | Runs the full loop using Claude Code as the executor |
| `ralph-ollama.js` | Runs the full loop using a local Ollama model |
| `ralph.sh` | Shell-based loop — alternative to the JS entry points |
| `realtime-agent.js` | Standalone realtime agent — only needed to run it in a separate terminal |

**Internals** (`lib/`):

| File | Purpose |
|------|---------|
| `lib/ralph.js` | Shared library — realtime agent + loop logic; imported by the entry points |
| `lib/ollama-agent.js` | Ollama executor — called by `ralph-ollama.js`, can also run manually |
| `lib/agent.sh` | Thin shell wrapper around `claude` — called by `ralph.sh` |
| `lib/prompt.md` | Phase 1 prompt: tells Claude how to load a slice from the board |
| `lib/backend-prompt.md` | Phase 2 prompt: tells Claude how to build a planned slice |
| `lib/AGENT.md` | Agent instructions included in Claude's context |

## How it works

**Phase 1** — triggered when `tasks.json` has entries:
- The realtime agent writes a task to `tasks.json` each time a `slice:changed` event arrives from the board
- The loop picks it up and runs Claude (or Ollama) with `prompt.md`
- Claude loads the slice data and updates `slices/`

**Phase 2** — triggered when any file in `slices/` contains `"status": "Planned"`:
- The loop runs Claude with `backend-prompt.md`
- Claude implements the slice in the project
- Phase 2 is Claude-only; Ollama mode skips it (ollama-agent handles its own queue)

Both phases run in a continuous loop with a 3-second idle sleep. The realtime agent runs concurrently in the same process.

## Running the realtime agent separately

If you want the board subscription in one terminal and the Claude loop in another:

```bash
# Terminal 1 — realtime agent only
node .build-kit/realtime-agent.js

# Terminal 2 — loop only (poll tasks.json without the realtime subscription)
.build-kit/ralph.sh
```

## Ollama configuration

```bash
OLLAMA_MODEL=qwen3:8b          # model to use (default: qwen3:8b)
OLLAMA_URL=http://host:11434   # Ollama server URL (default: http://localhost:11434)
```

## Config

Credentials are stored in `.build-kit/.eventmodelers/config.json` (written by `ralph-li install`):

```json
{
  "organizationId": "...",
  "boardId": "...",
  "token": "...",
  "baseUrl": "https://api.eventmodelers.ai"
}
```

Claude skills live in `.build-kit/.claude/skills/` and are available inside any Claude Code session started from `.build-kit/`.
