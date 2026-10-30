// Per-turn usage of the warm Claude process, for `run --modeling --verbose`: what one turn cost and where the tokens went,
// so a surprising bill can be traced (many calls? a big context? one huge tool result?) instead of guessed at. Pure: the
// runner feeds it the stream-json messages and asks for one line when the turn's `result` arrives.

const textLength = (content) => {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) return content.reduce((n, part) => n + (typeof part?.text === 'string' ? part.text.length : 0), 0);
  return 0;
};

const k = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function createTurnUsage() {
  let tools = new Map(); // tool_use id -> name
  let results = new Map(); // tool name -> { calls, chars }
  let calls = 0;
  let lastContext = 0; // the context the most recent model call carried (input + cache), i.e. how big the session is now
  let lastTotalCost = 0; // total_cost_usd is the process's running total; a turn's cost is the difference
  let last = null; // the figures of the turn that just ended, as the platform's agent-turns endpoint takes them

  return {
    toolUse(id, name) { tools.set(id, name); calls++; },
    toolResult(id, content) {
      const name = tools.get(id) ?? 'unknown';
      const entry = results.get(name) ?? { calls: 0, chars: 0 };
      entry.calls++; entry.chars += textLength(content);
      results.set(name, entry);
    },
    assistantUsage(usage) {
      if (!usage) return;
      lastContext = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    },
    /** The summary of the turn that just ended (the stream-json `result` message), then the counters start over. */
    finish(result) {
      const u = result?.usage ?? {};
      const total = result?.total_cost_usd ?? 0;
      const delta = total - lastTotalCost;
      if (total) lastTotalCost = total;
      const big = [...results.entries()].sort((a, b) => b[1].chars - a[1].chars).slice(0, 3)
        .map(([name, r]) => `${name.replace(/^mcp__eventmodelers__/, '')}×${r.calls} ${k(Math.round(r.chars / 4))} tok`).join(', ');
      const line = `usage: ${calls} tool calls, context ${k(lastContext)} · tokens in ${k(u.input_tokens ?? 0)}, cache read ${k(u.cache_read_input_tokens ?? 0)}, cache write ${k(u.cache_creation_input_tokens ?? 0)}, out ${k(u.output_tokens ?? 0)}`
        + (total ? ` · turn $${delta.toFixed(4)} (process total $${total.toFixed(4)})` : '')
        + (big ? ` · largest results (≈tokens): ${big}` : '');
      last = {
        model: Object.keys(result?.modelUsage ?? {})[0] ?? null,
        inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        costUsd: total ? delta : null, contextTokens: lastContext, callCount: calls,
        ...(Number.isFinite(result?.duration_ms) ? { durationMs: Math.round(result.duration_ms) } : {}),
      };
      tools = new Map(); results = new Map(); calls = 0;
      return line;
    },
    /** What `finish` just summed up, ready to POST to the platform's agent-turns endpoint (null before the first turn ends). */
    lastTurn() { return last; },
  };
}
