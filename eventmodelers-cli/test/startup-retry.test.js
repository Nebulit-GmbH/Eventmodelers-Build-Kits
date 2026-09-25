import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, fetchPlatformConfig, retryTransient } from '../shared/build-kit/lib/ralph.js';
import { quiet } from './helpers.js';

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
  quiet(t);
  t.mock.method(Math, 'random', () => 0.999999);
  const { delays, sleepFn } = fakeSleep();
  const call = failing(503, 429, new TypeError('fetch failed'), Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 500);
  assert.equal(await retryTransient('fetchPlatformConfig', call.fn, { sleepFn }), 'ok');
  assert.equal(call.calls(), 6);
  assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 32_000]);
});

test('passes a real answer straight back, without retrying', async (t) => {
  quiet(t);
  for (const status of [400, 403, 404]) {
    const { delays, sleepFn } = fakeSleep();
    const call = failing(status);
    await assert.rejects(retryTransient('x', call.fn, { sleepFn }), { status });
    assert.equal(call.calls(), 1);
    assert.deepEqual(delays, []);
  }
});

test('fetchPlatformConfig survives a 502 at startup', async (t) => {
  quiet(t);
  const responses = [
    { ok: false, status: 502, text: async () => 'bad gateway' },
    { ok: true, status: 200, json: async () => ({ realtimeProvider: 'supabase' }) },
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift());
  const { sleepFn } = fakeSleep();
  const cfg = await retryTransient('fetchPlatformConfig', () => fetchPlatformConfig({ baseUrl: 'http://p', token: 't' }), { sleepFn });
  assert.equal(cfg.realtimeProvider, 'supabase');
});
