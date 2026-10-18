import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireAgentId, forgetAgentLocks } from '../shared/build-kit/lib/agent-lock.js';
import { tempKit } from './helpers.js';

// One agent id, one live process. An agent keeps its stable id; a second process that would share it gets a
// fresh one instead, so the two never fight over a heartbeat row, a chat, or each other's prompts.

const modulePath = fileURLToPath(new URL('../shared/build-kit/lib/agent-lock.js', import.meta.url));
const DEAD = 2 ** 22 + 12345;
const STABLE = '11111111-2222-3333-4444-555555555555';
const lockDir = (t) => join(tempKit(t), 'locks');
const lockFile = (dir, id = STABLE) => join(dir, `${id}.lock`);
const foreignLock = (dir, pid, id = STABLE) => { mkdirSync(dir, { recursive: true }); writeFileSync(lockFile(dir, id), JSON.stringify({ pid, startedAt: 'earlier' })); };

test('the first process takes the stable id and leaves its lock', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  assert.deepEqual(acquireAgentId({ lockDir: dir, stableId: STABLE }), { agentId: STABLE, fellBack: false });
  assert.equal(JSON.parse(readFileSync(lockFile(dir), 'utf-8')).pid, process.pid);
});

test('asking again in the same process gives the same answer — also after falling back', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  const first = acquireAgentId({ lockDir: dir, stableId: STABLE });
  assert.deepEqual(acquireAgentId({ lockDir: dir, stableId: STABLE }), first);

  const other = lockDir(t);
  foreignLock(other, process.ppid);
  const fellBack = acquireAgentId({ lockDir: other, stableId: STABLE });
  assert.equal(fellBack.fellBack, true);
  assert.deepEqual(acquireAgentId({ lockDir: other, stableId: STABLE }), fellBack);
});

test('while another live process holds the id, this one gets a fresh id of its own', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  foreignLock(dir, process.ppid);
  const result = acquireAgentId({ lockDir: dir, stableId: STABLE, mint: () => 'fresh-id' });
  assert.deepEqual(result, { agentId: 'fresh-id', fellBack: true });
  assert.equal(JSON.parse(readFileSync(lockFile(dir), 'utf-8')).pid, process.ppid, 'the holder keeps its lock');
});

test('a lock left by a dead process is taken over', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  foreignLock(dir, DEAD);
  assert.deepEqual(acquireAgentId({ lockDir: dir, stableId: STABLE }), { agentId: STABLE, fellBack: false });
  assert.equal(JSON.parse(readFileSync(lockFile(dir), 'utf-8')).pid, process.pid);
});

test('an unreadable lock counts as left over', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockFile(dir), 'not json');
  assert.deepEqual(acquireAgentId({ lockDir: dir, stableId: STABLE }), { agentId: STABLE, fellBack: false });
});

test('if locking is impossible the stable id is kept — a lock problem never stops an agent', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  mkdirSync(join(dir, '..'), { recursive: true });
  writeFileSync(dir, 'a file where the lock directory should be');
  assert.deepEqual(acquireAgentId({ lockDir: dir, stableId: STABLE }), { agentId: STABLE, fellBack: false });
});

test('different ids do not touch each other\'s locks', (t) => {
  const dir = lockDir(t);
  t.after(forgetAgentLocks);
  foreignLock(dir, process.ppid, 'other-id');
  assert.deepEqual(acquireAgentId({ lockDir: dir, stableId: STABLE }), { agentId: STABLE, fellBack: false });
});

test('forgetting releases this process\'s locks, so the id is free again', (t) => {
  const dir = lockDir(t);
  acquireAgentId({ lockDir: dir, stableId: STABLE });
  forgetAgentLocks();
  assert.equal(existsSync(lockFile(dir)), false);
  t.after(forgetAgentLocks);
  assert.equal(acquireAgentId({ lockDir: dir, stableId: STABLE }).fellBack, false);
});

function child(dir, holdMs) {
  const script = `import { acquireAgentId } from ${JSON.stringify(modulePath)};
    const r = acquireAgentId({ lockDir: ${JSON.stringify(dir)}, stableId: ${JSON.stringify(STABLE)} });
    console.log(JSON.stringify(r));
    setTimeout(() => process.exit(0), ${holdMs});`;
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', (c) => { out += c; });
    proc.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`child exited ${code}`))));
  });
}

test('a process that exits releases its lock', async (t) => {
  const dir = lockDir(t);
  const result = await child(dir, 50);
  assert.equal(result.agentId, STABLE);
  assert.equal(existsSync(lockFile(dir)), false);
});

test('two processes started at the same time: exactly one gets the stable id', async (t) => {
  const dir = lockDir(t);
  const [a, b] = await Promise.all([child(dir, 700), child(dir, 700)]);
  assert.deepEqual([a.fellBack, b.fellBack].sort(), [false, true]);
  assert.equal([a, b].filter((r) => r.agentId === STABLE).length, 1);
});
