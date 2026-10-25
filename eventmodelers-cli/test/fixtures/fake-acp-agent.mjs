// A scripted ACP agent (ndjson JSON-RPC over stdio) for test/modeling-acp.test.js. What a prompt does is
// picked by its text: hello | perm | mcp | die | refuse | session.
import { createInterface } from 'readline';

const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
const update = (sessionId, u) => out({ method: 'session/update', params: { sessionId, update: u } });
const chunk = (sessionId, text) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

let mcpServers = null;
let permissionWaiter = null;
let sessions = 0;
let prompts = 0;
const closed = [];
let sessionId = null;

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === 'perm-1' && !msg.method) return permissionWaiter?.(msg.result);
  if (msg.method === 'initialize') {
    return out({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: process.env.FAKE_ACP_HTTP !== '0' }, sessionCapabilities: process.env.FAKE_ACP_CLOSE === '1' ? { close: {} } : {} } } });
  }
  if (msg.method === 'session/close') { closed.push(msg.params.sessionId); return out({ id: msg.id, result: {} }); }
  if (msg.method === 'session/new') {
    mcpServers = msg.params.mcpServers;
    sessionId = `ses_${process.pid}_${++sessions}`;
    return out({ id: msg.id, result: { sessionId } });
  }
  if (msg.method !== 'session/prompt') return;
  const text = msg.params.prompt[0].text;
  prompts += 1;
  const k = process.env.FAKE_ACP_CUMULATIVE === '1' ? prompts : 1; // a running total grows with every prompt
  const done = (stopReason = 'end_turn') => out({ id: msg.id, result: { stopReason, usage: { inputTokens: 10 * k, outputTokens: 5 * k, cachedReadTokens: 3 * k, cachedWriteTokens: 2 * k, totalTokens: 20 * k } } });
  if (text === 'hello') {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'get_nodes', kind: 'read', rawInput: { boardId: 'b' } });
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    chunk(sessionId, 'hi ');
    chunk(sessionId, 'there');
    return done();
  }
  if (text === 'perm') {
    permissionWaiter = (result) => { chunk(sessionId, JSON.stringify(result.outcome)); done(); };
    return out({ id: 'perm-1', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 't2' }, options: [
      { optionId: 'no', name: 'Reject', kind: 'reject_once' }, { optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'always', name: 'Always', kind: 'allow_always' },
    ] } });
  }
  if (text === 'mcp') { chunk(sessionId, JSON.stringify(mcpServers)); return done(); }
  if (text === 'closed') { chunk(sessionId, JSON.stringify(closed)); return done(); }
  if (text === 'session') { chunk(sessionId, sessionId); return done(); }
  if (text === 'refuse') return done('refusal');
  if (text === 'hang') return; // never answers; session/cancel is ignored too
  if (text === 'die') process.exit(1);
});
