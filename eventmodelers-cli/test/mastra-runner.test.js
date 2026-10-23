import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { usageFromMastra, createMastraSession } from '../shared/build-kit/lib/mastra-session.js';
import { createModelingMastraRunner } from '../lib/modeling-mastra.js';
import { AGENT_NAMES, presetCommand } from '../shared/build-kit/lib/harnesses/index.js';

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));

test("Mastra's usage becomes the shape the slice tracer records, with no invented cost", () => {
  const u = usageFromMastra({ inputTokens: 120, outputTokens: 30, cachedInputTokens: 40 }, { durationMs: 900, model: 'anthropic/claude-sonnet-5-5' });
  assert.deepEqual(u, { inputTokens: 120, outputTokens: 30, cacheReadTokens: 40, costUsd: null, durationMs: 900, model: 'anthropic/claude-sonnet-5-5' });
  assert.equal(usageFromMastra(undefined), null);
  assert.equal(usageFromMastra({ inputTokens: 1 }, { model: { not: 'a string' } }).model, null);
});

test('mastra is a named agent with no exec command of its own', () => {
  assert.ok(AGENT_NAMES.includes('mastra'));
  assert.equal(presetCommand('mastra', 'build'), null);
  assert.equal(presetCommand('mastra', 'modeling'), null);
});

test('a session without a model is refused up front', async () => {
  await assert.rejects(createMastraSession({ mcpUrl: 'http://x/mcp' }), /no model/);
});

test('the modeling runner wants a provider/model, not a bare Claude alias', async () => {
  const args = { cfg: { baseUrl: 'http://x', token: 't' }, projectDir: '.', log: () => {} };
  await assert.rejects(createModelingMastraRunner({ ...args, model: 'sonnet' }), /no model/);
  await assert.rejects(createModelingMastraRunner({ ...args, model: undefined }), /no model/);
});

test('run --agent mastra lists itself and rejects --exec alongside it', () => {
  assert.match(execFileSync('node', [cli, 'run', '--agent'], { encoding: 'utf8' }), /mastra\s+a warm Mastra agent/);
  assert.throws(() => execFileSync('node', [cli, 'run', '--agent', 'mastra', '--exec', 'x'], { encoding: 'utf8', stdio: 'pipe' }), /mutually exclusive/);
});
