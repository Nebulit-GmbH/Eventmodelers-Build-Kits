// `run --modeling --agent <name> --acp` / `--acp-cmd "<command>"`: the modeling loop's Agent Client Protocol runner —
// one warm agent process and one session for the life of the loop, the counterpart of the warm `claude` process.
//
// It is shaped like lib/modeling-mastra.js's runner so the loop treats it the same way: the loop owns the
// heartbeat, the realtime channel, claiming prompts and chat messages; all a turn needs is something that takes
// the turn's text, does the board work over MCP and answers. The ACP client itself — process, JSON-RPC, session,
// permissions — is shared with the build kit's ralph-acp.js: shared/build-kit/lib/acp-session.js.

import { turnTimeoutMs } from '../shared/build-kit/lib/turn.js';
import { createAcpSession, ACP_AGENTS, resolveAcpAgent } from '../shared/build-kit/lib/acp-session.js';

export { ACP_AGENTS, resolveAcpAgent };

const oneLine = (value, max = 160) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));

// What a turn put through the model, told apart. Every model call re-sends the whole conversation, so the reported total
// is mostly that conversation replayed from the provider's cache — cheap and quick, and not new work. "new" is what the
// turn actually added (fresh input and cache writes), "replayed" is the cached conversation, summed over the turn's calls.
export function tokenSummary(u) {
  return `new ${k(u.inputTokens + u.cacheWriteTokens)} · replayed from cache ${k(u.cacheReadTokens)} · out ${k(u.outputTokens)}`;
}

export function createModelingAcpRunner({ cfg, agent, projectDir, log, verbose = false, onToolUse }) {
  const timeoutMs = turnTimeoutMs(cfg);
  let primed = false; // a turn has succeeded: the session has read the kit, so later turns skip the preamble
  let queue = Promise.resolve();
  const session = createAcpSession({
    agent,
    cwd: projectDir,
    env: {
      ...process.env,
      // What the skills' curl fallback authenticates with, and what attributes the agent's board writes to this agent.
      EVENTMODELERS_TOKEN: cfg.token,
      ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
    },
    mcp: {
      url: `${cfg.baseUrl}/mcp`,
      headers: [
        { name: 'x-token', value: cfg.token },
        ...(cfg.agentId ? [{ name: 'x-agent-id', value: cfg.agentId }] : []),
      ],
    },
    log,
    onExit: () => { primed = false; }, // a new process knows nothing of the kit, so the next turn carries the preamble again
  });

  async function runTurnNow(text) {
    const ends = new Map(); // tool call id -> the journal's end callback
    const result = await session.runTurn(text, {
      timeoutMs,
      onText: verbose ? (chunk) => process.stdout.write(chunk) : undefined,
      onToolCall: (name, input, id, update) => {
        log(`→ ${name}${verbose ? ` [${update?.kind ?? '?'}] ${oneLine(update?.rawInput)}` : ''}`);
        const end = onToolUse?.(name, input);
        if (end && id) ends.set(id, end);
      },
      onToolResult: (id, outcome) => { ends.get(id)?.(outcome); ends.delete(id); },
    });
    primed = true;
    log(`done (${result.usage?.durationMs ?? '?'}ms)${result.usage ? ` ${tokenSummary(result.usage)}` : ''}${verbose && result.rawUsage ? ` ${oneLine(result.rawUsage)}` : ''}`);
    return result.text;
  }

  return {
    // Turns share one session, so they take their turns one at a time.
    runTurn(text) {
      const result = queue.then(() => runTurnNow(text));
      queue = result.catch(() => {});
      return result;
    },
    hasSession: true,
    describe: () => session.describe(),
    mcpRegistered: true,
    get keepsSession() { return primed; },
    // `--reset-session`: the next turn opens a fresh conversation in the same warm process. Queued behind the turns
    // already waiting, so none of them loses its session halfway; `primed` goes with it, so that turn carries the
    // session header (and re-reads the kit) again.
    resetSession() {
      const result = queue.then(() => { session.reset(); primed = false; log('session reset — the next turn starts a fresh conversation'); });
      queue = result.catch(() => {});
      return result;
    },
    close: () => session.close(),
  };
}
