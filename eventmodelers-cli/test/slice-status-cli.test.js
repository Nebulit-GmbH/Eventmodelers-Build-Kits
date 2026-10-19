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
