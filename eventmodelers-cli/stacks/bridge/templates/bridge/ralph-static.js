#!/usr/bin/env node
// Bridge loop that hands each batch of slice changes to a deterministic JS
// adapter instead of an AI agent or an arbitrary shell hook — no LLM call
// happens in this mode. Which adapter runs is picked by bridge.json's target
// (adapters/<target>-adapter.js); if the installed target has no adapter file
// yet, this exits with a clear error rather than silently doing nothing.
//
// Usage: node ralph-static.js [project_dir]

import { startRalph, loadLocalConfig, fetchPlatformConfig } from './lib/ralph.js';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const projectDir = process.argv[2] ? resolve(process.argv[2]) : resolve(kitDir, '..');

function loadBridgeConfig() {
  const p = join(kitDir, 'bridge.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

const target = loadBridgeConfig().target;
if (!target) {
  console.error('[bridge-static] No target configured in bridge.json — run `eventmodelers init --bridge --target <name>` first.');
  process.exit(1);
}

const adapterPath = join(kitDir, 'adapters', `${target}-adapter.js`);
if (!existsSync(adapterPath)) {
  console.error(`[bridge-static] No static adapter for target "${target}" (expected ${adapterPath}).`);
  console.error('  Use the default Claude runner for this target instead: `eventmodelers bridge`.');
  process.exit(1);
}

const local = loadLocalConfig(kitDir);

// The adapter itself doesn't know about the bridge loop's .slices/ convention
// (fetch --spec-kitty calls the same run() with a context name of its own) —
// this is the one place that convention still applies, so resolve it here.
function readCurrentContext() {
  const ctxPath = join(kitDir, '.slices', 'current_context.json');
  if (!existsSync(ctxPath)) return null;
  try {
    return JSON.parse(readFileSync(ctxPath, 'utf-8')).name || null;
  } catch {
    return null;
  }
}

async function runAdapter() {
  const contextName = readCurrentContext();
  if (!contextName) {
    console.log('[bridge-static] No .slices/current_context.json yet — waiting for the first board sync.');
    return;
  }

  const { run } = await import(pathToFileURL(adapterPath).href);
  const cfg = await fetchPlatformConfig(local);
  try {
    await run({ cfg, projectDir, contextName });
  } catch (err) {
    // lib/ralph.js retries any onTask failure after 60s forever — right for
    // transient errors (network blips, a slow spec-kitty command), wrong for
    // a missing one-time setup step that retrying can never fix on its own.
    // Adapters flag those with `err.fatal` so we stop instead of looping.
    if (err.fatal) {
      console.error(`[bridge-static] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

startRalph({
  kitDir,
  projectDir,
  onTask: runAdapter,
  // onPlannedSlice omitted — see ralph-claude.js in this same directory.
  agentType: 'BRIDGE',
  queueAllStatuses: true,
}).catch((err) => {
  console.error('[ralph] Fatal:', err);
  process.exit(1);
});
