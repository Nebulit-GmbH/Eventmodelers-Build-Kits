import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { tempKit } from './helpers.js';

// `eventmodelers learn` / `learnings` — how a build agent records and withdraws learnings.

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function project(t) {
  const root = tempKit(t);
  mkdirSync(join(root, '.build-kit'), { recursive: true });
  return { root, kit: join(root, '.build-kit') };
}
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], {
  cwd: root, encoding: 'utf-8', env: { ...process.env, RALPH_AGENT_ID: 'agent-7', EVENTMODELERS_TOKEN: '', FORCE_COLOR: '0' },
});
const agents = (kit) => readFileSync(join(kit, 'AGENTS.md'), 'utf-8');

test('learn records a learning with topic, tags and scope, stamped with the agent, and writes AGENTS.md', (t) => {
  const { root, kit } = project(t);
  const res = run(root, 'learn', 'Run the suite with npm test', '--topic', 'Testing', '--tag', 'ci', '--tag', 'node', '--scope', 'repo');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /recorded/i);
  assert.match(agents(kit), /## Testing\n- Run the suite with npm test\n/);
  const [event] = readEvents(kit);
  assert.deepEqual({ tags: event.tags, scope: event.scope, agent: event.meta.agent_id }, { tags: ['ci', 'node'], scope: 'repo', agent: 'agent-7' });
});

test('learning the same thing twice says so and records nothing new', (t) => {
  const { root, kit } = project(t);
  run(root, 'learn', 'Use npm test');
  const res = run(root, 'learn', 'use  NPM test');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /already/i);
  assert.equal(readEvents(kit).length, 1);
});

test('learnings --ids lists each learning with the id to retract it by; learn --retract withdraws it', (t) => {
  const { root, kit } = project(t);
  run(root, 'learn', 'wrong claim', '--topic', 'Git');
  run(root, 'learn', 'right claim');
  const list = run(root, 'learnings', '--ids');
  assert.equal(list.status, 0, list.stderr);
  const line = list.stdout.split('\n').find((l) => l.includes('wrong claim'));
  assert.match(line, /^\s*[0-9a-f]{8}\s+\[Git\]\s+wrong claim/);
  const id = line.trim().split(/\s+/)[0];
  const res = run(root, 'learn', '--retract', id);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(agents(kit), /wrong claim/);
  assert.equal(fold(readEvents(kit)).learnings.length, 1);
});

test('learnings without --ids prints what AGENTS.md says', (t) => {
  const { root } = project(t);
  run(root, 'learn', 'Use npm test', '--topic', 'Testing');
  const res = run(root, 'learnings');
  assert.match(res.stdout, /## Testing\n- Use npm test/);
});

test('learn without text or --retract, a bad scope and an unknown id are refused', (t) => {
  const { root, kit } = project(t);
  assert.equal(run(root, 'learn').status, 1);
  assert.match(run(root, 'learn', 'x', '--scope', 'galaxy').stderr, /scope/);
  assert.match(run(root, 'learn', '--retract', 'nope').stderr, /no learning/i);
  assert.equal(readEvents(kit).length, 0);
});

test('without a build kit there is nowhere to record', (t) => {
  const res = run(tempKit(t), 'learn', 'x');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /No eventmodelers kit installed/);
});
