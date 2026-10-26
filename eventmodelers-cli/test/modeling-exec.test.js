import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setOpencodeStandaloneSupport } from '../shared/build-kit/lib/mcp-register.js';
import { withModel } from '../shared/build-kit/lib/harnesses/index.js';
import { createModelingExecRunner, harnessOf, registerMcp } from '../lib/modeling-exec.js';

setOpencodeStandaloneSupport(true);
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
  assert.deepEqual(registerMcp('opencode run', dir, BASE, () => {}), { command: 'opencode run --standalone', registered: true });
  const config = readJson(join(dir, 'opencode.json'));
  assert.equal(config.model, 'x/y');
  assert.deepEqual(config.mcp.other, { type: 'local' });
  assert.equal(config.mcp.eventmodelers.url, `${BASE}/mcp`);
  assert.equal(config.mcp.eventmodelers.headers['x-token'], '{env:EVENTMODELERS_TOKEN}');
});

test('opencode: a command that already picks its server is run as given', () => {
  assert.equal(registerMcp('opencode run --standalone --auto', freshDir(), BASE, () => {}).command, 'opencode run --standalone --auto');
  assert.equal(registerMcp('opencode run --server http://x', freshDir(), BASE, () => {}).command, 'opencode run --server http://x');
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

test('pi: the server goes into .pi/mcp.json, exposed directly, and the command is told to trust the project', () => {
  const dir = freshDir();
  const { command, registered } = registerMcp('pi -p', dir, BASE, () => {});
  const entry = readJson(join(dir, '.pi', 'mcp.json')).mcpServers.eventmodelers;
  assert.equal(entry.url, `${BASE}/mcp`);
  assert.equal(entry.headers['x-token'], '${EVENTMODELERS_TOKEN}');
  assert.equal(entry.exposure, 'direct');
  assert.equal(command, 'pi --approve -p');
  assert.equal(registered, true);
  assert.equal(registerMcp('pi --approve -p', dir, BASE, () => {}).command, 'pi --approve -p'); // the preset is left alone
  assert.equal(harnessOf('npx pi -p'), 'pi');
  assert.equal(withModel('pi --approve -p', 'anthropic/claude-sonnet-5-5'), "pi --approve -p --model 'anthropic/claude-sonnet-5-5'");
});

test('pi: usage and cost come from the assistant message on turn_end', async () => {
  const { usageFromHarnessEvent } = await import('../shared/build-kit/lib/tracing.js');
  const u = usageFromHarnessEvent({ type: 'turn_end', toolResults: [], message: { role: 'assistant', model: 'claude-sonnet-5-5', usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1, cost: { total: 0.01 } } } });
  assert.deepEqual(u, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1, costUsd: 0.01, model: 'claude-sonnet-5-5' });
  assert.equal(usageFromHarnessEvent({ type: 'turn_end', message: { role: 'user' } }), null);
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

test('hermes: never writes its user-wide config; registered only when it already names the server', () => {
  const home = freshDir();
  process.env.HERMES_HOME = home;
  try {
    const lines = [];
    assert.equal(registerMcp('hermes chat --yolo -Q -q', freshDir(), BASE, (l) => lines.push(l)).registered, false);
    assert.match(lines.join('\n'), /mcp_servers:\n  eventmodelers:/);
    writeFileSync(join(home, 'config.yaml'), 'mcp_servers:\n  eventmodelers:\n    url: "x"\n');
    assert.equal(registerMcp('hermes chat --yolo -Q -q', freshDir(), BASE, () => {}).registered, true);
  } finally {
    delete process.env.HERMES_HOME;
  }
});

test('an OpenCode without run --standalone gets the flag dropped, not added', () => {
  setOpencodeStandaloneSupport(false);
  try {
    assert.equal(registerMcp('opencode run --auto', freshDir(), BASE, () => {}).command, 'opencode run --auto');
    assert.equal(registerMcp('opencode run --standalone --auto', freshDir(), BASE, () => {}).command, 'opencode run --auto');
  } finally { setOpencodeStandaloneSupport(true); }
});

// A stand-in for Cursor's CLI: `create-chat` prints an id, anything else prints its own arguments
// (and fails when FAKE_CURSOR_FAIL is set), logging start/end so overlapping turns are visible.
function fakeCursor() {
  const dir = freshDir();
  const bin = join(dir, 'cursor-agent');
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "create-chat" ]; then echo chat-42; exit 0; fi
echo "start" >> "${dir}/log"; sleep 0.2; echo "end" >> "${dir}/log"
[ -n "$FAKE_CURSOR_FAIL" ] && [ ! -f "${dir}/ok" ] && { touch "${dir}/ok"; exit 1; }
echo "$@"
`);
  chmodSync(bin, 0o755);
  return { bin, dir };
}

test('cursor: the binary is recognised as `agent` only when it comes first, or as cursor-agent', () => {
  assert.equal(harnessOf('agent -p --trust'), 'cursor');
  assert.equal(harnessOf('/Users/me/.local/bin/cursor-agent -p'), 'cursor');
  assert.equal(harnessOf('my-agent go'), null);
  assert.equal(harnessOf('npx some-tool agent'), null);
});

test('cursor: the server goes into .cursor/mcp.json, the rest of the file kept', () => {
  const other = freshDir();
  assert.deepEqual(registerMcp('agent -p', other, BASE, () => {}), { command: 'agent -p', registered: true });
  const config = readJson(join(other, '.cursor', 'mcp.json'));
  assert.equal(config.mcpServers.eventmodelers.url, `${BASE}/mcp`);
  assert.equal(config.mcpServers.eventmodelers.headers['x-token'], '${env:EVENTMODELERS_TOKEN}');
});

test('cursor: every turn resumes one chat, and the preamble is only skipped once a turn succeeded', async () => {
  const { bin } = fakeCursor();
  const r = createModelingExecRunner({ cfg, command: `${bin} -p`, projectDir, log: () => {} });
  assert.equal(r.keepsSession, false);
  assert.match(await r.runTurn('first'), /^--resume chat-42 -p first$/);
  assert.equal(r.keepsSession, true);
  assert.match(await r.runTurn('second'), /^--resume chat-42 -p second$/);
});

test('cursor: a failed first turn leaves the session unprimed, so the next turn carries the preamble again', async () => {
  const { bin } = fakeCursor();
  process.env.FAKE_CURSOR_FAIL = '1';
  try {
    const r = createModelingExecRunner({ cfg, command: `${bin} -p`, projectDir, log: () => {} });
    await assert.rejects(r.runTurn('first'), /exited 1/);
    assert.equal(r.keepsSession, false);
    await r.runTurn('retry');
    assert.equal(r.keepsSession, true);
  } finally {
    delete process.env.FAKE_CURSOR_FAIL;
  }
});

test('cursor: overlapping turns run one after the other in the shared chat', async () => {
  const { bin, dir } = fakeCursor();
  const r = createModelingExecRunner({ cfg, command: `${bin} -p`, projectDir, log: () => {} });
  await Promise.all([r.runTurn('a'), r.runTurn('b')]);
  assert.deepEqual(readFileSync(join(dir, 'log'), 'utf8').trim().split('\n'), ['start', 'end', 'start', 'end']);
});

test('--model is spelled the way each harness wants it, and goes ahead of hermes\' trailing -q', () => {
  assert.equal(withModel('opencode run --standalone --auto', 'x/y'), "opencode run --standalone --auto -m 'x/y'");
  assert.equal(withModel('codex exec --full-auto', 'gpt-5'), "codex exec --full-auto -m 'gpt-5'");
  assert.equal(withModel('cursor-agent -p --trust', 'auto'), "cursor-agent -p --trust --model 'auto'");
  assert.equal(withModel('hermes chat --yolo -Q -q', 'm1'), "hermes chat --yolo -Q -m 'm1' -q");
});

test('resetSession() is a no-op for a harness whose every turn is a fresh process', async () => {
  const r = runner('printf "%s"');
  await r.runTurn('one');
  await r.resetSession(); // nothing to drop, and nothing to break
  assert.equal(await r.runTurn('two'), 'two');
});
