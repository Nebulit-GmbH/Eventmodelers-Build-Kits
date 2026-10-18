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
