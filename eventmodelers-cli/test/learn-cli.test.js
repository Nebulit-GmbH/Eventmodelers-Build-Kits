import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
// A learning is a problem and its solution under a topic — `learn` refuses anything else (see composeLearning).
const learn = (root, problem, solution = 'do the right thing', topic = 'General', ...more) => run(root, 'learn', '--problem', problem, '--solution', solution, '--topic', topic, ...more);
const agents = (kit) => readFileSync(join(kit, 'AGENTS.md'), 'utf-8');

test('learn records a learning with topic, tags and scope, stamped with the agent, and writes AGENTS.md', (t) => {
  const { root, kit } = project(t);
  const res = learn(root, 'Tests need running', 'Run the suite with npm test', 'Testing', '--tag', 'ci', '--tag', 'node', '--scope', 'repo');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /recorded/i);
  assert.match(agents(kit), /## Testing\n- Tests need running → Run the suite with npm test\n/);
  const [event] = readEvents(kit);
  assert.deepEqual({ tags: event.tags, scope: event.scope, agent: event.meta.agent_id }, { tags: ['ci', 'node'], scope: 'repo', agent: 'agent-7' });
});

test('learning the same thing twice says so and records nothing new', (t) => {
  const { root, kit } = project(t);
  learn(root, 'Tests need running', 'Use npm test');
  const res = learn(root, 'tests  need running', 'use  NPM test');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /already/i);
  assert.equal(readEvents(kit).length, 1);
});

test('learnings --ids lists each learning with the id to retract it by; learn --retract withdraws it', (t) => {
  const { root, kit } = project(t);
  learn(root, 'Claim', 'wrong claim', 'Git');
  learn(root, 'Other claim', 'right claim');
  const list = run(root, 'learnings', '--ids');
  assert.equal(list.status, 0, list.stderr);
  const line = list.stdout.split('\n').find((l) => l.includes('wrong claim'));
  assert.match(line, /^\s*[0-9a-f]{8}\s+\[Git\]\s+Claim → wrong claim/);
  const id = line.trim().split(/\s+/)[0];
  const res = run(root, 'learn', '--retract', id);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(agents(kit), /wrong claim/);
  assert.equal(fold(readEvents(kit)).learnings.length, 1);
});

test('learnings without --ids prints what AGENTS.md says', (t) => {
  const { root } = project(t);
  learn(root, 'Tests need running', 'Use npm test', 'Testing');
  const res = run(root, 'learnings');
  assert.match(res.stdout, /## Testing\n- Tests need running → Use npm test/);
});

test('learn without text or --retract, a bad scope and an unknown id are refused', (t) => {
  const { root, kit } = project(t);
  assert.equal(run(root, 'learn').status, 1);
  assert.match(learn(root, 'p', 's', 't', '--scope', 'galaxy').stderr, /scope/);
  assert.match(run(root, 'learn', '--retract', 'nope').stderr, /no learning/i);
  assert.equal(readEvents(kit).length, 0);
});

test('learn enforces a short problem, a short solution and a topic', (t) => {
  const { root, kit } = project(t);
  const free = run(root, 'learn', 'Use npm test');
  assert.equal(free.status, 1);
  assert.match(free.stderr, /problem and its solution/);
  assert.match(run(root, 'learn', '--problem', 'p', '--solution', 's').stderr, /needs --topic/);
  assert.match(run(root, 'learn', '--problem', 'p', '--topic', 't').stderr, /needs --solution/);
  assert.match(learn(root, 'x'.repeat(300), 'y'.repeat(300)).stderr, /at most 500/);
  assert.equal(readEvents(kit).length, 0);
  assert.equal(learn(root, 'x'.repeat(150), 'y'.repeat(300)).status, 0);
});

test('an agent running learn or learnings is never nudged to curate, however many learnings there are', (t) => {
  const { root } = project(t);
  for (let i = 0; i < 22; i++) assert.equal(learn(root, `Problem ${i}`, `Solution ${i}`).status, 0);
  for (const res of [learn(root, 'One more', 'Solution'), run(root, 'learnings'), run(root, 'learnings', '--ids')]) {
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout + res.stderr, /Summarize them/);
  }
});

test('without a build kit there is nowhere to record', (t) => {
  const res = learn(tempKit(t), 'p', 's', 't');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /No eventmodelers kit installed/);
});

test('learn --merge replaces the named learnings by one, with a reason', (t) => {
  const { root, kit } = project(t);
  learn(root, 'Tests', 'run npm test', 'Testing');
  learn(root, 'Tests again', 'tests run with npm test', 'Testing');
  const ids = run(root, 'learnings', '--ids').stdout.split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)[0]);
  const res = run(root, 'learn', '--merge', ids.join(','), 'Run the suite with npm test', '--reason', 'same fact');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fold(readEvents(kit)).learnings.length, 1);
  assert.match(agents(kit), /- Run the suite with npm test/);
  assert.doesNotMatch(agents(kit), /tests run with/);
  assert.equal(readEvents(kit).find((e) => e.type === 'learning-merged').reason, 'same fact');
});

test('learn --retract takes a reason', (t) => {
  const { root, kit } = project(t);
  learn(root, 'Obsolete thing', 'obsolete');
  const id = run(root, 'learnings', '--ids').stdout.trim().split(/\s+/)[0];
  assert.equal(run(root, 'learn', '--retract', id, '--reason', 'module deleted').status, 0);
  assert.equal(readEvents(kit).find((e) => e.type === 'learning-retracted').reason, 'module deleted');
});

test('while a curation turn runs, recording new learnings is refused but merging and retracting work', (t) => {
  const { root, kit } = project(t);
  learn(root, 'first', 'one');
  learn(root, 'second', 'two');
  const curating = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf-8', env: { ...process.env, RALPH_AGENT_ID: 'agent-7', EVENTMODELERS_TOKEN: '', EVENTMODELERS_CURATING: '1', FORCE_COLOR: '0' },
  });
  const refused = curating('learn', '--problem', 'new', '--solution', 'a brand new fact', '--topic', 'General');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /curat/i);
  assert.equal(fold(readEvents(kit)).learnings.length, 2);
  const ids = curating('learnings', '--ids').stdout.split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)[0]);
  assert.equal(curating('learn', '--merge', ids.join(','), 'one and two').status, 0);
  assert.equal(fold(readEvents(kit)).learnings.length, 1);
});

// Which kit the commands record into: a build kit if there is one, else the modeling kit. A person can use them by hand in a modeling-only
// project — the modeling agent itself states its learnings in its reply and the CLI records them.
test('in a project that only has the modeling kit, learn records there', (t) => {
  const root = tempKit(t);
  mkdirSync(join(root, '.agent-modeling-kit'), { recursive: true });
  const res = learn(root, 'Naming events', 'Events are past tense', 'Modeling', '--scope', 'system');
  assert.equal(res.status, 0, res.stderr);
  assert.match(readFileSync(join(root, '.agent-modeling-kit', 'AGENTS.md'), 'utf-8'), /## Modeling\n- Naming events → Events are past tense\n/);
  assert.equal(run(root, 'learnings').status, 0);
});

test('with a build kit and a modeling kit side by side, the build kit is the one that is used', (t) => {
  const { root, kit } = project(t);
  mkdirSync(join(root, '.agent-modeling-kit'), { recursive: true });
  assert.equal(learn(root, 'Tests need running', 'Use npm test').status, 0);
  assert.equal(readEvents(kit).length, 1);
  assert.equal(existsSync(join(root, '.agent-modeling-kit', 'events.log')), false);
});
