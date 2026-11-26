import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readAfter, resetRunnerSession } from '../lib/chat-memory.js';
import { createModelingAcpRunner } from '../lib/modeling-acp.js';
import { createModelingExecRunner } from '../lib/modeling-exec.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const cfg = { baseUrl: 'https://api.test', token: 'tok', agentId: 'agent-1' };
const acp = (options = {}) => createModelingAcpRunner({ cfg, projectDir: process.cwd(), log: () => {}, agent: { label: 'Fake', command: process.execPath, args: [fixture], host: null }, ...options });
const cursors = () => new Map([['s1', 'm1'], ['s2', 'm2']]);

test('the warm claude process reads on from its cursor, and a compact request reads whole', () => {
  assert.equal(readAfter(cursors(), 's1'), 'm1');
  assert.equal(readAfter(cursors(), 'unseen'), null);
  assert.equal(readAfter(cursors(), 's1', { compact: true }), null);
});

test('a local model holds nothing from one turn to the next', () => {
  assert.equal(readAfter(cursors(), 's1', { localRunner: {} }), null);
});

test('an --exec harness with a process per turn reads every conversation whole', async () => {
  const execRunner = createModelingExecRunner({ cfg, command: 'true', projectDir: process.cwd(), log: () => {} });
  await execRunner.runTurn('turn');
  assert.equal(readAfter(cursors(), 's1', { execRunner }), null);
});

test('a warm session reads on once it has completed a turn, and starts over after a reset', async () => {
  const execRunner = acp();
  const seen = cursors();
  try {
    const first = await execRunner.runTurn('session');
    assert.equal(readAfter(seen, 's1', { execRunner }), 'm1');

    await resetRunnerSession(execRunner, seen);

    assert.equal(execRunner.keepsSession, false);
    assert.equal(seen.size, 0);
    assert.notEqual(await execRunner.runTurn('session'), first);
  } finally { execRunner.close(); }
});

// The process died: the turn that primes the new one reads whole, and no later turn trusts what the old one had read.
test('a warm session that lost its process forgets every cursor', async () => {
  const execRunner = acp();
  const seen = cursors();
  try {
    await execRunner.runTurn('session');
    await assert.rejects(execRunner.runTurn('die'), /exited/);

    assert.equal(readAfter(seen, 's1', { execRunner }), null);
    await execRunner.runTurn('session');
    assert.equal(readAfter(seen, 's2', { execRunner }), null);
  } finally { execRunner.close(); }
});

// A prompt turn primes the new process before any chat turn is built, so `keepsSession` is true again by then.
test('a lost process forgets every cursor even when another turn primes the new one first', async () => {
  const seen = cursors();
  const execRunner = acp({ onSessionLost: () => seen.clear() });
  try {
    await execRunner.runTurn('session');
    await assert.rejects(execRunner.runTurn('die'), /exited/);
    await execRunner.runTurn('session');

    assert.equal(execRunner.keepsSession, true);
    assert.equal(readAfter(seen, 's1', { execRunner }), null);
  } finally { execRunner.close(); }
});

test('resetting a runner without a session of its own only forgets the cursors', async () => {
  const seen = cursors();
  await resetRunnerSession({}, seen);
  assert.equal(seen.size, 0);
});
