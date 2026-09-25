#!/usr/bin/env node
// Ralph loop + realtime agent using Claude Code as the executor.
// Usage: node ralph-claude.js [project_dir]

import { startRalph, loadLocalConfig, resolveAgentIdentity } from './lib/ralph.js';
import { createSliceTracer, usageFromClaudeResult } from './lib/tracing.js';
import { turnTimeoutMs, superviseTurn, TurnTimeoutError } from './lib/turn.js';
import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

const cfg = loadLocalConfig(kitDir);
const localOnly = process.env.RALPH_LOCAL === '1';
// Resolved here, not left to startRalph: claudeEnv below is built at load time, and without it
// the agent id never reached `claude`, so its MCP calls went unattributed.
Object.assign(cfg, resolveAgentIdentity(kitDir, 'BUILD', cfg));

// What each slice build turn cost — see lib/tracing.js. Off unless the project opted in
// (`agentTracing: true`, see `eventmodelers config`); nothing is ever sent with --local.
const tracingOn = !localOnly && cfg.agentTracing === true;
if (!tracingOn && !localOnly) console.log('[ralph] agent tracing off — no slice cost data is sent (turn on: eventmodelers config --agent-tracing on)');
const tracer = createSliceTracer({
  baseUrl: cfg.baseUrl,
  token: cfg.token,
  organizationId: cfg.organizationId,
  agentId: cfg.agentId,
  traceFile: join(projectDir, '.eventmodelers', 'trace', 'slices.jsonl'),
  log: (line) => console.log(`[ralph] ${line}`),
  enabled: tracingOn,
});
// --local must mean zero board contact — never hand Claude live board
// credentials via the inline header, even if config.json has them, or it'll
// treat them as already-connected and skip straight to board sync.
// The token itself stays out of the prompt: `-p` is argv, visible to every local
// user in `ps`, and the prompt lands in session transcripts. The header names the
// env var instead (set in claudeEnv below) — connect treats it as the inline token,
// and a curl header written as "x-token: $EVENTMODELERS_TOKEN" expands in the shell.
const inlineHeader = !localOnly && cfg.boardId
  ? `board=${cfg.boardId} token=$EVENTMODELERS_TOKEN org=${cfg.organizationId} baseUrl=${cfg.baseUrl}\n\n`
  : '';
const timeoutMs = turnTimeoutMs(cfg);
// The model can still surface the token (e.g. a Bash command it expanded by hand), and
// --verbose logs tool input and assistant text as is — startRalph routes every console line
// through lib/redact.js, which masks it before it hits the log.
// --verbose here (set via `eventmodelers run --verbose`, passed down as RALPH_VERBOSE)
// logs full tool input and assistant reasoning text; the default (condensed) mode logs
// only the high-level step — a skill name, or a bare tool name — mirroring `run --modeling`'s
// own two-tier logging in cli.js.
const verbose = process.env.RALPH_VERBOSE === '1';

const claudeArgs = ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
if (cfg.model) claudeArgs.push('--model', cfg.model);
const claudeEnv = {
  ...process.env,
  ...(cfg.anthropicBaseUrl ? { ANTHROPIC_BASE_URL: cfg.anthropicBaseUrl } : {}),
  ...(cfg.token ? { EVENTMODELERS_TOKEN: cfg.token } : {}),
  // Lets the skills this agent runs send x-agent-id on their own calls (connect puts it in
  // `.mcp.json` and in every curl fallback), so their board writes are attributed to this agent.
  ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
};

// Collapses whitespace/newlines to a single line and truncates past `max` chars — a long
// multi-line curl command wrapped across many terminal lines is just as unreadable as no
// detail at all. Keeps one tool call to one log line.
function oneLine(s, max) {
  const collapsed = String(s ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function describeToolUse(block) {
  const input = block.input ?? {};
  switch (block.name) {
    case 'Bash': return `Bash: ${oneLine(input.command, 100)}`;
    case 'Skill': return `Skill: ${input.skill}${input.args ? ` ${oneLine(input.args, 60)}` : ''}`;
    case 'Read': return `Read: ${input.file_path}`;
    case 'Edit': return `Edit: ${input.file_path}`;
    case 'Write': return `Write: ${input.file_path}`;
    case 'Grep': return `Grep: ${oneLine(input.pattern, 60)}`;
    case 'Glob': return `Glob: ${input.pattern}`;
    case 'WebFetch': return `WebFetch: ${input.url}`;
    case 'Agent': return `Agent: ${oneLine(input.description ?? input.subagent_type ?? '', 60)}`;
    default: return block.name;
  }
}

// `slice` is set for a planned-slice build (see startRalph) — the only turns that are traced.
function runClaude(prompt, slice = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [...claudeArgs, '-p', inlineHeader + prompt], {
      cwd: projectDir,
      stdio: ['inherit', 'pipe', 'inherit'],
      env: claudeEnv,
    });
    const turn = superviseTurn(proc, { timeoutMs, label: 'Claude turn', log: (line) => console.error(`[ralph] ${line}`) });

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }

        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text && verbose) console.log(block.text);
            if (block.type === 'tool_use') {
              if (verbose) console.log(`→ ${describeToolUse(block)}`); // masked by lib/redact.js
              else if (block.name === 'Skill') console.log(`→ Skill: ${block.input?.skill ?? ''}`);
              else console.log(`→ ${block.name}`);
            }
          }
        } else if (msg.type === 'result') {
          console.log(`done (${msg.duration_ms}ms${msg.total_cost_usd ? `, $${msg.total_cost_usd.toFixed(4)}` : ''})`);
          if (slice) tracer.record({...slice, status: msg.is_error ? 'error' : 'ok'}, usageFromClaudeResult(msg));
        }
      }
    });

    proc.on('close', (code) => {
      if (turn.timedOut()) reject(new TurnTimeoutError('Claude turn', timeoutMs));
      else if (code === 0) resolve();
      else reject(new Error(`Claude exited ${code}`));
    });
    proc.on('error', reject);
  });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runClaude,
  onPlannedSlice: runClaude,
  localOnly,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
