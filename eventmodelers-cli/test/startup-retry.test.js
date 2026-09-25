import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, exitOn401, fetchPlatformConfig, retryTransient } from '../shared/build-kit/lib/ralph.js';

// Replaces the real waits: records each requested delay and resolves at once.
function fakeSleep() {
  const delays = [];
  return { delays, sleepFn: async (ms) => { delays.push(ms); } };
}

// Fails with each of `failures` in turn, then succeeds with 'ok'.
function failing(...failures) {
  let calls = 0;
  const fn = async () => {
    const f = failures[calls++];
    if (f === undefined) return 'ok';
    throw typeof f === 'number' ? new HttpError(f, 'body') : f;
  };
  return { fn, calls: () => calls };
}

test('retries 5xx, 429 and network failures with growing delays until one succeeds', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(Math, 'random', () => 0.999999);
  const { delays, sleepFn } = fakeSleep();
  const call = failing(503, 429, new TypeError('fetch failed'), Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 500);
  assert.equal(await retryTransient('fetchPlatformConfig', call.fn, { sleepFn }), 'ok');
  assert.equal(call.calls(), 6);
  assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 32_000]);
});

test('passes a real answer straight back, without retrying', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const status of [400, 403, 404]) {
    const { delays, sleepFn } = fakeSleep();
    const call = failing(status);
    await assert.rejects(retryTransient('x', call.fn, { sleepFn }), { status });
    assert.equal(call.calls(), 1);
    assert.deepEqual(delays, []);
  }
});

test('a 401 is not retried: exitOn401 ends the process on the first one', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const exit = t.mock.method(process, 'exit', (code) => { throw Object.assign(new Error('exit'), { exitCode: code }); });
  const { delays, sleepFn } = fakeSleep();
  const call = failing(503, 401);
  await assert.rejects(exitOn401('fetchPlatformConfig', () => retryTransient('fetchPlatformConfig', call.fn, { sleepFn })), { exitCode: 1 });
  assert.equal(call.calls(), 2);
  assert.equal(delays.length, 1);
  assert.equal(exit.mock.callCount(), 1);
});

test('fetchPlatformConfig survives a 502 at startup', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const responses = [
    { ok: false, status: 502, text: async () => 'bad gateway' },
    { ok: true, status: 200, json: async () => ({ realtimeProvider: 'supabase' }) },
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift());
  const { sleepFn } = fakeSleep();
  const cfg = await retryTransient('fetchPlatformConfig', () => fetchPlatformConfig({ baseUrl: 'http://p', token: 't' }), { sleepFn });
  assert.equal(cfg.realtimeProvider, 'supabase');
});
