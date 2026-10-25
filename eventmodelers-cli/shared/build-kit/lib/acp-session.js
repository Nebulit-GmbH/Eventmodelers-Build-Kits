// A warm Agent Client Protocol (ACP) session: one agent process, one conversation at a time, newline-delimited
// JSON-RPC 2.0 over the agent's stdio. Shared by the modeling loop (lib/modeling-acp.js) and the build kit
// (ralph-acp.js), so it lives here — build-kit files ship standalone into projects.
//
// Nothing here is specific to one agent: ACP_AGENTS only says how to start each, and `--acp-cmd` starts any other.
// No client capabilities are offered (no fs, no terminal), so the agent uses its own tools. The eventmodelers MCP
// server (and the token / agent-id headers) is handed to the agent in `session/new`, so no MCP config file is
// written for any host. Permission requests are answered with "allow" — the same trade as
// --dangerously-skip-permissions, and the reason this is opt-in.
//
// One turn at a time: callers serialize their turns (a conversation cannot take two prompts at once).

import { spawn } from 'child_process';

// How to start an agent's ACP server. Adding an agent is one row. `host` is the matching `init-agents --hosts` key,
// for the skills — informational only: nothing here installs into the agent's folders.
export const ACP_AGENTS = {
  opencode: { label: 'OpenCode', command: 'opencode', args: ['acp'], host: 'opencode' },
  gemini: { label: 'Gemini CLI', command: 'gemini', args: ['--acp'], host: 'gemini' },
  claude: { label: 'Claude (claude-agent-acp adapter)', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'], host: null },
  cursor: { label: 'Cursor', command: 'cursor-agent', args: ['acp'], host: 'cursor' },
  // cumulativeUsage: the prompt response's `usage` is the session's running total, not this turn's (seen in Copilot's own
  // events: 228,847 then 338,137 input tokens for turns of 228,847 and 109,290). The others report per turn.
  github: { label: 'GitHub Copilot CLI', command: 'npx', args: ['-y', '@github/copilot', '--acp'], host: 'copilot', cumulativeUsage: true },
  codex: { label: 'Codex (codex-acp adapter)', command: 'npx', args: ['-y', '@zed-industries/codex-acp'], host: 'codex' },
};

// --agent <name> --acp, or --acp-cmd "<command …>" for an agent that is not in the table.
export function resolveAcpAgent({ name = null, cmd = null } = {}) {
  if (cmd) {
    const [command, ...args] = String(cmd).trim().split(/\s+/);
    if (!command) throw new Error('--acp-cmd needs a command, e.g. --acp-cmd "my-agent --acp"');
    return { label: command, command, args, host: null };
  }
  const agent = ACP_AGENTS[name];
  if (!agent) throw new Error(`no ACP agent "${name}" — one of: ${Object.keys(ACP_AGENTS).join(', ')}, or pass --acp-cmd "<command>"`);
  return agent;
}

const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

const FIELDS = ['inputTokens', 'outputTokens', 'cachedReadTokens', 'cachedWriteTokens', 'totalTokens'];

/** This turn's share of a running total: `usage` minus what the session had reported before. */
export function usageDelta(usage, previous) {
  if (!usage || !previous) return usage ?? null;
  const out = { ...usage };
  for (const f of FIELDS) if (Number.isFinite(usage[f])) out[f] = Math.max(0, usage[f] - (previous[f] ?? 0));
  return out;
}

/** What an ACP prompt response reports (when it does), in the shape lib/tracing.js records: input tokens exclusive of
 *  the cached ones. Agents differ: OpenCode and the Claude adapter already report them that way (totalTokens is
 *  input + output + cache), Copilot's inputTokens includes the cache (totalTokens is input + output) — told apart by
 *  which sum the reported total matches. Cost stays null: ACP reports tokens, not a price. */
export function usageFromAcp(usage, { durationMs, model } = {}) {
  if (!usage) return null;
  const cacheRead = n(usage.cachedReadTokens);
  const cacheWrite = n(usage.cachedWriteTokens);
  let input = n(usage.inputTokens);
  const output = n(usage.outputTokens);
  if (Number.isFinite(usage.totalTokens) && cacheRead + cacheWrite > 0) {
    const inclusive = Math.abs(usage.totalTokens - (input + output));
    const exclusive = Math.abs(usage.totalTokens - (input + output + cacheRead + cacheWrite));
    if (inclusive < exclusive) input = Math.max(0, input - cacheRead - cacheWrite);
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    model: typeof model === 'string' ? model : null,
  };
}

const oneLine = (value, max = 160) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/**
 * `mcp` is `{ url, headers: [{name, value}] }` — the server handed to every session.
 * `onExit(reason)` fires when the process goes away (the next turn starts a new one).
 * runTurn(text, { onToolCall(name, input, id, update), onToolResult(id, outcome), onText(chunk), timeoutMs }) resolves
 * `{ text, usage, stopReason }`; a refusal or cancel, an RPC error, a timeout (err.timedOut) or the process exiting
 * mid-turn rejects it.
 */
export function createAcpSession({ agent, cwd, env = process.env, mcp, log = () => {}, onExit = () => {} }) {
  let proc = null;
  let initialized = null; // resolves once the process answered `initialize`
  let sessionPromise = null; // resolves to the sessionId of the current conversation
  let sessionId = null;
  let canClose = false; // the agent can drop a conversation it is done with (sessionCapabilities.close)
  let lastUsage = null; // the previous turn's reported usage in this session — what a running total is measured against
  let nextId = 0;
  const pending = new Map(); // request id -> { resolve, reject }
  let turn = null; // the turn in flight: { text, hooks, ends }

  function send(message) {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  }

  function onUpdate(update) {
    if (!turn) return;
    const { hooks } = turn;
    switch (update?.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.type === 'text') {
          turn.text += update.content.text;
          hooks.onText?.(update.content.text);
        }
        break;
      case 'tool_call':
        hooks.onToolCall?.(update.title || update.kind || 'tool', update.rawInput ?? {}, update.toolCallId, update);
        if (update.toolCallId) turn.ends.add(update.toolCallId);
        break;
      case 'tool_call_update':
        if (update.status === 'completed' || update.status === 'failed') {
          hooks.onToolResult?.(update.toolCallId, { isError: update.status === 'failed' });
          turn.ends.delete(update.toolCallId);
        }
        break;
    }
  }

  function onMessage(msg) {
    if (msg.method && msg.id !== undefined) {
      // A request from the agent. Only permissions are answered; the client offers nothing else.
      if (msg.method === 'session/request_permission') {
        const options = msg.params?.options ?? [];
        const pick = options.find((o) => o.kind === 'allow_always') ?? options.find((o) => o.kind === 'allow_once');
        send({ id: msg.id, result: { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } } });
      } else {
        send({ id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
      }
    } else if (msg.method) {
      if (msg.method === 'session/update') onUpdate(msg.params?.update);
    } else if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`ACP ${msg.error.message ?? JSON.stringify(msg.error)}`));
      else entry.resolve(msg.result);
    }
  }

  // The process is gone, or about to be: clear everything that belongs to it, at once. Killing alone is not enough —
  // the `exit` event comes later, and a turn started in between would send its prompt to the dying process.
  function forget(child, reason) {
    if (proc !== child) return; // an older process, already replaced
    log(`ACP: ${agent.label} ${reason} — a new session starts with the next turn`);
    proc = null;
    initialized = null;
    sessionPromise = null;
    sessionId = null;
    lastUsage = null;
    for (const { reject } of pending.values()) reject(new Error(`${agent.label} ${reason}`));
    pending.clear();
    onExit(reason);
  }

  function spawnProcess() {
    const child = spawn(agent.command, agent.args, { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] });
    proc = child;
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { onMessage(JSON.parse(line)); } catch { log(`ACP: unreadable line from ${agent.label}: ${oneLine(line)}`); }
      }
    });
    child.on('exit', (code, signal) => forget(child, `exited (${signal ?? code})`));
    child.on('error', (err) => forget(child, `failed to start: ${err.message}`));

    initialized = (async () => {
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      canClose = Boolean(init?.agentCapabilities?.sessionCapabilities?.close);
      if (!init?.agentCapabilities?.mcpCapabilities?.http) {
        child.kill();
        throw new Error(`${agent.label} does not support HTTP MCP servers over ACP, which the eventmodelers MCP server needs`);
      }
    })();
    initialized.catch(() => {}); // surfaced by the turn that awaits it
  }

  // The process and a conversation in it, each created when missing.
  async function ensureSession() {
    if (!proc) spawnProcess();
    await initialized;
    if (!sessionPromise) {
      const created = request('session/new', { cwd, mcpServers: mcp ? [{ type: 'http', name: 'eventmodelers', url: mcp.url, headers: mcp.headers ?? [] }] : [] })
        .then((session) => {
          sessionId = session.sessionId;
          log(`ACP: ${agent.label} ready (session ${sessionId})`);
          return sessionId;
        });
      sessionPromise = created;
      created.catch(() => { if (sessionPromise === created) sessionPromise = null; });
    }
    return sessionPromise;
  }

  async function runTurn(text, hooks = {}) {
    const startedAt = Date.now();
    const id = await ensureSession();
    const current = { text: '', hooks, ends: new Set() };
    turn = current;
    let timer = null;
    try {
      const result = await Promise.race([
        request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] }),
        new Promise((_, reject) => {
          if (!hooks.timeoutMs) return;
          timer = setTimeout(() => {
            // Ask politely, then drop the process: a hung agent must not hold the loop.
            try { send({ method: 'session/cancel', params: { sessionId: id } }); } catch { /* already gone */ }
            const err = new Error(`ACP turn timed out after ${Math.round(hooks.timeoutMs / 60_000)}min`);
            err.timedOut = true;
            const child = proc;
            reject(err);
            if (child) { forget(child, 'timed out'); child.kill(); }
          }, hooks.timeoutMs);
        }),
      ]);
      if (result?.stopReason === 'refusal' || result?.stopReason === 'cancelled') {
        throw new Error(`ACP turn ended: ${result.stopReason}`);
      }
      // This turn's usage: an agent that reports a running total is measured against the previous turn's.
      const reported = result?.usage ?? null;
      const turnUsage = agent.cumulativeUsage ? usageDelta(reported, lastUsage) : reported;
      if (reported) lastUsage = reported;
      return { text: current.text.trim(), usage: usageFromAcp(turnUsage, { durationMs: Date.now() - startedAt }), rawUsage: turnUsage, stopReason: result?.stopReason ?? null };
    } finally {
      if (timer) clearTimeout(timer);
      for (const callId of current.ends) hooks.onToolResult?.(callId, { isError: true }); // a call that never reported back
      turn = null;
    }
  }

  return {
    runTurn,
    // A new conversation in the same warm process: the next turn opens a fresh session, so one slice's reading and
    // edits are not context for the next while the process and its MCP connection stay up.
    reset() {
      const old = sessionId;
      sessionPromise = null;
      sessionId = null;
      lastUsage = null;
      // The agent keeps a conversation until told otherwise, so one that is not coming back is closed (best effort).
      if (old && canClose && proc) request('session/close', { sessionId: old }).catch(() => {});
    },
    close() { proc?.kill(); },
    get sessionId() { return sessionId; },
    describe: () => `${agent.label} via ACP (${[agent.command, ...agent.args].join(' ')})`,
  };
}
