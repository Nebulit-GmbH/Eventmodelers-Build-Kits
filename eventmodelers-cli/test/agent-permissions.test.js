import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelingPermissions } from '../lib/agent-permissions.js';

const p = modelingPermissions({ baseUrl: 'https://api.eventmodelers.ai', projectDir: '/work/kit', codeDir: '/work/code', tmpDir: '/tmp', hookCommand: '"node" "/x/bash-guard-hook.js"' });
const arg = (name) => p.args[p.args.indexOf(name) + 1];

test('refuses whatever is not allowed, and never bypasses permissions', () => {
  assert.equal(arg('--permission-mode'), 'dontAsk');
  assert.ok(!p.args.some((a) => /dangerously|bypassPermissions/.test(a)));
});

test('the eventmodelers server is the only MCP server, its token from the environment', () => {
  assert.ok(p.args.includes('--strict-mcp-config'));
  const config = JSON.parse(arg('--mcp-config'));
  assert.deepEqual(Object.keys(config.mcpServers), ['eventmodelers']);
  assert.equal(config.mcpServers.eventmodelers.url, 'https://api.eventmodelers.ai/mcp');
  assert.equal(config.mcpServers.eventmodelers.headers['x-token'], '${EVENTMODELERS_TOKEN}');
});

test('no Bash allow rule — every command goes through the guard hook', () => {
  const allowed = arg('--allowedTools').split(',');
  assert.ok(allowed.includes('mcp__eventmodelers'));
  assert.ok(!allowed.some((r) => r.startsWith('Bash')));
  assert.ok(!allowed.includes('Read'), 'reads outside the working directories need an explicit rule');
  const hooks = JSON.parse(arg('--settings')).hooks.PreToolUse;
  assert.deepEqual(hooks, [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"node" "/x/bash-guard-hook.js"' }] }]);
});

test('secrets and self-configuration are off limits; no web', () => {
  const denied = arg('--disallowedTools').split(',');
  for (const rule of ['WebFetch', 'WebSearch', 'Read(./.claude/settings.local.json)', 'Read(./**/.eventmodelers/**)', 'Edit(./.claude/**)', 'Edit(./.mcp.json)', 'Read(//work/code/**/.env)']) {
    assert.ok(denied.includes(rule), rule);
  }
});

test('hands the guard its policy', () => {
  assert.equal(p.env.EVENTMODELERS_GUARD_BASE_URL, 'https://api.eventmodelers.ai');
  const roots = JSON.parse(p.env.EVENTMODELERS_GUARD_ROOTS);
  for (const root of ['/work/kit', '/work/code', '/tmp']) assert.ok(roots.includes(root), root);
});
