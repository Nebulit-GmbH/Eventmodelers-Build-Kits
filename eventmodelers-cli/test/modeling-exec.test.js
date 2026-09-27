import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelingExecRunner, harnessOf, registerMcp } from '../lib/modeling-exec.js';

const cfg = { token: 'tok-123', agentId: 'agent-1', baseUrl: 'https://api.example.test' };
const projectDir = mkdtempSync(join(tmpdir(), 'modeling-exec-test-'));
const runner = (command) => createModelingExecRunner({ cfg, command, projectDir, log: () => {} });

test('a turn resolves with what the command printed, the prompt passed as one quoted argument', async () => {
  const text = "it's `multi-line`\nwith $HOME in it";
  assert.equal(await runner('printf "%s"').runTurn(text), text);
});

test('the prompt is also in the file RALPH_PROMPT_FILE names', async () => {
  assert.equal(await runner('cat "$RALPH_PROMPT_FILE"; true').runTurn('from the file'), 'from the file');
});

test('the command inherits the board credentials and runs in the project dir', async () => {
  const out = await runner('printf "%s %s %s" "$EVENTMODELERS_TOKEN" "$EVENTMODELERS_AGENT_ID" "$PWD"; true').runTurn('x');
  const [token, agentId, cwd] = out.split(' ');
  assert.equal(token, 'tok-123');
  assert.equal(agentId, 'agent-1');
  assert.ok(cwd.endsWith(projectDir.split('/').pop()));
});

test('a non-zero exit rejects the turn', async () => {
  await assert.rejects(runner('exit 3; true').runTurn('x'), /exited 3/);
});

test('no command is refused up front', () => {
  assert.throws(() => runner(undefined), /no agent command/);
});

const freshDir = () => mkdtempSync(join(tmpdir(), 'modeling-exec-mcp-'));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const BASE = 'https://api.example.test';

test('the harness is recognised by name, path or npx package', () => {
  assert.equal(harnessOf('opencode run --standalone --auto'), 'opencode');
  assert.equal(harnessOf('/opt/bin/gemini --yolo -p'), 'gemini');
  assert.equal(harnessOf('npx -y @openai/codex exec'), 'codex');
  assert.equal(harnessOf('my-agent go'), null);
});

test('opencode: the server is added to opencode.json, the rest of the file kept', () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ model: 'x/y', mcp: { other: { type: 'local' } } }));
  assert.deepEqual(registerMcp('opencode run', dir, BASE, () => {}), { command: 'opencode run', registered: true });
  const config = readJson(join(dir, 'opencode.json'));
  assert.equal(config.model, 'x/y');
  assert.deepEqual(config.mcp.other, { type: 'local' });
  assert.equal(config.mcp.eventmodelers.url, `${BASE}/mcp`);
  assert.equal(config.mcp.eventmodelers.headers['x-token'], '{env:EVENTMODELERS_TOKEN}');
});

test('opencode: a file already in the mcp.servers form gets the server there', () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ mcp: { servers: {} } }));
  registerMcp('opencode run', dir, BASE, () => {});
  const config = readJson(join(dir, 'opencode.json'));
  assert.equal(config.mcp.servers.eventmodelers.url, `${BASE}/mcp`);
  assert.equal(config.mcp.eventmodelers, undefined);
});

test('a config that is not plain JSON is left untouched, and what to add is logged', () => {
  const dir = freshDir();
  const jsonc = '{ // my comments\n "model": "x/y" }';
  writeFileSync(join(dir, 'opencode.json'), jsonc);
  const lines = [];
  assert.equal(registerMcp('opencode run', dir, BASE, (l) => lines.push(l)).registered, false);
  assert.equal(readFileSync(join(dir, 'opencode.json'), 'utf8'), jsonc);
  assert.match(lines.join('\n'), /could not update/);
});

test('gemini: the server goes into .gemini/settings.json', () => {
  const dir = freshDir();
  registerMcp('gemini --yolo -p', dir, BASE, () => {});
  const entry = readJson(join(dir, '.gemini', 'settings.json')).mcpServers.eventmodelers;
  assert.equal(entry.httpUrl, `${BASE}/mcp`);
  assert.equal(entry.headers['x-token'], '$EVENTMODELERS_TOKEN');
});

test('codex: the server rides on -c flags, and no file is written', () => {
  const dir = freshDir();
  const { command, registered } = registerMcp('codex exec --full-auto', dir, BASE, () => {});
  assert.equal(registered, true);
  assert.match(command, /^codex exec --full-auto -c 'mcp_servers\.eventmodelers\.url="https:\/\/api\.example\.test\/mcp"' -c 'mcp_servers\.eventmodelers\.env_http_headers=\{x-token="EVENTMODELERS_TOKEN",x-agent-id="EVENTMODELERS_AGENT_ID"\}'$/);
  assert.equal(existsSync(join(dir, '.codex')), false);
});

test('an unknown command runs as given, with a hint to register by hand', () => {
  const lines = [];
  assert.deepEqual(registerMcp('my-agent go', freshDir(), BASE, (l) => lines.push(l)), { command: 'my-agent go', registered: false });
  assert.match(lines.join('\n'), /register the eventmodelers MCP server with it yourself: https:\/\/api\.example\.test\/mcp/);
});
