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

const promptDir = mkdtempSync(join(tmpdir(), 'ralph-exec-'));

// POSIX single-quote escaping: close, insert an escaped quote, reopen. The prompt is
// multi-line Markdown with backticks and $ in it, so it cannot go in unquoted.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

console.log(`[ralph-exec] command: ${execCmd}`);

function runExec(prompt) {
  return new Promise((resolvePromise, reject) => {
    const full = inlineHeader + prompt;
    const promptFile = join(promptDir, 'prompt.md');
    writeFileSync(promptFile, full);

    // stdio inherit: the harness owns its own output format, and there is no
    // cross-harness stream schema to parse into the condensed per-step logging
    // that ralph-claude.js does — so it goes straight through.
    const proc = spawn(`${execCmd} ${shellQuote(full)}`, {
      cwd: projectDir,
      stdio: 'inherit',
      shell: true,
      env: { ...childEnv, RALPH_PROMPT_FILE: promptFile },
    });
    proc.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`exec command exited ${code}`))));
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
