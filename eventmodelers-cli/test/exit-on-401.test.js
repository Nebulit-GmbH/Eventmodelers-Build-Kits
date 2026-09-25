import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, exitOn401 } from '../shared/build-kit/lib/ralph.js';

// process.exit can't really run inside the test process — make it throw instead, so the test
// sees that (and how) it was called.
function mockExit(t) {
  t.mock.method(console, 'error', () => {});
  return t.mock.method(process, 'exit', (code) => {
    throw Object.assign(new Error('process.exit'), { exitCode: code });
  });
}

test('exits with 1 on the first 401, without retrying', async (t) => {
  const exit = mockExit(t);
  let calls = 0;
  await assert.rejects(
    exitOn401('fetchPlatformConfig', async () => { calls++; throw new HttpError(401, '{"error":"invalid token"}'); }),
    { exitCode: 1 },
  );
  assert.equal(calls, 1);
  assert.equal(exit.mock.callCount(), 1);
});

test('passes any other error back to the caller', async (t) => {
  const exit = mockExit(t);
  await assert.rejects(exitOn401('x', async () => { throw new HttpError(500, 'boom'); }), { status: 500 });
  await assert.rejects(exitOn401('x', async () => { throw new TypeError('fetch failed'); }), TypeError);
  assert.equal(exit.mock.callCount(), 0);
});

test('returns the result when the call succeeds', async (t) => {
  mockExit(t);
  assert.equal(await exitOn401('x', async () => 42), 42);
});
