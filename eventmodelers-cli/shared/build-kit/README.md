# .build-kit

Ralph's runtime directory. Contains the agent loop, realtime subscription, prompts, and Claude skills.

## Quick start

```bash
# Claude (default)
node .build-kit/ralph-claude.js

# Local or self-hosted model — Ollama (run `ollama serve` first)
LOCAL_AI_TARGET=ollama node .build-kit/ralph-local-ai.js

# …or any OpenAI-compatible server (vLLM, LM Studio, llama.cpp, TGI)
LOCAL_AI_TARGET=vllm LOCAL_AI_MODEL=Qwen/Qwen3-8B node .build-kit/ralph-local-ai.js

# Custom project directory (defaults to the parent of .build-kit)
node .build-kit/ralph-claude.js /path/to/project
```

## Files

**Entry points** (top level):

| File | Purpose |
|------|---------|
| `ralph-claude.js` | Runs the full loop using Claude Code as the executor |
| `ralph-local-ai.js` | Runs the full loop using a local/self-hosted model (Ollama, vLLM, LM Studio, llama.cpp) |
| `ralph-exec.js` | Runs the full loop handing each prompt to an external agent command (Codex CLI, OpenCode, …) |
| `ralph.sh` | Shell-based loop — alternative to the JS entry points |
| `realtime-agent.js` | Standalone realtime agent — only needed to run it in a separate terminal |

**Internals** (`lib/`):

| File | Purpose |
|------|---------|
| `lib/ralph.js` | Shared library — realtime agent + loop logic; imported by the entry points |
| `lib/local-ai-agent.js` | Local-AI executor — called by `ralph-local-ai.js`, can also run manually |
| `lib/agent.sh` | Thin shell wrapper around `claude` — called by `ralph.sh` |
| `lib/prompt.md` | Phase 1 prompt: tells Claude how to load a slice from the board |
| `lib/backend-prompt.md` | Phase 2 prompt: tells Claude how to build a planned slice |
| `lib/AGENT.md` | Agent instructions included in Claude's context |

## How it works

**Phase 1** — triggered when `tasks.json` has entries:
- The realtime agent writes a task to `tasks.json` each time a `slice:changed` event arrives from the board
- The loop picks it up and runs Claude (or a local model) with `prompt.md`
- Claude loads the slice data and updates `.slices/`

**Phase 2** — triggered when any file in `.slices/` contains `"status": "Planned"`:
- The loop runs Claude with `backend-prompt.md`
- Claude implements the slice in the project
- Phase 2 (building slices) never runs with `--local-ai` — see *`--local-ai` does not build code*. Build with `--exec` instead

Both phases run in a continuous loop with a 3-second idle sleep. The realtime agent runs concurrently in the same process.

## Running the realtime agent separately

If you want the board subscription in one terminal and the Claude loop in another:

```bash
# Terminal 1 — realtime agent only
node .build-kit/realtime-agent.js

# Terminal 2 — loop only (poll tasks.json without the realtime subscription)
.build-kit/ralph.sh
```

## Local-AI configuration

`ralph-local-ai.js` drives any local or self-hosted model that can do tool calling.
Claude (`ralph-claude.js`) stays the default runner — this is opt-in.

### `--local-ai` does not build code

**`--local-ai` works on the board only. It never builds a slice.** Planned slices stay
Planned. That is by design, not a bug:

- **Planned slices are never handed to it.** `ralph-local-ai.js` gives `startRalph` no
  `onPlannedSlice`, so the loop only feeds it `tasks.json` prompts.
- **It has no coding tools.** `lib/local-ai-agent.js` exposes only the board MCP tools:
  no file read/write, no shell, no git, no test run.
- **Its system prompt forbids file and shell access.** Such a request is answered with
  `Blocked: …`.
- **A prompt stops after 12 tool-call rounds.** That is enough for board edits, but far
  short of a slice build.

Here the kit is the agent loop and the model only picks tools. Building would mean
rewriting a full coding agent inside the kit, so it is left out on purpose.

**To build with a local model, use `--exec`** with a coding harness pointed at that model
(see *External agent commands* below):

```bash
npx @eventmodelers/cli run --exec "codex exec --oss --json --full-auto"   # Codex on local Ollama
npx @eventmodelers/cli run --exec "opencode run --auto --format json"     # OpenCode, with an Ollama/vLLM/LM Studio provider in its config
```

Or keep Claude Code as the builder and point `anthropicBaseUrl` at a local endpoint that
speaks the Anthropic API.

```bash
LOCAL_AI_TARGET=ollama          # preset: ollama | vllm | lmstudio | llamacpp
LOCAL_AI_URL=http://host:8000/v1  # any OpenAI-compatible server (overrides the preset URL)
LOCAL_AI_MODEL=qwen3.5:9b       # model name as the server knows it
LOCAL_AI_API=openai             # force the wire dialect: ollama | openai (normally inferred)
LOCAL_AI_API_KEY=local          # sent as `Authorization: Bearer` on the openai dialect
LOCAL_AI_NUM_CTX=32768          # ollama only — context window (default 32768)
```

**Do not lower `LOCAL_AI_NUM_CTX`.** The MCP tool schemas are ~16k tokens on their own.
Ollama's own default is 4096, which silently truncates them — the model then sees a
fragment of the tool list and invents tool names instead of failing, which is why the
default here is raised rather than left to the server. On the `openai` dialect the
equivalent is set when you launch the server (vLLM `--max-model-len 32768`,
llama.cpp `-c 32768`); an overflow there surfaces as an HTTP 400.


## External agent commands (`--exec`)

Agentic harnesses that bring their own tool loop — Codex CLI, OpenCode, Gemini CLI —
are not `--local-ai` targets: `--local-ai` *supplies* the agent loop, while a harness
already is one and only wants a prompt. They go through `ralph-exec.js` instead:

```bash
npx @eventmodelers/cli run --exec "codex exec --full-auto"
npx @eventmodelers/cli run --exec "opencode run"

# …or persist it and use the bare flag
RALPH_EXEC_CMD="codex exec --full-auto" node .build-kit/ralph-exec.js
```

The prompt is appended to the command as one shell-quoted argument, and is also written
to a temp file named by `RALPH_PROMPT_FILE` for commands that prefer to read it. The
child runs with the project dir as its cwd and inherits stdio — a harness owns its own
output format, so there is no condensed per-step logging here the way `ralph-claude.js`
has it.

**Agent tracing needs the harness's JSON output flag.** With agent tracing on
(`eventmodelers config --agent-tracing on`), slice builds are costed just like with Claude —
but only if the harness runs in its JSON output mode. Its normal output has no token counts,
so without the flag a turn is not traced (the runner logs a hint). Add the flag yourself:

```bash
npx @eventmodelers/cli run --exec "codex exec --json --full-auto"
npx @eventmodelers/cli run --exec "opencode run --auto --format json"
npx @eventmodelers/cli run --exec "gemini --yolo --output-format stream-json -p"
```

The terminal then shows the raw JSON events. Only OpenCode reports a dollar cost; Codex and
Gemini turns record tokens and duration with no cost. See `agent-tracking.md`.

Persist a default alongside the local-AI settings:

```json
{
  "localAi": {
    "exec": "codex exec --full-auto"
  }
}
```

One caveat worth knowing before reaching for this: the kits' prompts assume Claude
Code's `Skill` tool and `CLAUDE.md`. Other harnesses read `AGENTS.md` and have no skill
primitive, so `init-agents` puts the skill files where they can find them, but
`lib/prompt.md` / `lib/backend-prompt.md` still need wording that says *read and follow*
a skill file rather than *invoke* it.

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
