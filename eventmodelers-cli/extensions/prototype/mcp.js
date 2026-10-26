// A board tool call, replayed: the eventmodelers MCP server over HTTP — the same stateless JSON-RPC `tools/call` the local-model agent uses
// (shared/build-kit/lib/local-ai-agent.js). Used to execute the tool calls a feedback was translated into.
const parse = (text) => {
  for (const line of text.split('\n')) if (line.startsWith('data: ')) { try { return JSON.parse(line.slice(6)); } catch { /* next line */ } }
  try { return JSON.parse(text); } catch { return null; }
};

const headersOf = (cfg) => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${cfg.token}`, 'x-token': cfg.token, ...(cfg.agentId ? { 'x-agent-id': cfg.agentId } : {}) });

/** The board's tools: [{ name, description, inputSchema }] — what a tool call has to look like, for whoever writes one. */
export async function listTools(cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/mcp`, { method: 'POST', headers: headersOf(cfg), body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} }) });
  const body = parse(await res.text());
  if (!body) throw new Error(`Empty MCP response (HTTP ${res.status})`);
  if (body.error) throw new Error(body.error.message || 'MCP error');
  return (body.result?.tools || []).map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || {} }));
}

/** Calls one tool. `boardId` is filled in when the input has none (every board tool takes it). Throws on a protocol or tool error. */
export async function callTool(cfg, tool, input, fetchImpl = fetch) {
  const res = await fetchImpl(`${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/mcp`, {
    method: 'POST',
    headers: headersOf(cfg),
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: { boardId: cfg.boardId, ...input } } }),
  });
  const body = parse(await res.text());
  if (!res.ok && !body) throw new Error(`HTTP ${res.status}`);
  if (!body) throw new Error('Empty MCP response');
  if (body.error) throw new Error(body.error.message || 'MCP error');
  const out = body.result;
  const message = (out?.content || []).map((p) => p.text).filter(Boolean).join(' ').slice(0, 300);
  if (out?.isError) throw new Error(message || `${tool} failed`);
  return message;
}
