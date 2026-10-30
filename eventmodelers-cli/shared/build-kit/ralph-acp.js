#!/usr/bin/env node
// Ralph loop + realtime agent using an Agent Client Protocol (ACP) agent as the executor.
//
// One warm agent process serves every turn (lib/acp-session.js): the process and its MCP connection to the
// platform stay up between prompts and slices, like the warm `claude` process behind `run --modeling`. A planned
// slice starts a fresh conversation in that process. The loop around it is the same one every runner shares, so the
// cockpit sees the same thing — the agent's pulse and attribution, the slice status, and the build log with its
// tool-call rows and the cost of each slice turn (when the agent reports token usage).
//
// Usage: RALPH_ACP_AGENT=opencode node ralph-acp.js [project_dir]
//        RALPH_ACP_CMD="my-agent --acp" node ralph-acp.js [project_dir]
// i.e. `eventmodelers run --agent opencode --acp` / `eventmodelers run --acp-cmd "<command>"`, which set those.
//
// The agent uses its own tools in the project directory, and every permission request it makes is approved — the
// same trade as `codex exec --full-auto` under ralph-exec.js.

import { readPickupStatus, startRalph, eventMeta, loadLocalConfig, resolveAgentIdentity, connectHeader } from './lib/ralph.js';
import { kitTypeOf } from './lib/build-log-share.js';
import { createSliceTracer } from './lib/tracing.js';
import { turnTimeoutMs } from './lib/turn.js';
import { recordToolCall } from './lib/tool-call-events.js';
import { createAcpSession, resolveAcpAgent } from './lib/acp-session.js';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

const cfg = loadLocalConfig(kitDir);
const localOnly = process.env.RALPH_LOCAL === '1';
Object.assign(cfg, resolveAgentIdentity(kitDir, 'BUILD', cfg));

let agent;
try {
  agent = resolveAcpAgent({ name: process.env.RALPH_ACP_AGENT || null, cmd: process.env.RALPH_ACP_CMD || null });
} catch (err) {
  console.error(`[ralph-acp] ${err.message}`);
  console.error('  Pick one for this run: eventmodelers run --agent opencode --acp   (or --acp-cmd "<command>")');
  process.exit(1);
}
if (localOnly) {
  console.error('[ralph-acp] --local needs the platform: the agent reaches the board through its MCP server.');
  process.exit(1);
}

const tracingOn = cfg.agentTracing === true;
if (!tracingOn) console.log('[ralph-acp] agent tracing off — no slice cost data is sent (turn on: eventmodelers config --agent-tracing on)');
const tracer = createSliceTracer({
  baseUrl: cfg.baseUrl,
  token: cfg.token,
  organizationId: cfg.organizationId,
  boardId: cfg.boardId,
  agentId: cfg.agentId,
  kitType: kitTypeOf(readPickupStatus(kitDir)),
  traceFile: join(projectDir, '.eventmodelers', 'trace', 'slices.jsonl'),
  log: (line) => console.log(`[ralph-acp] ${line}`),
  enabled: tracingOn,
});

const inlineHeader = connectHeader(cfg, localOnly);
const timeoutMs = turnTimeoutMs(cfg);
const verbose = process.env.RALPH_VERBOSE === '1';

// ACP has no system-prompt channel, so this travels with every turn.
const PREAMBLE =
  'You are the Eventmodelers build agent, working in the project directory. Read CLAUDE.md there first and follow it. ' +
  'The eventmodelers MCP server is already connected and authenticated, so wherever the kit or a skill says to /connect ' +
  'first, that is done — use the eventmodelers tools directly. Nobody can answer questions: if something is unclear, ' +
  'post it as a board comment and carry on.\n\n';

console.log(`[ralph-acp] agent: ${agent.label}`);
const mcp = {
  url: `${cfg.baseUrl}/mcp`,
  headers: [
    { name: 'x-token', value: cfg.token },
    ...(cfg.agentId ? [{ name: 'x-agent-id', value: cfg.agentId }] : []),
  ],
};
// What the skills' curl fallback and the CLI read, and the rest of this process's environment.
const agentEnv = {
  ...process.env,
  ...(cfg.token ? { EVENTMODELERS_TOKEN: cfg.token } : {}),
  ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
};
const newSession = (env = agentEnv) => createAcpSession({ agent, cwd: projectDir, env, mcp, log: (line) => console.log(`[ralph-acp] ${line}`) });
const session = newSession();

// `slice` is set for a planned-slice build (see startRalph) — the only turns that are traced. `use` is the session
// the turn runs in: the warm one, or a short-lived one for the curation turn.
async function runAcp(prompt, slice = null, use = session) {
  // A planned slice starts a fresh conversation: the process and its MCP connection stay warm, but one slice's
  // reading and edits are not context for the next, and a session that never forgets would outgrow its window.
  if (slice) use.reset();
  const startedAt = Date.now();
  try {
    const result = await use.runTurn(PREAMBLE + inlineHeader + prompt, {
      timeoutMs,
      onToolCall: (name, input) => {
        recordToolCall({ kitDir, slice, tool: name, meta: eventMeta(cfg) });
        console.log(verbose ? `→ ${name} ${JSON.stringify(input).slice(0, 100)}` : `→ ${name}`);
      },
    });
    console.log(`done (${Date.now() - startedAt}ms)`);
    if (slice && result.usage) tracer.record({ ...slice, status: 'ok' }, result.usage);
    return result.text;
  } catch (err) {
    if (slice && err.timedOut) tracer.record({ ...slice, status: 'error' }, { inputTokens: 0, outputTokens: 0, costUsd: null, durationMs: Date.now() - startedAt, model: null });
    throw err; // a timeout carries `timedOut`, which lib/ralph.js lets through to the stuck-slice guard
  }
}

// The curation turn needs EVENTMODELERS_CURATING=1 in the agent's own environment (it makes `learn` refuse new
// learnings), and a warm process cannot take env per turn — so it runs in a short-lived process of its own.
async function curate(prompt, { env = {} } = {}) {
  const curator = newSession({ ...agentEnv, ...env });
  try {
    return await runAcp(prompt, null, curator);
  } finally {
    curator.close();
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { session.close(); process.exit(0); });
}

startRalph({
  kitDir,
  projectDir,
  onTask: (prompt) => runAcp(prompt),
  onPlannedSlice: (prompt, slice) => runAcp(prompt, slice),
  onCurate: curate,
  localOnly,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
