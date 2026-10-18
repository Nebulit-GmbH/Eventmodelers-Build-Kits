import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent } from '../shared/build-kit/lib/slice-events.js';
import { tempKit } from './helpers.js';

// `eventmodelers events` — the event log of a kit, decoded in the terminal.

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const S = 'ccc5e66b-6b29-40b9-a163-269b1b0b173b';
const META = { agent_id: 'cc9a10b3-8492-4bf7-b992-2ad19e8a4772' };
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', EVENTMODELERS_TOKEN: '' };
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8', env });
const runWithHome = (cwd, home, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8', env: { ...env, HOME: home, USERPROFILE: home } });

function project(t, { events = true } = {}) {
  const root = tempKit(t);
  const kit = join(root, '.build-kit');
  mkdirSync(kit, { recursive: true });
  if (events) {
    appendEvent(kit, { type: 'board-observed', slice: S, status: 'Planned' }, META);
    appendEvent(kit, { type: 'claimed', slice: S, ctx: 'cart', title: 'State Change', pid: 4711, base: { branch: 'main', head: '1252bd0c9999' }, cleanTree: true }, META);
    appendEvent(kit, { type: 'claim-confirmed', slice: S }, META);
    appendEvent(kit, { type: 'learning-recorded', text: 'Use npm test', topic: 'Testing', scope: 'repo', tags: ['ci'] }, META);
    appendEvent(kit, { type: 'settled', slice: S, status: 'Done' }, META);
  }
  return { root, kit };
}

test('prints one decoded line per event, with the slice\'s title and the agent', (t) => {
  const { root } = project(t);
  const res = run(root, 'events');
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /board-observed +ccc5e66b "State Change"? +Planned +cc9a$/);
  assert.match(lines[1], /claimed +ccc5e66b "State Change" +pid 4711, clean tree, main@1252bd0c/);
  assert.match(lines[3], /\[Testing\] Use npm test \(repo #ci\)/);
  assert.match(lines[4], /settled +ccc5e66b "State Change" +Done/);
});

test('--type, --slice, --tag and --last narrow it down', (t) => {
  const { root } = project(t);
  const count = (...args) => run(root, 'events', ...args).stdout.trim().split('\n').filter(Boolean).length;
  assert.equal(count('--type', 'claimed,settled'), 2);
  assert.equal(count('--slice', 'state change'), 4);
  assert.equal(count('--slice', 'ccc5'), 4);
  assert.equal(count('--tag', 'ci'), 1);
  assert.equal(count('--last', '2'), 2);
  assert.match(run(root, 'events', '--last', '1').stdout, /settled/);
});

test('--json prints the raw events, one per line', (t) => {
  const { root } = project(t);
  const events = run(root, 'events', '--json').stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ['board-observed', 'claimed', 'claim-confirmed', 'learning-recorded', 'settled']);
  assert.equal(events[0].meta.agent_id, META.agent_id);
});

test('--state prints what the log folds to instead of the events', (t) => {
  const { root } = project(t);
  const res = run(root, 'events', '--state');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /ccc5e66b "State Change" +Done/);
  assert.match(res.stdout, /0 tasks waiting · 0 prompts open · 1 learning/);
  assert.doesNotMatch(res.stdout, /board-observed/);
});

test('--kit reads another kit\'s log from anywhere, with no kit installed here', (t) => {
  const { kit } = project(t);
  const elsewhere = tempKit(t);
  const res = run(elsewhere, 'events', '--kit', kit, '--last', '1');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /settled/);
});

test('a kit without events says so', (t) => {
  const { root } = project(t, { events: false });
  const res = run(root, 'events');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /No events yet/);
});

test('without a kit and without --kit it refuses', (t) => {
  const res = run(tempKit(t), 'events');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /needs a build or modeling kit|No eventmodelers kit installed/);
});

test('a bad --last is refused', (t) => {
  const { root } = project(t);
  const res = run(root, 'events', '--last', 'many');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--last/);
});

for (const flag of ['--follow', '--watch']) test(`${flag} prints what is appended afterwards`, async (t) => {
  const { root, kit } = project(t);
  const child = spawn(process.execPath, [cli, 'events', flag], { cwd: root, env });
  t.after(() => child.kill());
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (out.includes('settled') && !out.includes('released')) {
        appendEvent(kit, { type: 'released', slice: S, reason: 'moved' }, META);
      }
      if (out.includes('released')) { clearInterval(tick); resolve(); }
      else if (Date.now() - t0 > 8000) { clearInterval(tick); reject(new Error(`timed out; output so far:\n${out}`)); }
    }, 150);
  });
  assert.equal(out.match(/settled/g).length, 1, 'the earlier events are printed once, not again');
});

// ── the global install ──────────────────────────────────────────────────────────

function globalKit(t) {
  const home = tempKit(t);
  const kit = join(home, '.eventmodelers', 'kit', '.agent-modeling-kit');
  mkdirSync(kit, { recursive: true });
  appendEvent(kit, { type: 'prompt-received', pid: 7, prompt: { id: '0e5835db-43f2', text: 'Add one slice' } }, { agent_id: 'f200831e-0000', board_id: 'c2b3b7da-f3bb-4ad6-ae89-f59873c6556c' });
  appendEvent(kit, { type: 'prompt-finished', prompt: '0e5835db-43f2', outcome: 'worked' }, { agent_id: 'f200831e-0000', board_id: 'c2b3b7da-f3bb-4ad6-ae89-f59873c6556c' });
  appendEvent(kit, { type: 'prompt-received', pid: 8, prompt: { id: '99999999-aaaa', text: 'Another board' } }, { agent_id: '2b5b0000', board_id: '11111111-aaaa-4aaa-8aaa-111111111111' });
  return { home, kit };
}

test('--global decodes the log of the global install, from any directory', (t) => {
  const { home } = globalKit(t);
  const res = runWithHome(tempKit(t), home, 'events', '--global');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim().split('\n').length, 3);
  assert.match(res.stdout, /prompt-received +0e5835db +"Add one slice", pid 7/);
});

test('--board narrows a mixed log to one board, by id prefix', (t) => {
  const { home } = globalKit(t);
  const res = runWithHome(tempKit(t), home, 'events', '--global', '--board', 'c2b3b7da');
  assert.equal(res.stdout.trim().split('\n').length, 2);
  assert.doesNotMatch(res.stdout, /Another board/);
});

test('--global and --kit are alternatives', (t) => {
  const { home, kit } = globalKit(t);
  const res = runWithHome(tempKit(t), home, 'events', '--global', '--kit', kit);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--global.*--kit|--kit.*--global/);
});

test('an empty project log points at the global log when that one has events', (t) => {
  const { home } = globalKit(t);
  const { root } = project(t, { events: false });
  const res = runWithHome(root, home, 'events');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /No events yet/);
  assert.match(res.stdout, /events --global/);
});

test('--global with no global install says so', (t) => {
  const res = runWithHome(tempKit(t), tempKit(t), 'events', '--global');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /No events yet/);
});
