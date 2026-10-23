#!/usr/bin/env node
// Ralph loop + realtime agent using a Mastra agent as the executor.
//
// One warm Mastra session serves every turn (lib/mastra-session.js): the agent, its MCP connection to the
// platform and its conversation stay up between prompts and slices, like the warm `claude` process behind
// `run --modeling`. The loop around it is the same one every runner shares, so the cockpit sees the same
// thing — the agent's pulse and attribution, the slice status, and the build log with its tool-call rows and
// the cost of each slice turn.
//
// Usage: node ralph-mastra.js [project_dir]
//        RALPH_MODEL=anthropic/claude-sonnet-5-5 node ralph-mastra.js
// The model is `provider/model`; the provider's key is read from its usual env var (ANTHROPIC_API_KEY, ...).
// Or persist it as mastra.model in .eventmodelers/config.json.

import { startRalph, eventMeta, loadLocalConfig, resolveAgentIdentity, connectHeader } from './lib/ralph.js';
import { createSliceTracer } from './lib/tracing.js';
import { turnTimeoutMs } from './lib/turn.js';
import { recordToolCall } from './lib/tool-call-events.js';
import { createMastraSession, mastraModelConfig } from './lib/mastra-session.js';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

const cfg = loadLocalConfig(kitDir);
const localOnly = process.env.RALPH_LOCAL === '1';
Object.assign(cfg, resolveAgentIdentity(kitDir, 'BUILD', cfg));

const model = process.env.RALPH_MODEL || cfg.mastra?.model;
const baseUrl = process.env.MASTRA_BASE_URL || cfg.mastra?.baseUrl;
try {
  mastraModelConfig(model, { baseUrl });
} catch (err) {
  console.error(`[ralph-mastra] ${err.message}`);
  console.error('  Set one for this run: eventmodelers run --agent mastra --model anthropic/claude-sonnet-5-5');
  console.error('  Or persist a default as mastra.model (and mastra.baseUrl for an OpenAI-compatible endpoint) in .eventmodelers/config.json');
  process.exit(1);
}
if (localOnly) {
  console.error('[ralph-mastra] --local needs the platform: the Mastra agent reaches the board through its MCP server.');
  process.exit(1);
}

const tracingOn = cfg.agentTracing === true;
if (!tracingOn) console.log('[ralph-mastra] agent tracing off — no slice cost data is sent (turn on: eventmodelers config --agent-tracing on)');
const tracer = createSliceTracer({
  baseUrl: cfg.baseUrl,
  token: cfg.token,
  organizationId: cfg.organizationId,
  boardId: cfg.boardId,
  agentId: cfg.agentId,
  traceFile: join(projectDir, '.eventmodelers', 'trace', 'slices.jsonl'),
  log: (line) => console.log(`[ralph-mastra] ${line}`),
  enabled: tracingOn,
});

const inlineHeader = connectHeader(cfg, localOnly);
const timeoutMs = turnTimeoutMs(cfg);
const verbose = process.env.RALPH_VERBOSE === '1';

const INSTRUCTIONS =
  'You are the Eventmodelers build agent, working in the project directory. Read CLAUDE.md there first and follow it. ' +
  'The kit\'s skills are available through the skill tools. The eventmodelers MCP server is already connected and ' +
  'authenticated, so wherever the kit or a skill says to /connect first, that is done — use the eventmodelers tools ' +
  'directly. Nobody can answer questions: if something is unclear, post it as a board comment and carry on.';

console.log(`[ralph-mastra] model: ${model}`);
const session = await createMastraSession({
  model,
  baseUrl,
  instructions: INSTRUCTIONS,
  mcpUrl: `${cfg.baseUrl}/mcp`,
  token: cfg.token,
  agentId: cfg.agentId,
  cwd: projectDir,
  workspace: true,
  skillsDirs: ['.claude/skills'],
  // The shell commands the agent runs get what a `claude` process would: the credentials the skills' REST
  // fallback and the CLI read, and the rest of this process's environment.
  env: {
    ...process.env,
    ...(cfg.token ? { EVENTMODELERS_TOKEN: cfg.token } : {}),
    ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
  },
  log: (line) => console.log(`[ralph-mastra] ${line}`),
});

// `slice` is set for a planned-slice build (see startRalph) — the only turns that are traced.
async function runMastra(prompt, slice = null, extraEnv = {}) {
  // A planned slice starts a fresh conversation: the process and its MCP connection stay warm, but one slice's
  // reading and edits are not context for the next, and a session that never forgets would outgrow its window.
  if (slice) session.reset();
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const result = await session.runTurn(inlineHeader + prompt, {
      signal: controller.signal,
      env: extraEnv, // the curation turn's EVENTMODELERS_CURATING=1, which makes `learn` refuse to add learnings
      onToolCall: (name, args) => {
        recordToolCall({ kitDir, slice, tool: name, meta: eventMeta(cfg) });
        console.log(verbose ? `→ ${name} ${JSON.stringify(args).slice(0, 100)}` : `→ ${name}`);
      },
    });
    console.log(`done (${result.usage?.durationMs ?? '?'}ms)`);
    if (slice && result.usage) tracer.record({ ...slice, status: result.isError ? 'error' : 'ok' }, result.usage);
    if (result.isError) throw new Error(result.text || 'Mastra turn errored');
    return result.text;
  } catch (err) {
    if (controller.signal.aborted) {
      const timeout = new Error(`Mastra turn timed out after ${Math.round(timeoutMs / 60_000)}min`);
      timeout.timedOut = true; // lib/ralph.js lets it through to the stuck-slice guard instead of re-running it in place
      throw timeout;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { session.close().finally(() => process.exit(0)); });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runMastra,
  onPlannedSlice: runMastra,
  onCurate: (prompt, { env } = {}) => runMastra(prompt, null, env),
  localOnly,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
