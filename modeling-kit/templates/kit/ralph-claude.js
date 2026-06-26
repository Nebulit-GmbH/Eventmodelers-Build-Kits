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
const QUESTIONING_RULE =
  'IMPORTANT: You are running autonomously — no human is available to answer questions. ' +
  'If you need clarification to proceed, do NOT pause or ask interactively. Instead, post your question ' +
  'as a QUESTION-type comment (via /handle-comment with action=place and type=QUESTION) on the most ' +
  'relevant slice or column node on the board, then continue with your best interpretation of the prompt.\n\n';

const inlineHeader = cfg.boardId
  ? `board=${cfg.boardId} token=${cfg.token} org=${cfg.organizationId} baseUrl=${cfg.baseUrl}\n\n${QUESTIONING_RULE}`
  : QUESTIONING_RULE;

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
      console.log(`Processing ${prompt}`)
    const proc = spawn('claude', ['--dangerously-skip-permissions', '-p', inlineHeader + prompt], {
      cwd: projectDir,
      stdio: 'inherit',
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Claude exited ${code}`))));
    proc.on('error', reject);
  });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runClaude,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
