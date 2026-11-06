import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { claimSlice } from '../shared/build-kit/lib/slice-run.js';
import { tempKit } from './helpers.js';

// `eventmodelers slice-status <status>` — how a build agent records its outcome without editing index.json.

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));

async function projectWithClaim(t) {
  const root = tempKit(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const kit = join(root, '.build-kit');
  mkdirSync(join(kit, '.slices', 'cart', 'additem'), { recursive: true });
  writeFileSync(join(kit, '.slices', 'cart', 'index.json'), JSON.stringify({ slices: [{ id: 's1', slice: 'Add item', folder: 'additem', status: 'Planned' }] }));
  await claimSlice({ kitDir: kit, planned: { id: 's1', title: 'Add item', ctx: 'cart' }, board: null, meta: {}, cleanTree: true });
  return { root, kit };
}
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], {
  cwd: root, encoding: 'utf-8', env: { ...process.env, RALPH_AGENT_ID: 'agent-7', EVENTMODELERS_TOKEN: '', FORCE_COLOR: '0' },
});

test('records the outcome for the claimed slice and projects it into index.json', async (t) => {
  const { root, kit } = await projectWithClaim(t);
  const res = run(root, 'slice-status', 'done');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Add item.*Done/);
  assert.equal(JSON.parse(readFileSync(join(kit, '.slices', 'cart', 'index.json'), 'utf-8')).slices[0].status, 'Done');
  const [recorded] = readEvents(kit).filter((e) => e.type === 'agent-recorded');
  assert.deepEqual({ slice: recorded.slice, status: recorded.status, agent: recorded.meta.agent_id }, { slice: 's1', status: 'Done', agent: 'agent-7' });
});

test('an unknown status is refused and lists the valid ones', async (t) => {
  const { root, kit } = await projectWithClaim(t);
  const res = run(root, 'slice-status', 'Finished');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Waiting/);
  assert.equal(readEvents(kit).some((e) => e.type === 'agent-recorded'), false);
});

test('without a claimed slice it says why and exits non-zero', (t) => {
  const root = tempKit(t);
  mkdirSync(join(root, '.build-kit'), { recursive: true });
  const res = run(root, 'slice-status', 'Done');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /update-slice-status/);
});

// The agent's shell drifts (an app with a root kit and a web/ kit, the agent cd's into the root to run the
// tests) — the loop pins its kit with EVENTMODELERS_KIT_DIR so the outcome still reaches the kit holding the claim.
test('EVENTMODELERS_KIT_DIR wins over the shell cwd, which may have drifted to another directory', async (t) => {
  const { root, kit } = await projectWithClaim(t);
  const elsewhere = join(root, 'drifted');
  mkdirSync(join(elsewhere, '.build-kit'), { recursive: true }); // a sibling kit with no claim — what the agent used to hit
  const env = { ...process.env, RALPH_AGENT_ID: 'agent-7', EVENTMODELERS_TOKEN: '', FORCE_COLOR: '0' };

  const unpinned = spawnSync(process.execPath, [cli, 'slice-status', 'done'], { cwd: elsewhere, encoding: 'utf-8', env });
  assert.equal(unpinned.status, 1, 'without the pin the drifted shell finds the wrong kit');

  const pinned = spawnSync(process.execPath, [cli, 'slice-status', 'done'], { cwd: elsewhere, encoding: 'utf-8', env: { ...env, EVENTMODELERS_KIT_DIR: kit } });
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.equal(readEvents(kit).filter((e) => e.type === 'agent-recorded').length, 1);
});

test('a stale EVENTMODELERS_KIT_DIR (directory gone) is ignored, not trusted', async (t) => {
  const { root } = await projectWithClaim(t);
  const res = spawnSync(process.execPath, [cli, 'slice-status', 'done'], {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, RALPH_AGENT_ID: 'agent-7', EVENTMODELERS_TOKEN: '', FORCE_COLOR: '0', EVENTMODELERS_KIT_DIR: join(root, 'gone') },
  });
  assert.equal(res.status, 0, res.stderr);
});
