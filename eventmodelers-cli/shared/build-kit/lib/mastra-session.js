// A warm Mastra agent session: one Agent, one MCP connection to the eventmodelers server and one running
// conversation, kept alive across turns — the Mastra counterpart of the warm `claude` process.
//
// Both loops mount it the way they mount their other runners: the build kit's ralph-mastra.js and the modeling
// loop in cli.js hand it one turn's text and get the reply back. The loop around it (claiming, heartbeat,
// status, tracing, the cockpit's events) never knew what sat behind a turn, so none of that lives here.
//
// @mastra/core, @mastra/mcp and zod are peer dependencies, imported only when a session is created, so
// nobody who does not pick `--agent mastra` carries them.
//
// The conversation is held here as plain model messages (what `generate` returns in response.messages) and
// passed back in on the next turn — no storage package needed, and a new process starts a new conversation,
// as a respawned `claude` does.

import { join } from 'path';
import { existsSync } from 'fs';

const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

async function loadMastra() {
  try {
    const [{ Agent }, { MCPClient }, workspace] = await Promise.all([
      import('@mastra/core/agent'),
      import('@mastra/mcp'),
      import('@mastra/core/workspace'),
    ]);
    return { Agent, MCPClient, ...workspace };
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    throw new Error(`the Mastra runner needs its packages — run: npm install @mastra/core @mastra/mcp zod (${err.message.split('\n')[0]})`);
  }
}

/** Mastra's usage, in the shape lib/tracing.js records. Cost stays null: Mastra reports tokens, not a price. */
export function usageFromMastra(usage, { durationMs, model } = {}) {
  if (!usage) return null;
  return {
    inputTokens: n(usage.inputTokens ?? usage.promptTokens),
    outputTokens: n(usage.outputTokens ?? usage.completionTokens),
    cacheReadTokens: n(usage.cachedInputTokens),
    costUsd: null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    model: typeof model === 'string' ? model : null,
  };
}

/**
 * options:
 *   model          'provider/model', e.g. 'anthropic/claude-sonnet-5-5' — the provider's key comes from its usual env var
 *   instructions   the agent's system prompt
 *   mcpUrl         the platform's /mcp endpoint; the token and agent id travel as the headers every other harness sends
 *   token, agentId
 *   cwd            where the agent works
 *   workspace      true: file, search and shell tools in cwd (a build turn writes code); false: board tools only
 *   skillsDirs     directories (relative to cwd) holding SKILL.md skills, e.g. ['.claude/skills']
 *   env            the environment the agent's shell commands run in (the sandbox passes only PATH otherwise)
 *   checkCommand   (command) -> {ok, reason}: refuses a shell command before it runs (lib/bash-guard.js)
 *   log
 */
export async function createMastraAgent({ model, instructions, mcpUrl, token, agentId, cwd, workspace = false, skillsDirs = [], env = {}, checkCommand }) {
  if (!model) throw new Error('no model — pass --model <provider/model>, e.g. anthropic/claude-sonnet-5-5');
  const { Agent, MCPClient, Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } = await loadMastra();

  const mcp = new MCPClient({
    id: `eventmodelers-${agentId ?? 'agent'}`,
    servers: {
      eventmodelers: {
        url: new URL(mcpUrl),
        requestInit: { headers: { 'x-token': token ?? '', ...(agentId ? { 'x-agent-id': agentId } : {}) } },
      },
    },
  });

  // One object for the life of the session: runTurn adds a turn's own variables to it and takes them out again.
  const sandboxEnv = { ...env };
  let ws;
  if (workspace) {
    const skills = skillsDirs.filter((d) => existsSync(join(cwd, d)));
    ws = new Workspace({
      id: 'project',
      filesystem: new LocalFilesystem({ basePath: cwd }),
      sandbox: new LocalSandbox({ workingDirectory: cwd, env: sandboxEnv }),
      ...(skills.length ? { skills } : {}),
      tools: {
        hooks: checkCommand ? {
          beforeToolCall: ({ workspaceToolName, input }) => {
            if (workspaceToolName !== WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND) return;
            const verdict = checkCommand(input?.command);
            if (!verdict.ok) return { proceed: false, output: `refused: ${verdict.reason}` };
          },
        } : {},
      },
    });
  }

  const agent = new Agent({
    id: 'eventmodelers',
    name: 'eventmodelers',
    instructions,
    model,
    tools: await mcp.listTools(),
    ...(ws ? { workspace: ws } : {}),
  });

  return { agent, mcp, sandboxEnv };
}

/** A warm session around that agent: the same options, plus `log`. */
export async function createMastraSession(options) {
  const { model, env = {}, log = () => {} } = options;
  const { agent, mcp, sandboxEnv } = await createMastraAgent(options);

  let history = [];
  let running = null;

  return {
    /** One turn: resolves `{text, usage, isError}`. `onToolCall(name, args, id)` fires as each call starts and
     *  `onToolResult(id, {isError})` as it ends. `signal`
     *  aborts it (the turn supervisor's timeout). `env` is added to the shell commands' environment for this turn
     *  only. Turns are one at a time — they share one conversation. */
    async runTurn(prompt, { onToolCall, onToolResult, signal, env: turnEnv } = {}) {
      if (running) throw new Error('a Mastra turn is already running — turns share one conversation');
      const startedAt = Date.now();
      const messages = [...history, { role: 'user', content: prompt }];
      Object.assign(sandboxEnv, turnEnv);
      running = (async () => {
        const result = await agent.generate(messages, {
          maxSteps: 100,
          abortSignal: signal,
          onChunk: (chunk) => {
            if (chunk?.type === 'tool-call') onToolCall?.(chunk.payload?.toolName ?? 'tool', chunk.payload?.args ?? {}, chunk.payload?.toolCallId);
            else if (chunk?.type === 'tool-result') onToolResult?.(chunk.payload?.toolCallId, { isError: chunk.payload?.isError === true });
          },
        });
        history = [...messages, ...(result.response?.messages ?? [])];
        return {
          text: result.text ?? '',
          usage: usageFromMastra(result.usage, { durationMs: Date.now() - startedAt, model }),
          isError: result.finishReason === 'error',
        };
      })();
      try { return await running; } finally {
        running = null;
        for (const key of Object.keys(turnEnv ?? {})) { if (key in env) sandboxEnv[key] = env[key]; else delete sandboxEnv[key]; }
      }
    },
    /** The conversation starts over — what a respawned warm process does. */
    reset() { history = []; },
    async close() {
      try { await mcp.disconnect(); } catch (err) { log(`mastra: MCP disconnect failed (${err.message})`); }
    },
  };
}
