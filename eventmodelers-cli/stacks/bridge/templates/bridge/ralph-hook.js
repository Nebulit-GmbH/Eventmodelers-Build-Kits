#!/usr/bin/env node
// Bridge loop that hands each batch of slice changes to an arbitrary external
// command instead of an AI agent — e.g. commit + push .slices/ and let a CI
// pipeline take it from there. No Claude/Ollama call happens in this mode.
//
// Configure the hook with `bridge --hook "<command>"` (one-off) or persist a
// default with `init --bridge --target <name> --hook "<command>"`.
//
// Usage: node ralph-hook.js [project_dir]
//        BRIDGE_HOOK_CMD="git add .slices && git commit -m sync && git push" node ralph-hook.js

import { startRalph } from './lib/ralph.js';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

// bridge.json (not .eventmodelers/config.json) — a plain, committed sibling
// file, since target/hookCommand are project policy meant to be shared with
// every teammate and CI runner, not gitignored per-machine state.
function loadBridgeConfig() {
  const p = join(kitDir, 'bridge.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
}

const hookCmd = process.env.BRIDGE_HOOK_CMD || loadBridgeConfig().hookCommand;
if (!hookCmd) {
  console.error('[bridge-hook] No hook command configured.');
  console.error('  Set one for this run: eventmodelers bridge --hook "<command>"');
  console.error('  Or persist a default: eventmodelers init --bridge --target <name> --hook "<command>"');
  process.exit(1);
}

const tasksPath = join(kitDir, 'tasks.json');

function readTasks() {
  try {
    return JSON.parse(readFileSync(tasksPath, 'utf-8'));
  } catch {
    return [];
  }
}

// Batched, not one-task-at-a-time: a hook like "commit + push .slices/" acts
// on the whole current board export in one shot (already fresh — lib/ralph.js
// re-syncs .slices/ before every task is queued), not on a single slice's
// translation the way an AI agent does. Only the tasks present at invocation
// time are cleared afterward — anything the realtime agent queues *while* the
// hook is still running is left in place for the next tick, so a slice change
// arriving mid-run is never silently dropped.
function runHook() {
  const batch = readTasks();
  if (!batch.length) return Promise.resolve();

  const batchFilePath = join(kitDir, 'last-hook-batch.json');
  mkdirSync(kitDir, { recursive: true });
  writeFileSync(batchFilePath, JSON.stringify(batch, null, 2));

  const latest = batch[batch.length - 1]?.payload ?? {};

  return new Promise((resolvePromise, reject) => {
    console.log(`[bridge-hook] Running hook for ${batch.length} change(s): ${hookCmd}`);
    const proc = spawn(hookCmd, {
      cwd: projectDir,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        BRIDGE_BATCH_FILE: batchFilePath,
        BRIDGE_TASK_COUNT: String(batch.length),
        BRIDGE_SLICE_ID: latest.sliceId ?? '',
        BRIDGE_SLICE_TITLE: latest.sliceTitle ?? '',
        BRIDGE_SLICE_STATUS: latest.sliceStatus ?? '',
        BRIDGE_BOARD_ID: latest.boardId ?? '',
        BRIDGE_ORGANIZATION_ID: latest.organizationId ?? '',
      },
    });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`hook exited ${code}`));
      const handledIds = new Set(batch.map((t) => t.id));
      const remaining = readTasks().filter((t) => !handledIds.has(t.id));
      writeFileSync(tasksPath, JSON.stringify(remaining, null, 2), 'utf-8');
      resolvePromise();
    });
    proc.on('error', reject);
  });
}

startRalph({
  kitDir,
  projectDir,
  onTask: runHook,
  // onPlannedSlice omitted — see stacks/bridge/templates/bridge/ralph-claude.js
  agentType: 'BRIDGE',
  queueAllStatuses: true,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
