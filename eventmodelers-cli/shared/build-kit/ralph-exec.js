#!/usr/bin/env node
// Ralph loop handing each prompt to an arbitrary external agent command, instead
// of the default Claude runner.
//
// This is the escape hatch for agentic harnesses that bring their own tool loop —
// Codex CLI, OpenCode, Gemini CLI, and whatever comes next. They are NOT --local-ai
// targets: --local-ai supplies the agent loop (we load the MCP tools and drive the
// tool-call rounds), whereas a harness already is one and only wants a prompt. One
// generic spawn covers all of them, which beats a hand-written runner per vendor.
//
// The prompt is appended to the command as a single quoted argument (what most
// harnesses expect) and is also written to a temp file named by RALPH_PROMPT_FILE,
// for commands that would rather read it than take it on the command line.
//
// Usage: node ralph-exec.js [project_dir]
//        RALPH_EXEC_CMD="codex exec --full-auto" node ralph-exec.js
//        RALPH_EXEC_CMD="opencode run" node ralph-exec.js
// Or persist it as localAi.exec in .eventmodelers/config.json.

import { startRalph, loadLocalConfig, resolveAgentIdentity } from './lib/ralph.js';
import { createSliceTracer, usageFromHarnessEvent, sumUsage } from './lib/tracing.js';
import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

const cfg = loadLocalConfig(kitDir);
const localOnly = process.env.RALPH_LOCAL === '1';
// Same as ralph-claude.js: childEnv is built at load time, before startRalph resolves identity.
Object.assign(cfg, resolveAgentIdentity(kitDir, 'BUILD', cfg));
const execCmd = process.env.RALPH_EXEC_CMD || cfg.localAi?.exec;

if (!execCmd) {
  console.error('[ralph-exec] No agent command configured.');
  console.error('  Set one for this run: eventmodelers run --exec "codex exec --full-auto"');
  console.error('  Or persist a default as localAi.exec in .eventmodelers/config.json');
  process.exit(1);
}

// Same rule as ralph-claude.js: --local must mean zero board contact, so credentials
// never reach the child even when config.json has them.
const inlineHeader = !localOnly && cfg.boardId
  ? `board=${cfg.boardId} token=${cfg.token} org=${cfg.organizationId} baseUrl=${cfg.baseUrl}\n\n`
  : '';

const childEnv = {
  ...process.env,
  ...(cfg.token && !localOnly ? { EVENTMODELERS_TOKEN: cfg.token } : {}),
  ...(cfg.agentId && !localOnly ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
};

// What each slice build turn cost — see lib/tracing.js. Same opt-in as ralph-claude.js, but a
// harness only reports usage in its JSON output mode (`codex exec --json`, `opencode run --format
// json`, `gemini --output-format stream-json`), so without that flag a turn has nothing to record.
const tracingOn = !localOnly && cfg.agentTracing === true;
if (!tracingOn && !localOnly) console.log('[ralph-exec] agent tracing off — no slice cost data is sent (turn on: eventmodelers config --agent-tracing on)');
const tracer = createSliceTracer({
  baseUrl: cfg.baseUrl,
  token: cfg.token,
  organizationId: cfg.organizationId,
  agentId: cfg.agentId,
  traceFile: join(projectDir, '.eventmodelers', 'trace', 'slices.jsonl'),
  log: (line) => console.log(`[ralph-exec] ${line}`),
  enabled: tracingOn,
});

const promptDir = mkdtempSync(join(tmpdir(), 'ralph-exec-'));

// POSIX single-quote escaping: close, insert an escaped quote, reopen. The prompt is
// multi-line Markdown with backticks and $ in it, so it cannot go in unquoted.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

console.log(`[ralph-exec] command: ${execCmd}`);

// Parses a harness's stdout for usage while still passing it through. Most harnesses emit JSONL;
// Gemini's `--output-format json` is one pretty-printed object, hence the whole-output fallback.
function collectUsage(stream) {
  const parts = [];
  let buffer = '';
  let all = '';
  const take = (text) => {
    try { const u = usageFromHarnessEvent(JSON.parse(text)); if (u) parts.push(u); } catch { /* not JSON */ }
  };
  stream.on('data', (chunk) => {
    process.stdout.write(chunk);
    const text = chunk.toString();
    all += text;
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) take(line);
  });
  return () => {
    if (buffer.trim()) take(buffer);
    if (!parts.length && all.trim()) take(all);
    return sumUsage(parts);
  };
}

// `slice` is set for a planned-slice build (see startRalph) — the only turns that are traced.
function runExec(prompt, slice = null) {
  return new Promise((resolvePromise, reject) => {
    const full = inlineHeader + prompt;
    const promptFile = join(promptDir, 'prompt.md');
    writeFileSync(promptFile, full);
    const traced = tracingOn && !!slice;
    const startedAt = Date.now();

    // stdio inherit: the harness owns its own output format, and there is no
    // cross-harness stream schema to parse into the condensed per-step logging
    // that ralph-claude.js does — so it goes straight through. A traced turn pipes
    // stdout instead, only to read usage from it; the output is still echoed as is.
    const proc = spawn(`${execCmd} ${shellQuote(full)}`, {
      cwd: projectDir,
      stdio: ['inherit', traced ? 'pipe' : 'inherit', 'inherit'],
      shell: true,
      env: { ...childEnv, RALPH_PROMPT_FILE: promptFile },
    });
    const usage = traced ? collectUsage(proc.stdout) : null;
    proc.on('close', (code) => {
      if (traced) {
        const u = usage();
        if (u) tracer.record({ ...slice, status: code === 0 ? 'ok' : 'error' }, { ...u, durationMs: u.durationMs ?? Date.now() - startedAt });
        else console.log('[ralph-exec] trace: no usage in the command output — run the harness in its JSON output mode to record slice cost');
      }
      code === 0 ? resolvePromise() : reject(new Error(`exec command exited ${code}`));
    });
    proc.on('error', reject);
  });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runExec,
  onPlannedSlice: runExec,
  localOnly,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
