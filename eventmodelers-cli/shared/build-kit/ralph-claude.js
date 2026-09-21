#!/usr/bin/env node
// Ralph loop + realtime agent using Claude Code as the executor.
// Usage: node ralph-claude.js [project_dir]

import { startRalph, loadLocalConfig } from './lib/ralph.js';
import { createTracer, newId, usageFromClaudeResult, SLICE_TOKENS_SPENT } from './lib/tracing.js';
import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

const cfg = loadLocalConfig(kitDir);
const localOnly = process.env.RALPH_LOCAL === '1';
// --local must mean zero board contact — never hand Claude live board
// credentials via the inline header, even if config.json has them, or it'll
// treat them as already-connected and skip straight to board sync.
const inlineHeader = !localOnly && cfg.boardId
  ? `board=${cfg.boardId} token=${cfg.token} org=${cfg.organizationId} baseUrl=${cfg.baseUrl}\n\n`
  : '';

// --verbose here (set via `eventmodelers run --verbose`, passed down as RALPH_VERBOSE)
// logs full tool input and assistant reasoning text; the default (condensed) mode logs
// only the high-level step — a skill name, or a bare tool name — mirroring `run --modeling`'s
// own two-tier logging in cli.js.
const verbose = process.env.RALPH_VERBOSE === '1';

// startRalph mints the session and puts it in the environment before the loop runs, but this
// module is evaluated first — so read what is there and fall back to minting one, which is also
// what makes this runner work when driven directly rather than through startRalph.
const sessionId = process.env.EVENTMODELERS_SESSION_ID || newId();
process.env.EVENTMODELERS_SESSION_ID = sessionId;

const claudeArgs = ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
if (cfg.model) claudeArgs.push('--model', cfg.model);
const claudeEnv = {
  ...process.env,
  ...(cfg.anthropicBaseUrl ? { ANTHROPIC_BASE_URL: cfg.anthropicBaseUrl } : {}),
  ...(cfg.token ? { EVENTMODELERS_TOKEN: cfg.token } : {}),
  // Lets the skills this agent runs send x-agent-id on their own calls (connect puts it in
  // `.mcp.json` and in every curl fallback), so their board writes are attributed to this agent.
  ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
  // Expanded by `claude` into .mcp.json's x-agent-session-id header, so the MCP tool calls it
  // makes land in the same tracing session as this loop's own REST calls.
  EVENTMODELERS_SESSION_ID: sessionId,
};

const tracer = createTracer({
  baseUrl: cfg.baseUrl,
  token: cfg.token,
  organizationId: cfg.organizationId,
  boardId: cfg.boardId,
  agentId: cfg.agentId,
  agentName: cfg.agentName,
  agentType: 'BUILD',
  sessionId,
  traceFile: join(projectDir, '.eventmodelers', 'trace', `${sessionId}.jsonl`),
  log: (line) => console.log(`[ralph] ${line}`),
  // --local means zero board contact; that has to include the tracing upload, or the one flag
  // whose whole promise is "no network" would quietly start making requests.
  enabled: !localOnly,
});

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

// `context` is what the loop knows about this turn (see startRalph's docs) — the slice it is
// building, so the turn's cost can be recorded against that slice rather than against the run
// as a whole. Absent when a runner is driven directly, in which case the cost still lands on
// the session.
function runClaude(prompt, context = {}) {
  return new Promise((resolve, reject) => {
    const turnId = newId();
    const proc = spawn('claude', [...claudeArgs, '-p', inlineHeader + prompt], {
      cwd: projectDir,
      stdio: ['inherit', 'pipe', 'inherit'],
      env: claudeEnv,
    });

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
              if (verbose) console.log(`→ ${describeToolUse(block)}`);
              else if (block.name === 'Skill') console.log(`→ Skill: ${block.input?.skill ?? ''}`);
              else console.log(`→ ${block.name}`);
            }
          }
        } else if (msg.type === 'result') {
          // `result` is the only trustworthy accounting for the turn: assistant events carry
          // mid-stream snapshots, and only modelUsage can price a turn whose subagents ran on a
          // different model than its lead.
          const usage = usageFromClaudeResult(msg);
          console.log(
            `done (${msg.duration_ms}ms${msg.total_cost_usd ? `, $${msg.total_cost_usd.toFixed(4)}` : ''}` +
            `${usage.outputTokens ? `, ${usage.outputTokens} out / ${usage.inputTokens + usage.cacheReadTokens} in` : ''})`,
          );
          tracer.record(SLICE_TOKENS_SPENT, usage, {
            turnId,
            sliceId: context.sliceId ?? null,
            // A slice's id IS its SLICE_BORDER node id, so a node-scoped report finds it too.
            nodeId: context.sliceId ?? null,
            boardId: context.boardId ?? null,
            action: context.source === 'task' ? 'slice-task-turn' : 'slice-build-turn',
            surface: 'claude-stream',
            status: msg.is_error ? 'error' : 'ok',
            meta: {sliceTitle: context.sliceTitle ?? null, attempt: context.attempt ?? null},
          });
            }
      }
    });

    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Claude exited ${code}`))));
    proc.on('error', reject);
  });
}

// A build loop ends by being stopped rather than by finishing, so the session rollup has to be
// taken on the way out or it is never taken at all.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    tracer.end({action: 'session-end'}).catch(() => {}).finally(() => process.exit(0));
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
