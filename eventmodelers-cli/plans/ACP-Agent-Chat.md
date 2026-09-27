# ACP Agent Chat — let Codex, OpenCode, Gemini (and any ACP agent) take board prompts and chat

## The mental model (for us and for users)

**The connected agent is the `eventmodelers` CLI process — not the AI.** When a user runs

```
npx @eventmodelers/cli run --modeling
```

that process is what the board sees. It sends the heartbeat (so it shows up in the agent list), holds the realtime connection, claims prompts and chat messages, and reports status back. For each piece of work it hands the actual thinking to an **AI engine** it runs inside it:

```
Board ──prompt/chat──▶ eventmodelers run --modeling ──turn──▶ AI engine
      ◀────status────  (connected, heartbeat, queue)  ◀─result─  (does the work over MCP)
```

### How a user connects an agent that takes prompts — today
1. `npx @eventmodelers/cli init --modeling` in a folder (or skip it and use `run --global`).
2. `npx @eventmodelers/cli run --modeling` — leave it running.
   - Add `--worker` for an agent that takes prompts but does not chat.
   - Add `--standalone` for an agent that also works the board on its own initiative.

### Prompts vs. chat
Two separate channels:
- **Prompts** (the prompt queue) — taken by every modeling-loop agent: chat-enabled, `--worker`, `--local-ai`. A prompt goes to the addressed (starred) agent, or to anyone if unaddressed.
- **Chat** — answered only by modeling-loop agents that heartbeat `chat_enabled: true` (i.e. not `--worker`). The web app still lists non-chat agents, marked "— no chat", and the backend refuses messages to them (`CHAT_AGENT_NO_CHAT`).

Build-kit and bridge agents are connected too, but take **neither** — they only react to slice status changes (Planned slices), never to `prompts/next`.

### Why Codex can't do this today
Step 2 can only use two engines: **Claude Code** (default) or a **local model** (`--local-ai`). The glue that starts an engine, feeds it one prompt after another and reads its answer back exists only for those two.

Codex already appears in two *other* places, which is what makes this confusing:

| What | Does | Takes board prompts? |
|---|---|---|
| `init-agents --hosts codex` | Copies the Event Modeling skills into Codex's folder, so you can model **by hand** in Codex | No — nothing makes Codex listen to the board |
| `run --exec "codex exec"` | Uses Codex as the engine of a **build kit** — builds code from Planned slices | No — build kits don't read the prompt queue |
| `run --modeling` | The loop that takes prompts and chats | Yes — but Claude / local model only |

So "Codex support" exists for skills and for building code, but not for "take prompts from the board" — which is what users will expect it to mean.

### After this change
One more flag in step 2:

```
npx @eventmodelers/cli run --modeling --agent codex      # or opencode, gemini
```

That agent shows up on the board, takes prompts and chats exactly like the Claude one (`--worker` / `--standalone` / `--exclusive` still apply). Docs should lead with this framing: **the CLI connects to the board; `--agent` picks which AI does the work.**

## Context
The modeling loop (`run --modeling` / `--standalone` / `--worker` / `--global`) drives only a warm `claude` process (stream-json over stdin, `cli.js:1992-2118`) or `--local-ai` (`lib/modeling-local-ai.js`). Goal: let other agents be the engine, via the **Agent Client Protocol (ACP)** only, so any future ACP agent is a one-row addition. Agents without ACP are out of scope.

Why ACP: one long-lived stdio JSON-RPC process per session — keeps the low latency `--modeling` exists for. `opencode acp` (verified locally, v2.0.11) and Gemini CLI speak it natively; Codex via the `codex-acp` adapter. ACP's `session/new` takes `mcpServers`, so the eventmodelers MCP server and its token/agent-id headers are passed per session — **no per-host MCP config files** (nothing registers MCP for these hosts today; `ensureMcpRegistered` only writes `.mcp.json`, `cli.js:1484`).

## Design

### 1. Runner interface (small refactor inside `runModeling`)
`runTurn` (`cli.js:2176`) is already the single place where the runner is chosen, and `createModelingLocalAiRunner` already returns `{ runTurn, warmUp, describe }` (`lib/modeling-local-ai.js:297`). Make that the contract for all three runners, plus two capability flags:
- `subagents: boolean`: Claude true; ACP and local-ai false.
- `readsKit: boolean`: whether the session header and warm-up should tell it to read `.agent-modeling-kit/CLAUDE.md` (Claude and ACP true; local-ai false).

Replace every `localRunner ?` / `if (localRunner)` branch with the matching flag: `withSessionHeader` :1963, banners :2183-2188, warm-up :2204, `AGENT_BUDGET` :2580, `FAN_OUT` :2596. Move the Claude process code (`claudeArgs`, `claudeEnv`, `describeToolUse`, `handleLine`, `spawnProcess`, `sendTurn`) into `lib/modeling-claude.js` → `createModelingClaudeRunner({cfg, projectDir, log, verbose})`. The loop-level `warmUpSession` (the standalone warm-up turn) stays in `runModeling` and calls `runner.runTurn`. Its `firstTurn=true` reset on respawn becomes an `onRespawn` callback the runner calls. Behavior for Claude must stay byte-identical.

### 2. `lib/modeling-acp.js`: the generic ACP runner
`createModelingAcpRunner({ agent, cfg, projectDir, log, verbose, onRespawn })`:
- Spawn `agent.command agent.args` with `cwd: projectDir`, env `+ EVENTMODELERS_TOKEN, EVENTMODELERS_AGENT_ID` (for the skills' curl fallback), stdio pipe. It speaks newline-delimited JSON-RPC 2.0 with a small request/response id map (no library).
- `initialize` with `protocolVersion: 1` and `clientCapabilities: { fs: {readTextFile:false, writeTextFile:false}, terminal:false }`, so the agent uses its own tools. Fail loudly if `agentCapabilities.mcpCapabilities.http` is false (no fallback; see [[feedback-no-workarounds-keep-it-simple]]).
- `session/new { cwd: projectDir, mcpServers: [{ type:'http', name:'eventmodelers', url: cfg.baseUrl+'/mcp', headers:[{name:'x-token',value:cfg.token},{name:'x-agent-id',value:cfg.agentId}] }] }` returns the sessionId, kept for the process's life (the warm session).
- `runTurn(text)` sends `session/prompt { sessionId, prompt:[{type:'text',text}] }`, gathers `session/update` notifications until the response `{stopReason}`, and resolves with the concatenated `agent_message_chunk` text (the NOOP/DONE check at :2842 and the chat fallback reply read this). `stopReason` `refusal`/`cancelled`, an RPC error or a process exit mid-turn rejects the turn, the same as the Claude path.
- Answer agent→client `session/request_permission` by picking the first `allow_always`/`allow_once` option. This is the equivalent of `--dangerously-skip-permissions`. Reply to any other client method with a JSON-RPC "method not found" error.
- Logging, per [[feedback_modeling_trace_needs_detail]]: `tool_call` updates log `→ <title>`. `--verbose` adds `kind` plus a one-line `rawInput`, and the agent text chunks.
- On exit: log, clear the session, call `onRespawn()`, and respawn on the next turn (mirrors `spawnProcess`'s exit handler).
- `describe()` returns `"<name> via ACP (<command>)"`. `warmUp()` spawns, initializes and creates the session eagerly.
- Cost: only log it if the prompt response carries `usage`. No new tracing, because the modeling loop doesn't trace cost today.

### 3. Agent registry: the extension point
In `lib/modeling-acp.js`:
```js
export const ACP_AGENTS = {
  opencode: { label: 'OpenCode', command: 'opencode', args: ['acp'], host: 'opencode' },
  gemini:   { label: 'Gemini CLI', command: 'gemini', args: ['--experimental-acp'], host: 'gemini' },
  codex:    { label: 'Codex (codex-acp adapter)', command: 'npx', args: ['-y', '@zed-industries/codex-acp'], host: 'codex' },
};
```
`host` is the matching `AGENT_HOSTS` key (`cli.js:233`), so skills get installed for it (§5). Adding an agent means adding a row. There is also a no-code escape hatch: `modelingAgent: { command, args }` in `.eventmodelers/config.json`, or `run --modeling --agent-cmd "<cmd …>"`, for any ACP agent that isn't in the table. Before committing, check the exact Gemini flag (`--experimental-acp` vs `--acp`) and the codex-acp package name against the current releases.

### 4. CLI wiring (`run` command, `cli.js:3473+`)
- New option `--agent <name>`: one of `claude` (default) or the `ACP_AGENTS` keys. Validate it like `resolveLocalAiTarget` (`cli.js:58`). `--agent-cmd` implies a custom ACP agent.
- Mutually exclusive with `--local-ai`. It sits in the same modeling gate as `--bash`/`--exec` (:3555). It is allowed with `--modeling/--standalone/--worker/--global`, and rejected for build kits (they already have `--exec`).
- `runModeling` gains an `agent` option and picks the runner: `localAi` → local, `agent !== 'claude'` → ACP, otherwise Claude. `runnerLabel` (:3598) is updated.
- Update the `--modeling` help text ("Keep one agent process warm…").

### 5. Skills for the ACP agent
The user's direction is to reuse `init-agents`. `configureAgentHosts` (`cli.js:280-350`) already writes stubs (opencode, gemini) or copies `SKILL.md` (codex). Wiring:
- Global install: after `ensureGlobalKit`, call `configureAgentHosts(GLOBAL_KIT_DIR, [agent.host])`, idempotent via `manifest.agentHostFiles`. This makes `run --global --agent codex` work from anywhere.
- Project install: if `manifest.agentHostFiles` has nothing for `agent.host`, log a one-line hint (`run init-agents --hosts <host>`) and continue. Don't silently write into the project.
- Session header for ACP: the same as Claude's (read `.agent-modeling-kit/CLAUDE.md` once), except "the eventmodelers MCP server is already connected with your credentials; don't run /connect". `/connect`'s job (credentials and `.mcp.json`) is done by `session/new`.
- Known gap, stated rather than fixed now: the kit's CLAUDE.md and skills mention Claude tool names (`Skill`, `Agent`). With `subagents:false` the turn texts already say to work inline, as for local-ai. A host-neutral rewrite of CLAUDE.md is a follow-up only if a real run shows the agent getting confused.

### 6. Docs
- `README.md`: a "Modeling with other agents (ACP)" section covering `--agent`, the table, `--agent-cmd`, and the skills and subagent limits.
- `run --help` strings (§4).

## Critical files
- `cli.js`: `runModeling` (1870-2911, refactor to the runner interface), the `run` options and gate (3473-3612), the `ensureGlobalKit` call site.
- New `lib/modeling-claude.js` (extracted and unchanged behavior), new `lib/modeling-acp.js`.
- `lib/modeling-local-ai.js`: add the `subagents:false, readsKit:false` flags only.
- `README.md`.
- New `test/modeling-acp.test.js` plus `test/fixtures/fake-acp-agent.mjs`.

## Verification
1. `npm test` (`node --test test/*.test.js`) passes. The new test drives `createModelingAcpRunner` against a fake ACP agent fixture (ndjson JSON-RPC) and covers: initialize and session/new carrying the MCP server and headers; prompt → streamed chunks → resolved text; a permission request answered with allow; an http-less MCP capability refused; the agent exiting mid-turn rejecting the turn, then a respawn and new session on the next turn.
2. Claude regression: `run --modeling --verbose` on a test board. Same log lines and a prompt worked as before.
3. Real OpenCode (installed here): `run --global --agent opencode --verbose --board-id <test board>`. Submit a prompt (e.g. "add example data to <node>") and send one chat message. Check that the board changed, the chat got a reply, and tool calls were logged with detail. Then `--standalone --agent opencode`: one board edit triggers an inline self-directed turn.
4. Codex and Gemini aren't installed on this machine. Ask the user to run step 3 with `--agent codex` / `--agent gemini`, or install them first. No release or publish ([[feedback-never-release]]).
