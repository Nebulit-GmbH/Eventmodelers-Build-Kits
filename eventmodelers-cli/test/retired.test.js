import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Retired for now (the tasks queue moves to events and these were its direct readers and writers):
// the bash-only loop. It is gone, not hidden — no script, no flag.

const root = fileURLToPath(new URL('..', import.meta.url));

test('the bash loop and its helpers are gone from the shared build kit', () => {
  for (const f of ['ralph.sh', 'realtime-agent.js', 'lib/agent.sh']) assert.equal(existsSync(join(root, 'shared/build-kit', f)), false, f);
});

test('run --bash is an unknown option', () => {
  const res = spawnSync(process.execPath, [join(root, 'cli.js'), 'run', '--bash'], { encoding: 'utf-8' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unknown option '--bash'/);
});

// The bridge kit (init --bridge / the bridge command, which ran on the same tasks.json queue) is retired too.
// `fetch --spec-kitty` stays: it is the adapter on its own, with no standing loop.

test('the bridge kit templates, skills and command are gone', () => {
  assert.equal(existsSync(join(root, 'stacks/bridge')), false);
  assert.equal(existsSync(join(root, 'shared/bridge')), false);
  assert.equal(existsSync(join(root, 'lib/adapters/spec-kitty-adapter.js')), true);
});

test('init --bridge is an unknown option and bridge is an unknown command', () => {
  const init = spawnSync(process.execPath, [join(root, 'cli.js'), 'init', '--bridge'], { encoding: 'utf-8' });
  assert.notEqual(init.status, 0);
  assert.match(init.stderr, /unknown option '--bridge'/);
  const bridge = spawnSync(process.execPath, [join(root, 'cli.js'), 'bridge'], { encoding: 'utf-8' });
  assert.notEqual(bridge.status, 0);
  assert.match(bridge.stderr, /unknown command 'bridge'/);
});

test('fetch still offers --spec-kitty', () => {
  const help = spawnSync(process.execPath, [join(root, 'cli.js'), 'fetch', '--help'], { encoding: 'utf-8' });
  assert.match(help.stdout, /--spec-kitty/);
});
