import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Retired for now (the tasks queue moves to events and these were its direct readers and writers):
// the bash-only loop. The scripts are gone; the flags are only recognised to say so (see RETIRED_* in cli.js).

const root = fileURLToPath(new URL('..', import.meta.url));

test('the bash loop and its helpers are gone from the shared build kit', () => {
  for (const f of ['ralph.sh', 'realtime-agent.js', 'lib/agent.sh']) assert.equal(existsSync(join(root, 'shared/build-kit', f)), false, f);
});

const cli = (...args) => spawnSync(process.execPath, [join(root, 'cli.js'), ...args], { encoding: 'utf-8', env: { ...process.env, EVENTMODELERS_NO_UPDATE_CHECK: '1' } });

test('run --bash says it is retired and what to use instead, and is not in --help', () => {
  const res = cli('run', '--bash');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /`run --bash`.*retired/);
  assert.match(res.stderr, /npx @eventmodelers\/cli run/);
  assert.doesNotMatch(cli('run', '--help').stdout, /--bash/);
});

// The bridge kit (init --bridge / the bridge command, which ran on the same tasks.json queue) is retired too.
// `fetch --spec-kitty` stays: it is the adapter on its own, with no standing loop.

test('the bridge kit templates, skills and command are gone', () => {
  assert.equal(existsSync(join(root, 'stacks/bridge')), false);
  assert.equal(existsSync(join(root, 'shared/bridge')), false);
  assert.equal(existsSync(join(root, 'lib/adapters/spec-kitty-adapter.js')), true);
});

test('init --bridge and the bridge command say they are retired, with or without their old options', () => {
  for (const args of [['init', '--bridge', '--target', 'spec-kitty'], ['init', '--bridge'], ['bridge'], ['bridge', '--hook', 'x']]) {
    const res = cli(...args);
    assert.notEqual(res.status, 0, args.join(' '));
    assert.match(res.stderr, /bridge kit.*retired/, args.join(' '));
    assert.match(res.stderr, /fetch --spec-kitty/);
  }
  assert.doesNotMatch(cli('--help').stdout, /bridge/);
  assert.doesNotMatch(cli('init', '--help').stdout, /--bridge/);
});

test('fetch still offers --spec-kitty', () => {
  const help = spawnSync(process.execPath, [join(root, 'cli.js'), 'fetch', '--help'], { encoding: 'utf-8' });
  assert.match(help.stdout, /--spec-kitty/);
});
