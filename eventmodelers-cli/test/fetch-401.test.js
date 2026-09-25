import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, fetchPlatformConfig, retryTransient } from '../shared/build-kit/lib/ralph.js';
import { mockExit, quiet } from './helpers.js';

const respond = (t, ...responses) => t.mock.method(globalThis, 'fetch', async () => responses.shift());
const status = (code, body = '') => ({ ok: code < 400, status: code, text: async () => body, json: async () => ({}) });

test('a 401 exits with 1 on the first one — even inside the startup retry', async (t) => {
  quiet(t);
  const exit = mockExit(t);
  const fetch = respond(t, status(503), status(401, '{"error":"invalid token"}'), status(200));
  await assert.rejects(
    retryTransient('fetchPlatformConfig', () => fetchPlatformConfig({ baseUrl: 'http://p', token: 't' }), { sleepFn: async () => {} }),
    { exitCode: 1 },
  );
  assert.equal(fetch.mock.callCount(), 2); // the 503 was retried, the 401 was not
  assert.equal(exit.mock.callCount(), 1);
});

test('any other error status is thrown as an HttpError, without exiting', async (t) => {
  quiet(t);
  const exit = mockExit(t);
  respond(t, status(403, 'forbidden'));
  await assert.rejects(fetchPlatformConfig({ baseUrl: 'http://p', token: 't' }), (err) => err instanceof HttpError && err.status === 403);
  assert.equal(exit.mock.callCount(), 0);
});
