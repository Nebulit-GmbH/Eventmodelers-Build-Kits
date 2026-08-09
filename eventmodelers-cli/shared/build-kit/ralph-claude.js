#!/usr/bin/env node
// Ralph loop + realtime agent using Claude Code as the executor.
// Usage: node ralph-claude.js [project_dir]

import { startRalph, loadLocalConfig } from './lib/ralph.js';
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

const cfg = loadLocalConfig(kitDir);
const inlineHeader = cfg.boardId
  ? `board=${cfg.boardId} token=${cfg.token} org=${cfg.organizationId} baseUrl=${cfg.baseUrl}\n\n`
  : '';

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

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
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
          console.log(`done (${msg.duration_ms}ms${msg.total_cost_usd ? `, $${msg.total_cost_usd.toFixed(4)}` : ''})`);
        }
      }
    });

    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Claude exited ${code}`))));
    proc.on('error', reject);
  });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runClaude,
  onPlannedSlice: runClaude,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
