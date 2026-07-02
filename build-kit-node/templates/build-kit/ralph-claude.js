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

const claudeArgs = ['--dangerously-skip-permissions'];
if (cfg.model) claudeArgs.push('--model', cfg.model);
const claudeEnv = cfg.anthropicBaseUrl
  ? { ...process.env, ANTHROPIC_BASE_URL: cfg.anthropicBaseUrl }
  : process.env;

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [...claudeArgs, '-p', inlineHeader + prompt], {
      cwd: projectDir,
      stdio: 'inherit',
      env: claudeEnv,
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
