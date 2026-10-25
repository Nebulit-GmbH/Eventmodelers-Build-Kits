import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createModelingAcpRunner, resolveAcpAgent, ACP_AGENTS, tokenSummary } from '../lib/modeling-acp.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const cfg = { baseUrl: 'https://api.test', token: 'tok', agentId: 'agent-1' };

function runner(extra = {}, onToolUse) {
  const logs = [];
  const r = createModelingAcpRunner({
    cfg, projectDir: process.cwd(), log: (l) => logs.push(l), onToolUse,
    agent: { label: 'Fake', command: process.execPath, args: [fixture], host: null, ...extra },
  });
  return { r, logs };
}

test('a turn resolves with the streamed text and reports tool calls', async () => {
  const calls = [];
  const { r } = runner({}, (name, input) => { calls.push({ name, input }); return (o) => calls.push({ end: o }); });
  try {
    assert.equal(await r.runTurn('hello'), 'hi there');
    assert.deepEqual(calls, [{ name: 'get_nodes', input: { boardId: 'b' } }, { end: { isError: false } }]);
    assert.equal(r.keepsSession, true);
  } finally { r.close(); }
});

test('session/new carries the eventmodelers MCP server with token and agent-id headers', async () => {
  const { r } = runner();
  try {
    assert.deepEqual(JSON.parse(await r.runTurn('mcp')), [{
      type: 'http', name: 'eventmodelers', url: 'https://api.test/mcp',
      headers: [{ name: 'x-token', value: 'tok' }, { name: 'x-agent-id', value: 'agent-1' }],
    }]);
  } finally { r.close(); }
});

test('permission requests are answered with the allow_always option', async () => {
  const { r } = runner();
  try {
    assert.deepEqual(JSON.parse(await r.runTurn('perm')), { outcome: 'selected', optionId: 'always' });
  } finally { r.close(); }
});

test('an agent without HTTP MCP support is refused', async () => {
  process.env.FAKE_ACP_HTTP = '0';
  const { r } = runner();
  try {
    await assert.rejects(r.runTurn('hello'), /does not support HTTP MCP/);
  } finally { delete process.env.FAKE_ACP_HTTP; r.close(); }
});

test('a refusal rejects the turn', async () => {
  const { r } = runner();
  try {
    await assert.rejects(r.runTurn('refuse'), /refusal/);
  } finally { r.close(); }
});

test('the agent exiting mid-turn rejects it, and the next turn gets a new process and session', async () => {
  const { r } = runner();
  try {
    const first = await r.runTurn('session');
    await assert.rejects(r.runTurn('die'), /exited/);
    assert.equal(r.keepsSession, false);
    const second = await r.runTurn('session');
    assert.notEqual(second, first);
    assert.equal(await r.runTurn('hello'), 'hi there');
  } finally { r.close(); }
});

test('resolveAcpAgent: table rows, custom commands and unknown names', () => {
  assert.equal(resolveAcpAgent({ name: 'opencode' }), ACP_AGENTS.opencode);
  assert.deepEqual(resolveAcpAgent({ cmd: 'my-agent --acp' }), { label: 'my-agent', command: 'my-agent', args: ['--acp'], host: null });
  for (const name of ['claude', 'opencode', 'gemini', 'codex', 'cursor', 'github']) assert.ok(resolveAcpAgent({ name }).command, name);
  assert.throws(() => resolveAcpAgent({ name: 'nope' }), /no ACP agent/);
});

test('resetSession() starts a fresh conversation and makes the next turn carry the preamble again', async () => {
  const { r, logs } = runner();
  try {
    const first = await r.runTurn('session');
    assert.equal(r.keepsSession, true);
    await r.resetSession();
    assert.equal(r.keepsSession, false);
    const second = await r.runTurn('session');
    assert.notEqual(second, first);
    assert.ok(second.startsWith(first.split('_').slice(0, 2).join('_')), 'same process, new session');
    assert.ok(logs.some((l) => /session reset/.test(l)));
  } finally { r.close(); }
});

test('a reset queued behind a turn waits for it', async () => {
  const { r } = runner();
  try {
    const turn = r.runTurn('hello');
    const reset = r.resetSession();
    assert.equal(await turn, 'hi there');
    await reset;
    assert.equal(r.keepsSession, false);
  } finally { r.close(); }
});

test('the turn summary tells new tokens from the cached conversation replayed on every call', () => {
  // The figures of the "move slices to created" prompt turn.
  assert.equal(tokenSummary({ inputTokens: 10, outputTokens: 1849, cacheReadTokens: 305341, cacheWriteTokens: 13818 }), 'new 13.8k · replayed from cache 305k · out 1.8k');
  assert.equal(tokenSummary({ inputTokens: 8, outputTokens: 673, cacheReadTokens: 208769, cacheWriteTokens: 4701 }), 'new 4.7k · replayed from cache 209k · out 673');
});
