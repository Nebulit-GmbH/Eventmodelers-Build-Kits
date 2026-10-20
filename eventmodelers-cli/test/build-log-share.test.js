import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { appendEvent, readEvents } from '../shared/build-kit/lib/slice-events.js';
import { createBuildLogShare, kitTypeOf, toBuildLogEntry } from '../shared/build-kit/lib/build-log-share.js';
import { tempKit } from './helpers.js';

const AGENT = '11111111-2222-3333-4444-555555555555';

async function platform(t, { status = 200 } = {}) {
  const posts = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { posts.push({ url: req.url, headers: req.headers, body: JSON.parse(body) }); res.writeHead(status).end('{}'); });
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  return { posts, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

const kit = (t) => { const dir = join(tempKit(t), '.build-kit'); mkdirSync(dir, { recursive: true }); return dir; };
const cfgOf = (baseUrl) => ({ baseUrl, token: 'tok', organizationId: 'org-1', boardId: 'board-1', agentId: AGENT });
const planned = { id: 'slice-1', title: 'Seats' };

test('an iteration is a started and a closed event with slice, iteration, board, org and date', async (t) => {
  const kitDir = kit(t);
  const share = createBuildLogShare({ kitDir, cfg: cfgOf('http://unused'), meta: {}, sync: false });
  const id = share.iterationStarted(planned);
  await share.iterationClosed(planned, 'ok');
  const [started, closed] = readEvents(kitDir);
  assert.deepEqual([started.type, closed.type], ['iteration-started', 'iteration-closed']);
  for (const e of [started, closed]) {
    assert.equal(e.slice, 'slice-1'); assert.equal(e.iteration, id);
    assert.equal(e.boardId, 'board-1'); assert.equal(e.organizationId, 'org-1'); assert.ok(e.at);
  }
});

test('an iteration that settled the slice as Done ends with slice-done, after iteration-closed; one that did not, does not', async (t) => {
  const kitDir = kit(t);
  const share = createBuildLogShare({ kitDir, cfg: cfgOf('http://unused'), meta: {}, sync: false });
  share.iterationStarted(planned);
  appendEvent(kitDir, { type: 'settled', slice: 'slice-1', status: 'Waiting' }, {});
  await share.iterationClosed(planned, 'ok');
  assert.deepEqual(readEvents(kitDir).map((e) => e.type), ['iteration-started', 'settled', 'iteration-closed']);

  const id = share.iterationStarted(planned);
  appendEvent(kitDir, { type: 'settled', slice: 'slice-1', status: 'Done' }, {});
  await share.iterationClosed(planned, 'ok');
  const types = readEvents(kitDir).slice(3).map((e) => e.type);
  assert.deepEqual(types, ['iteration-started', 'settled', 'iteration-closed', 'slice-done']);
  const done = readEvents(kitDir).at(-1);
  assert.equal(done.iteration, id); assert.equal(done.slice, 'slice-1'); assert.equal(done.kitType, 'backend');
});

test('--sync uploads the events that name a slice, once, and carries the iteration on later events', async (t) => {
  const { posts, baseUrl } = await platform(t);
  const kitDir = kit(t);
  const share = createBuildLogShare({ kitDir, cfg: cfgOf(baseUrl), meta: {}, sync: true });
  const iteration = share.iterationStarted(planned);
  appendEvent(kitDir, { type: 'learning-recorded', text: 'no slice' }, {});
  appendEvent(kitDir, { type: 'info-recorded', kind: 'limitation', text: 'x', slice: 'slice-1' }, {});
  await share.flush();
  const sent = posts.flatMap((p) => p.body.events);
  assert.deepEqual(sent.map((e) => e.type), ['iteration-started', 'info-recorded']);
  assert.equal(sent[1].iteration, iteration);
  assert.equal(sent[1].kind, 'limitation');
  assert.ok(sent.every((e) => e.kitType === 'backend'));
  assert.deepEqual(sent.map((e) => e.seq), [1, 3], 'the log\'s own numbers: the slice-less learning between them is 2');
  assert.equal(posts[0].url, '/api/org/org-1/boards/board-1/buildlog');
  assert.equal(posts[0].headers['x-agent-id'], AGENT);
  const before = posts.length;
  await share.flush();
  assert.equal(posts.length, before, 'nothing new, nothing sent');
});

test('the interval syncs while the loop runs; a failed upload is sent again', async (t) => {
  const kitDir = kit(t);
  const down = await platform(t, { status: 500 });
  const share = createBuildLogShare({ kitDir, cfg: cfgOf(down.baseUrl), meta: {}, sync: true, intervalMs: 20, log: () => {} });
  appendEvent(kitDir, { type: 'info-recorded', text: 'x', slice: 'slice-1' }, {});
  share.start();
  await new Promise((r) => setTimeout(r, 120));
  share.stop();
  assert.ok(down.posts.length >= 2, 'the same events are retried with the next upload');
});

test('without --sync, and for a modeling agent, nothing is sent or recorded', async (t) => {
  const { posts, baseUrl } = await platform(t);
  const kitDir = kit(t);
  const off = createBuildLogShare({ kitDir, cfg: cfgOf(baseUrl), meta: {}, sync: false });
  off.iterationStarted(planned); await off.flush();
  const modeling = createBuildLogShare({ kitDir, cfg: cfgOf(baseUrl), meta: {}, agentType: 'MODELING', sync: true });
  assert.equal(modeling.iterationStarted(planned), null); await modeling.flush();
  assert.equal(posts.length, 0);
  assert.equal(readEvents(kitDir).length, 1, 'only the build agent\'s iteration event');
});

test('toBuildLogEntry maps slice to sliceId and drops local-only fields', () => {
  const e = toBuildLogEntry({ id: 'e1', at: 'A', type: 't', slice: 's', meta: { agent_id: 'x' }, tags: ['a'], text: 'hi' }, { agentId: AGENT, iteration: 'i', boardId: 'b', organizationId: 'o', kitType: 'ui', seq: 7 });
  assert.deepEqual(e, { text: 'hi', id: 'e1', type: 't', sliceId: 's', agentId: AGENT, iteration: 'i', occurredAt: 'A', boardId: 'b', organizationId: 'o', kitType: 'ui', seq: 7 });
  assert.deepEqual([kitTypeOf('Planned'), kitTypeOf('Waiting'), kitTypeOf(undefined)], ['backend', 'ui', 'backend']);
});
