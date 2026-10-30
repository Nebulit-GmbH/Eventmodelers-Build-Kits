import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnUsage } from '../lib/turn-usage.js';

test('a turn reports its own cost as the difference of the running total, calls, and the largest results', () => {
  const t = createTurnUsage();
  t.toolUse('a', 'mcp__eventmodelers__get_nodes');
  t.toolResult('a', [{ type: 'text', text: 'x'.repeat(40000) }]);
  t.toolUse('b', 'mcp__eventmodelers__submit_node_events');
  t.toolResult('b', 'ok');
  t.assistantUsage({ input_tokens: 10, cache_read_input_tokens: 150000, cache_creation_input_tokens: 2000 });
  const first = t.finish({ total_cost_usd: 2, usage: { input_tokens: 30, cache_read_input_tokens: 300000, cache_creation_input_tokens: 2000, output_tokens: 900 } });
  assert.match(first, /2 tool calls, context 152k/);
  assert.match(first, /cache read 300k, cache write 2\.0k, out 900/);
  assert.match(first, /turn \$2\.0000 \(process total \$2\.0000\)/);
  assert.match(first, /get_nodes×1 10k tok/);

  t.toolUse('c', 'Read');
  const second = t.finish({ total_cost_usd: 2.5, usage: {} });
  assert.match(second, /1 tool calls/);
  assert.match(second, /turn \$0\.5000 \(process total \$2\.5000\)/);
});

test('without a cost or usage in the result it still produces a line', () => {
  const line = createTurnUsage().finish({});
  assert.match(line, /^usage: 0 tool calls/);
  assert.doesNotMatch(line, /\$/);
});

test('lastTurn hands the turn\'s figures over in the shape the agent-turns endpoint takes', () => {
  const t = createTurnUsage();
  assert.strictEqual(t.lastTurn(), null);
  t.toolUse('a', 'Read');
  t.assistantUsage({ input_tokens: 10, cache_read_input_tokens: 90 });
  t.finish({ total_cost_usd: 1, duration_ms: 1234.4, modelUsage: { 'claude-sonnet-5-5': {} }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 3 } });
  assert.deepStrictEqual(t.lastTurn(), { model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 3, costUsd: 1, contextTokens: 100, callCount: 1, durationMs: 1234 });
  t.finish({ total_cost_usd: 1.5, usage: {} });
  assert.strictEqual(t.lastTurn().costUsd, 0.5);
});
