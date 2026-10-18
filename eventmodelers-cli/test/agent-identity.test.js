import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAgentName, withInstanceSuffix } from '../shared/build-kit/lib/agent-name.js';
import { forgetAgentLocks } from '../shared/build-kit/lib/agent-lock.js';
import { resolveAgentIdentity } from '../shared/build-kit/lib/ralph.js';
import { tempKit } from './helpers.js';

// An agent keeps one id and one name within a repo, unless this run overrides them (run --id / --name).

const ENV = ['RALPH_AGENT_ID', 'RALPH_AGENT_NAME', 'EVENTMODELERS_AGENT_ID'];
function cleanEnv(t) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  t.after(() => { forgetAgentLocks(); for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}
function project(t, { remote } = {}, dirName = 'cart-service') {
  const parent = tempKit(t);
  const root = join(parent, dirName);
  mkdirSync(join(root, '.build-kit'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
  return { root, kit: join(root, '.build-kit') };
}

// ── the default name ────────────────────────────────────────────────────────────

test('the default name is the repository\'s name from its origin remote, and the agent type', (t) => {
  const { root } = project(t, { remote: 'git@github.com:acme/cart-service.git' }, 'some-folder');
  assert.equal(defaultAgentName(root, 'BUILD'), 'cart-service (build)');
  assert.equal(defaultAgentName(root, 'MODELING'), 'cart-service (modeling)');
});

test('remote URLs of every usual shape give the repository name', (t) => {
  const names = ['https://github.com/acme/cart-service.git', 'https://github.com/acme/cart-service', 'https://github.com/acme/cart-service/', 'ssh://git@host:2222/acme/cart-service.git', 'git@host:cart-service.git'];
  for (const remote of names) assert.equal(defaultAgentName(project(t, { remote }).root, 'BUILD'), 'cart-service (build)', remote);
});

test('without a remote the folder name is the repository name, outside git too', (t) => {
  assert.equal(defaultAgentName(project(t, {}, 'billing').root, 'BUILD'), 'billing (build)');
  const bare = tempKit(t);
  assert.match(defaultAgentName(bare, 'BUILD'), /^ralph-test-.* \(build\)$/);
});

test('the default name is the same every time', (t) => {
  const { root } = project(t, { remote: 'git@github.com:acme/cart-service.git' });
  assert.equal(defaultAgentName(root, 'BUILD'), defaultAgentName(root, 'BUILD'));
});

// ── resolveAgentIdentity: stable id, name with a default, overrides win and write nothing ──

test('the id is minted once per project and is the same on every later run', (t) => {
  cleanEnv(t);
  const { kit, root } = project(t);
  const first = resolveAgentIdentity(kit, 'BUILD', {});
  delete process.env.EVENTMODELERS_AGENT_ID;
  const second = resolveAgentIdentity(kit, 'BUILD', {});
  assert.match(first.agentId, /^[0-9a-f-]{36}$/);
  assert.equal(second.agentId, first.agentId);
  assert.equal(JSON.parse(readFileSync(join(root, '.eventmodelers', 'config.json'), 'utf-8')).agentIds.BUILD, first.agentId);
});

test('--id overrides the id for that run only: nothing is written and the project\'s own id comes back', (t) => {
  cleanEnv(t);
  const { kit } = project(t);
  const own = resolveAgentIdentity(kit, 'BUILD', {}).agentId;
  process.env.RALPH_AGENT_ID = 'pinned-id';
  assert.equal(resolveAgentIdentity(kit, 'BUILD', {}).agentId, 'pinned-id');
  delete process.env.RALPH_AGENT_ID;
  assert.equal(resolveAgentIdentity(kit, 'BUILD', {}).agentId, own);
});

test('each agent type keeps its own id in the same project', (t) => {
  cleanEnv(t);
  const { kit } = project(t);
  const build = resolveAgentIdentity(kit, 'BUILD', {}).agentId;
  const modeling = resolveAgentIdentity(kit, 'MODELING', {}).agentId;
  assert.notEqual(build, modeling);
  assert.equal(resolveAgentIdentity(kit, 'BUILD', {}).agentId, build);
});

test('the name is, in order: --name, the configured agentName, the repository default', (t) => {
  cleanEnv(t);
  const { kit } = project(t, { remote: 'git@github.com:acme/cart-service.git' });
  assert.equal(resolveAgentIdentity(kit, 'BUILD', {}).agentName, 'cart-service (build)');
  assert.equal(resolveAgentIdentity(kit, 'BUILD', { agentName: 'ci-builder' }).agentName, 'ci-builder');
  process.env.RALPH_AGENT_NAME = 'martins-laptop';
  assert.equal(resolveAgentIdentity(kit, 'BUILD', { agentName: 'ci-builder' }).agentName, 'martins-laptop');
});

test('the default name is derived, never written into the project\'s config', (t) => {
  cleanEnv(t);
  const { kit, root } = project(t, { remote: 'git@github.com:acme/cart-service.git' });
  resolveAgentIdentity(kit, 'BUILD', {});
  const config = JSON.parse(readFileSync(join(root, '.eventmodelers', 'config.json'), 'utf-8'));
  assert.equal('agentName' in config, false);
  assert.equal(existsSync(join(kit, '.eventmodelers')), false);
});

// ── one live process per id ─────────────────────────────────────────────────────

const lockPath = (root, id) => join(root, '.eventmodelers', 'locks', `${id}.lock`);
function otherProcessHolds(root, kit, agentType = 'BUILD') {
  // Mint the project's stable id as a first run would, then let "another live process" (our parent) hold it.
  const id = resolveAgentIdentity(kit, agentType, {}).agentId;
  forgetAgentLocks();
  delete process.env.EVENTMODELERS_AGENT_ID;
  writeFileSync(lockPath(root, id), JSON.stringify({ pid: process.ppid, startedAt: 'earlier' }));
  return id;
}

test('a second process in the same project gets a fresh id and an instance-marked name, and the stored id is untouched', (t) => {
  cleanEnv(t);
  const { kit, root } = project(t, { remote: 'git@github.com:acme/cart-service.git' });
  const stored = otherProcessHolds(root, kit);
  const second = resolveAgentIdentity(kit, 'BUILD', {});
  assert.notEqual(second.agentId, stored);
  assert.match(second.agentId, /^[0-9a-f-]{36}$/);
  assert.equal(second.agentName, withInstanceSuffix('cart-service (build)', second.agentId));
  assert.match(second.agentName, /^cart-service \(build\) · [0-9a-f]{4}$/);
  assert.equal(JSON.parse(readFileSync(join(root, '.eventmodelers', 'config.json'), 'utf-8')).agentIds.BUILD, stored);
});

test('the fallback is decided once per process: asking again gives the same id and name', (t) => {
  cleanEnv(t);
  const { kit, root } = project(t);
  otherProcessHolds(root, kit);
  const first = resolveAgentIdentity(kit, 'BUILD', {});
  assert.deepEqual(resolveAgentIdentity(kit, 'BUILD', {}), first);
});

test('an explicit name is kept as given even when the id fell back', (t) => {
  cleanEnv(t);
  const { kit, root } = project(t);
  otherProcessHolds(root, kit);
  assert.equal(resolveAgentIdentity(kit, 'BUILD', { agentName: 'ci-builder' }).agentName, 'ci-builder');
});

test("--id is the operator's choice: no lock is taken and the name is not marked", (t) => {
  cleanEnv(t);
  const { kit, root } = project(t, { remote: 'git@github.com:acme/cart-service.git' });
  process.env.RALPH_AGENT_ID = 'pinned-id';
  const identity = resolveAgentIdentity(kit, 'BUILD', {});
  assert.deepEqual({ id: identity.agentId, name: identity.agentName }, { id: 'pinned-id', name: 'cart-service (build)' });
  assert.equal(existsSync(lockPath(root, 'pinned-id')), false);
});

test('the build and modeling agents of one project do not lock each other out', (t) => {
  cleanEnv(t);
  const { kit } = project(t);
  const build = resolveAgentIdentity(kit, 'BUILD', {});
  const modeling = resolveAgentIdentity(kit, 'MODELING', {});
  assert.equal(build.agentName.includes('·'), false);
  assert.equal(modeling.agentName.includes('·'), false);
});

test('withInstanceSuffix marks a name with the first four characters of the id', () => {
  assert.equal(withInstanceSuffix('billing (modeling)', 'abcd1234-0000'), 'billing (modeling) · abcd');
});
