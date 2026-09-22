## Unreleased

### Features
- `run --modeling`/`run --standalone` accept `--local-ai`, so the modeling agent can be driven by a local or self-hosted model instead of Claude. It was previously rejected as a build-kit-only flag, which conflated two different things: `--bash`/`--exec` select a *queue* the modeling loop has no equivalent of, while `--local-ai` selects a *model*. Both wire dialects are supported — `--local-ai` (bare) or `--local-ai ollama` for Ollama's native `POST /api/chat`, and `--local-ai vllm`/`lmstudio`/`llamacpp` for the OpenAI-compatible `POST /v1/chat/completions` that vLLM, LM Studio, llama.cpp-server, TGI and SGLang serve; anything else OpenAI-compatible works via `LOCAL_AI_URL`. The loop itself is untouched: the prompt queue, the standalone board-change lane and its damping, the idle review and the platform's full MCP tool set all behave as before, because everything Claude-specific already sat behind a single `runTurn(text)` seam. What a local model cannot bring along is the part that is not a wire format — the skills (`/place-element`, `/timeline`, `eventmodeling-*`) and the subagent fan-out are Claude Code features — so a self-directed turn does the most valuable piece of work itself, inline, and the board rules it needs come from the new runner's system prompt (`lib/modeling-local-ai.js`) instead of `.agent-modeling-kit/CLAUDE.md`. `--max-agents` is ignored in this mode. Ollama's `num_ctx` is raised to 32768 by default (the MCP tool schemas alone are ~16k tokens, well past Ollama's 4096 default, which would silently truncate the tool block), with a warning when the schemas still fill >60% of it and a turn cap of 24 tool iterations.

### Docs
- The `anthropicBaseUrl` option no longer implies Ollama works behind it. That route keeps Claude Code and swaps only the endpoint, so the server has to speak Anthropic's own `/v1/messages`; Ollama does not, and pointing it at `localhost:11434` returns a 404. For Ollama, `--local-ai` is the supported route, and the README now says which of the two to reach for.
- `LOCAL_AI_*` is documented for the first time — the `--local-ai` help text had been pointing at "the docs" for vars that appeared nowhere in the README.

## v1.0.72

### Features
- `init --demo` seeds the kit's `.slices/` with a ready-made model — the "Understanding Eventsourcing" context, a 16-slice shopping cart covering every slice type — so the `build-*` skills, `activate-context`, `set-slice-status`, and the agent loop all have something real to work on before the project is connected to a board. It is a verbatim `fetch --format json` tree, so nothing downstream has a demo-only path and a later `fetch --context <name>` simply replaces it. Skipped with a message when `.slices/` already holds fetched slices, so it can never overwrite real board state. Works with every install mode (`--stack`, `--modeling`, `--build-kit`, `--bridge`, `--git`); modeling-kit gets it at the project root, matching where `fetch` writes for that kit.

## v1.0.56

### Features
- `run --standalone` no longer needs a modeling kit installed in the current directory. With none there, it falls back to a single global install under `~/.eventmodelers/kit`, initialized on first use and refreshed when the CLI version changes — so `npx @eventmodelers/cli run --standalone --board-id <uuid>` works from anywhere and writes nothing into the directory it was started from. `--global` selects that install explicitly even when a local kit exists.
- `--standalone` now implies `--modeling` — it already refused every other runner, so requiring both flags only made the shorter command fail.
- `run` accepts `--token`/`--board-id`/`--organization-id`/`--base-url`, the same credential flags `init` and `init-config` take, so credentials can be given per agent run rather than per directory. They're stored per board in `~/.eventmodelers/boards/<board>.json` (`0600`) together with a stable agent id, so later runs for the same board need only `--board-id`. One machine can drive several boards across several accounts at once.
- The first run for a board asks once whether it should have credentials of its own or use the account-wide ones, and remembers the answer — either the credentials or a `useGlobal` marker is written to `~/.eventmodelers/boards/<board>.json`. The question is skipped when credentials are given on the command line, under `--print`, or when stdin is not interactive, so CI and process supervisors never block on it.
- `init-config --credentials "token=...,boardId=...,organizationId=...,baseUrl=..."` configures a single board non-interactively from the blob app.eventmodelers.ai/account hands out. The equivalent JSON works too, and `-` reads either from stdin so a token need not appear in shell history or `ps`. `run --credentials` takes the same value, for configuring and starting in one command.

### Fixes
- `init --modeling` no longer runs `npm install` in the kit dir — modeling-kit's `package.json` declares no dependencies and exists only for its `"type": "module"`.

## v0.0.38

### Features
- Added a `release-notes` command to print the CLI's release notes (what changed across recent versions) without needing a connected project or credentials.