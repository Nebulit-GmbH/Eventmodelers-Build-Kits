import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../shared/build-kit/lib/ralph.js';
import { quiet } from './helpers.js';

// The board as the slice-state shell sees it (case 2 of slice-state-learnings.md).

const cfg = { baseUrl: 'http://board.test', organizationId: 'o', boardId: 'b', token: 't', agentId: 'a1' };
const json = (status, body = {}) => new Response(JSON.stringify(body), { status });

test('setStatus posts one node:changed for the slice, as this agent', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => { calls.push({ url, opts }); return json(200); });
  await createBoard(cfg).setStatus('s1', 'InProgress');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://board.test/api/org/o/boards/b/nodes/events');
  assert.equal(calls[0].opts.headers['x-agent-id'], 'a1');
  const [event] = JSON.parse(calls[0].opts.body);
  assert.deepEqual({ type: event.eventType, node: event.nodeId, status: event.meta.sliceStatus }, { type: 'node:changed', node: 's1', status: 'InProgress' });
});

test('a rejection on the first attempt is a lost race and surfaces', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json(409, { error: 'ALREADY_IN_STATUS' }));
  await assert.rejects(createBoard(cfg).setStatus('s1', 'InProgress'), (err) => err.status === 409);
});

test('a first attempt that landed but lost its response is still won on the retry (2)', async (t) => {
  quiet(t);
  let posts = 0;
  // 1st: reached the board, response lost (503). 2nd: the same-status guard rejects it.
  t.mock.method(globalThis, 'fetch', async () => (++posts === 1 ? json(503) : json(409, { error: 'ALREADY_IN_STATUS' })));
  await createBoard(cfg).setStatus('s1', 'InProgress');
  assert.equal(posts, 2);
});

test('readStatus gives the slice\'s status on the board, or null when it is not there', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json(200, { slices: [{ id: 's1', status: 'Blocked' }] }));
  const board = createBoard(cfg);
  assert.equal(await board.readStatus('s1'), 'Blocked');
  assert.equal(await board.readStatus('s2'), null);
});
