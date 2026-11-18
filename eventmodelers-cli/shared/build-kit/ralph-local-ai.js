#!/usr/bin/env node
// Ralph loop + realtime agent using a local AI model as the executor.
// Backend is selected by dialect, not by a separate runner: Ollama (native
// /api/chat) or any OpenAI-compatible server (vLLM, LM Studio, llama.cpp, TGI).
//
// Usage: node ralph-local-ai.js [project_dir]
//        LOCAL_AI_TARGET=ollama node ralph-local-ai.js          # run `ollama serve` first
//        LOCAL_AI_TARGET=vllm  node ralph-local-ai.js
//        LOCAL_AI_URL=http://gpu-box:8000/v1 LOCAL_AI_MODEL=Qwen/Qwen3-8B node ralph-local-ai.js
import { startRalph } from './lib/ralph.js';
import { turnTimeoutMs, superviseTurn } from './lib/turn.js';
import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');


// The task goes in on stdin, as it does for the Claude runner: the loop has already picked it.
function runLocalAi(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(kitDir, 'lib', 'local-ai-agent.js')], {
      cwd: projectDir,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: process.env,
    });
    proc.stdin.end(prompt);
    const turn = superviseTurn(proc, { timeoutMs: turnTimeoutMs({}), label: 'Local AI turn', log: (line) => console.error(`[ralph] ${line}`) });
    proc.on('close', (code) => {
      const err = turn.timeoutError();
      if (err) reject(err);
      else if (code === 0) resolve();
      else reject(new Error(`local-ai-agent exited ${code}`));
    });
    proc.on('error', reject);
  });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runLocalAi,
  // onPlannedSlice omitted — this runner works the queued tasks only
  localOnly: process.env.RALPH_LOCAL === '1',
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
