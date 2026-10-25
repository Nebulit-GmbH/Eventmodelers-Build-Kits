import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAcpSession, usageFromAcp, usageDelta, resolveAcpAgent, ACP_AGENTS } from '../shared/build-kit/lib/acp-session.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const agent = { label: 'Fake', command: process.execPath, args: [fixture] };

test('ACP usage becomes the shape the slice tracer records, with no invented cost', () => {
  assert.deepEqual(
    usageFromAcp({ inputTokens: 10, outputTokens: 5, cachedReadTokens: 3, cachedWriteTokens: 2, totalTokens: 20 }, { durationMs: 900 }),
    { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2, costUsd: null, durationMs: 900, model: null },
  );
  assert.equal(usageFromAcp(undefined), null);
  assert.equal(usageFromAcp({ inputTokens: 1 }, { model: { not: 'a string' } }).model, null);
});

test('a turn reports usage, and reset() opens a new conversation in the same warm process', async () => {
  const session = createAcpSession({ agent, cwd: process.cwd() });
  try {
    const first = await session.runTurn('session');
    assert.equal(first.usage.inputTokens, 10);
    assert.equal(first.usage.cacheReadTokens, 3);
    session.reset();
    const second = await session.runTurn('session');
    const [pidA, nA] = first.text.slice(4).split('_');
    const [pidB, nB] = second.text.slice(4).split('_');
    assert.equal(pidA, pidB, 'same process');
    assert.equal(nA, '1');
    assert.equal(nB, '2', 'a fresh session');
  } finally { session.close(); }
});

test('a turn past its timeout is cancelled, rejects with timedOut, and the next turn starts over', async () => {
  const session = createAcpSession({ agent, cwd: process.cwd() });
  try {
    await assert.rejects(session.runTurn('hang', { timeoutMs: 100 }), (err) => err.timedOut === true);
    assert.equal(await (await session.runTurn('hello')).text, 'hi there');
  } finally { session.close(); }
});

test('run --acp is refused next to --exec or --local-ai, and needs an agent', () => {
  const run = (args) => { try { execFileSync('node', [cli, 'run', ...args], { encoding: 'utf8', stdio: 'pipe' }); return ''; } catch (err) { return err.stderr; } };
  assert.match(run(['--agent', 'opencode', '--acp', '--exec', 'x']), /mutually exclusive/);
  assert.match(run(['--agent', 'opencode', '--acp', '--local-ai']), /mutually exclusive/);
  assert.match(run(['--acp']), /--acp needs --agent/);
  assert.match(run(['--agent', 'opencode', '--acp', '--model', 'x']), /--model does not apply/);
  assert.doesNotMatch(run(['--agent', 'opencode', '--acp']), /modeling loop/); // no longer modeling-only
});

test('resolveAcpAgent is shared by the modeling loop and the build kit', () => {
  assert.equal(resolveAcpAgent({ name: 'cursor' }).command, 'cursor-agent');
});

test('input tokens are exclusive of the cache whichever way the agent reports them', () => {
  // Copilot: inputTokens includes the cache, totalTokens = input + output (the figures of a real 5-call turn).
  const copilot = usageFromAcp({ inputTokens: 228847, outputTokens: 705, totalTokens: 229552, cachedReadTokens: 174815, cachedWriteTokens: 54017 });
  assert.equal(copilot.inputTokens, 15);
  assert.equal(copilot.cacheReadTokens, 174815);
  assert.equal(copilot.cacheWriteTokens, 54017);
  // OpenCode: inputTokens excludes the cache, totalTokens = input + output + cache read.
  assert.equal(usageFromAcp({ inputTokens: 77, outputTokens: 115, totalTokens: 20928, cachedReadTokens: 20736 }).inputTokens, 77);
  // No cache, nothing to tell apart.
  assert.equal(usageFromAcp({ inputTokens: 9, outputTokens: 1, totalTokens: 10 }).inputTokens, 9);
});

test('a running total is turned into the turn\'s own usage', () => {
  assert.deepEqual(usageDelta({ inputTokens: 338137, outputTokens: 812, totalTokens: 338949 }, { inputTokens: 228847, outputTokens: 705, totalTokens: 229552 }), { inputTokens: 109290, outputTokens: 107, totalTokens: 109397 });
  assert.deepEqual(usageDelta({ inputTokens: 5 }, null), { inputTokens: 5 });
  assert.equal(ACP_AGENTS.github.cumulativeUsage, true);
  assert.equal(ACP_AGENTS.opencode.cumulativeUsage, undefined);
});

test('a session of a cumulative agent reports each turn\'s share, and a reset starts the count over', async () => {
  const session = createAcpSession({ agent: { ...agent, cumulativeUsage: true }, cwd: process.cwd(), env: { ...process.env, FAKE_ACP_CUMULATIVE: '1' } });
  try {
    const one = await session.runTurn('hello');   // reported total: 10 in / 20 total
    const two = await session.runTurn('hello');   // reported total: 20 in -> this turn: 10
    assert.equal(one.rawUsage.inputTokens, 10);
    assert.equal(two.rawUsage.inputTokens, 10);
    assert.equal(two.usage.cacheReadTokens, 3);
    session.reset();
    const three = await session.runTurn('hello'); // reported total: 30 in, but a new conversation starts from zero
    assert.equal(three.rawUsage.inputTokens, 30, 'the fake agent keeps counting; a real one restarts per session');
  } finally { session.close(); }
});

test('reset() closes the conversation it leaves, when the agent can', async () => {
  const session = createAcpSession({ agent, cwd: process.cwd(), env: { ...process.env, FAKE_ACP_CLOSE: '1' } });
  try {
    const first = (await session.runTurn('session')).text;
    session.reset();
    await session.runTurn('hello'); // opens the new conversation
    session.reset();
    const closed = JSON.parse((await session.runTurn('closed')).text);
    assert.equal(closed[0], first, 'the first conversation was closed');
    assert.equal(closed.length, 2);
  } finally { session.close(); }
});

test('reset() leaves a conversation alone when the agent has no close', async () => {
  const session = createAcpSession({ agent, cwd: process.cwd() });
  try {
    await session.runTurn('hello');
    session.reset();
    assert.deepEqual(JSON.parse((await session.runTurn('closed')).text), []);
  } finally { session.close(); }
});

test('--reset-session is a modeling-loop flag', () => {
  const run = (args) => { try { execFileSync('node', [cli, 'run', ...args], { encoding: 'utf8', stdio: 'pipe' }); return ''; } catch (err) { return err.stderr; } };
  assert.match(run(['--reset-session']), /--reset-session is for the modeling loop/);
  assert.match(run(['--agent', 'opencode', '--acp', '--reset-session']), /--reset-session is for the modeling loop/);
  assert.match(execFileSync('node', [cli, 'run', '--help'], { encoding: 'utf8' }), /--reset-session/);
});
