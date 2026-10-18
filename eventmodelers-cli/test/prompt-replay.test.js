import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent } from '../shared/build-kit/lib/slice-events.js';
import { journalPromptReceived } from '../shared/build-kit/lib/prompt-journal.js';
import { findPromptEvent, replayRequest } from '../shared/build-kit/lib/prompt-replay.js';

// `replay <id>` puts a journaled prompt back on the board's queue. The journal keeps what POST /prompts took, so the
// copy asks the same thing about the same elements.

const root = fileURLToPath(new URL('..', import.meta.url));
const ID = '3bf115cd-0000-4000-8000-000000000001';
const prompt = { id: ID, prompt: 'add 4 random fields, but only to this', board_id: 'b1', timeline_id: 'tl1', node_id: 'n1', priority: true, context: { selectedNodes: ['n1'] } };
const received = (p = prompt) => ({ type: 'prompt-received', prompt: { id: p.id, text: p.prompt, board_id: p.board_id, timeline_id: p.timeline_id, node_id: p.node_id, priority: p.priority, context: p.context } });

test('a prompt is found by a unique prefix of its id', () => {
  assert.equal(findPromptEvent([received()], '3bf1').prompt.id, ID);
});

test('no match, an ambiguous prefix and a prompt journaled before replay each say what is wrong', () => {
  assert.throws(() => findPromptEvent([received()], 'zzzz'), /no prompt "zzzz".*pruned/);
  assert.throws(() => findPromptEvent([received(), received({ ...prompt, id: '3bf1ffff-0000-4000-8000-000000000002' })], '3bf1'), /matches 2 prompts/);
  assert.throws(() => findPromptEvent([received({ ...prompt, timeline_id: undefined })], '3bf1'), /before replay was supported/);
  assert.throws(() => findPromptEvent([], ''), /give the id/);
});

test('the request carries what the original prompt asked, and leaves out what it did not have', () => {
  const req = replayRequest({ baseUrl: 'https://x', organizationId: 'o1', token: 'tok', jwt: 'jwt', event: received() });
  assert.equal(req.url, 'https://x/api/org/o1/prompts');
  assert.equal(req.headers.Authorization, 'Bearer jwt');
  assert.deepEqual(req.body, { prompt: prompt.prompt, board_id: 'b1', timeline_id: 'tl1', node_id: 'n1', priority: true, context: { selectedNodes: ['n1'] } });
  const bare = replayRequest({ baseUrl: 'https://x', organizationId: 'o1', token: 'tok', jwt: 'jwt', event: received({ id: ID, prompt: 'hi', board_id: 'b1', timeline_id: 'tl1' }) });
  assert.deepEqual(bare.body, { prompt: 'hi', board_id: 'b1', timeline_id: 'tl1' });
});

test('the command submits the journaled prompt to the platform and --dry-run submits nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'replay-'));
  const kit = join(home, 'kit');
  mkdirSync(kit, { recursive: true });
  journalPromptReceived({ kitDir: kit, prompt: { id: ID, prompt: prompt.prompt, board_id: 'b1', timeline_id: 'tl1', node_id: 'n1', priority: true, context: prompt.context } });

  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body && JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/realtime-token')) return res.end(JSON.stringify({ token: 'the-jwt' }));
      res.statusCode = 201;
      res.end(JSON.stringify({ id: 'abcdef12-new', status: 'ADDED' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (...args) => new Promise((resolve) => {
    const proc = spawn(process.execPath, [join(root, 'cli.js'), 'replay', '3bf1', '--kit', kit, '--token', 'tok', '--organization-id', 'o1', '--base-url', base, ...args], { env: { ...process.env, HOME: home, EVENTMODELERS_NO_UPDATE_CHECK: '1' } });
    let out = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (out += c));
    proc.on('close', (code) => resolve({ code, out }));
  });

  try {
    const printed = await run('--dry-run');
    assert.equal(printed.code, 0, printed.out);
    assert.deepEqual(seen.map((s) => s.url.split('/').pop()), ['realtime-token']);

    seen.length = 0;
    const sent = await run();
    assert.equal(sent.code, 0, sent.out);
    assert.match(sent.out, /Re-submitted prompt 3bf115cd as abcdef12/);
    const post = seen.find((s) => s.method === 'POST');
    assert.equal(post.url, '/api/org/o1/prompts');
    assert.equal(post.auth, 'Bearer the-jwt');
    assert.deepEqual(post.body, { prompt: prompt.prompt, board_id: 'b1', timeline_id: 'tl1', node_id: 'n1', priority: true, context: prompt.context });
  } finally {
    server.close();
  }
});
