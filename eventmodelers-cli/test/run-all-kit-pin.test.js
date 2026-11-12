import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempKit } from './helpers.js';

// `run --all` starts one `run` per build kit. Each must pin ITS OWN kit (EVENTMODELERS_KIT_DIR), so an agent's
// `slice-status` & co. reach the kit holding the claim — never the supervisor's cwd or a stale inherited value.

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));

test('run --all pins each kit for its own agent', (t) => {
  const root = realpathSync(tempKit(t));
  for (const dir of [root, join(root, 'web')]) {
    const kit = join(dir, '.build-kit');
    mkdirSync(kit, { recursive: true });
    // a stub runner: reports which kit it was pinned to
    writeFileSync(join(kit, 'ralph-claude.js'), `console.log('PINNED=' + process.env.EVENTMODELERS_KIT_DIR);`);
  }
  const res = spawnSync(process.execPath, [cli, 'run', '--all', '--sync'], {
    cwd: root, encoding: 'utf-8', timeout: 30000,
    // a stale pin inherited from some other shell must not leak into either kit
    env: { ...process.env, EVENTMODELERS_KIT_DIR: join(root, 'elsewhere'), EVENTMODELERS_TOKEN: '', FORCE_COLOR: '0' },
  });
  const out = res.stdout + res.stderr;
  assert.match(out, new RegExp(`PINNED=${join(root, '.build-kit').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), out);
  assert.match(out, new RegExp(`PINNED=${join(root, 'web', '.build-kit').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), out);
});
