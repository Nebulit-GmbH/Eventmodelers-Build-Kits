# .build-kit

Ralph's runtime directory. Contains the agent loop, board poller, prompts, and Claude skills.

> This is the **react** (API-access) stack — it talks to the board purely through
> the plain REST `slicedata` endpoint on `api.eventmodelers.ai`, polled on an interval.
> There is no Supabase/PocketBase realtime subscription and no direct database table
> access anywhere in this kit. For instant push notifications instead of polling, use
> the `supabase-react` stack.

## Quick start

```bash
# Claude (default)
node .build-kit/ralph-claude.js

# Local Ollama model — run `ollama serve` first
OLLAMA_MODEL=qwen3.5:9b node .build-kit/ralph-ollama.js

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

**Internals** (`lib/`):

| File | Purpose |
|------|---------|
| `lib/ralph.js` | Shared library — board poller + loop logic; imported by the entry points |
| `lib/ollama-agent.js` | Ollama executor — called by `ralph-ollama.js`, can also run manually |
| `lib/agent.sh` | Thin shell wrapper around `claude` — called by `ralph.sh` |
| `lib/prompt.md` | Phase 1 prompt: tells Claude how to load a slice from the board |
| `lib/backend-prompt.md` | Phase 2 prompt: tells Claude how to build a planned slice |
| `lib/AGENT.md` | Agent instructions included in Claude's context |

## How it works

**Phase 1** — triggered when `tasks.json` has entries:
- The poller writes a task to `tasks.json` each time it notices a slice's status changed since the last poll
- The loop picks it up and runs Claude (or Ollama) with `prompt.md`
- Claude loads the slice data and updates `.slices/`

**Phase 2** — triggered when any file in `.slices/` contains `"status": "Planned"`:
- The loop runs Claude with `backend-prompt.md`
- Claude implements the slice in the project
- Phase 2 is Claude-only; Ollama mode skips it (ollama-agent handles its own queue)

Both phases run in a continuous loop with a 3-second idle sleep. The board poller runs concurrently in the same process, re-fetching `slicedata/slices` every `RALPH_POLL_INTERVAL_MS` (default 10s — see `lib/ralph.js`).

## Ollama configuration

```bash
OLLAMA_MODEL=qwen3.5:9b         # model to use (default: qwen3.5:9b)
OLLAMA_URL=http://host:11434   # Ollama server URL (default: http://localhost:11434)
```

## Config

Credentials are stored in `.build-kit/.eventmodelers/config.json` (written by `eventmodelers init`):

```json
{
  "organizationId": "...",
  "boardId": "...",
  "token": "...",
  "baseUrl": "https://api.eventmodelers.ai"
}
```

Claude skills live in `.build-kit/.claude/skills/` and are available inside any Claude Code session started from `.build-kit/`.
