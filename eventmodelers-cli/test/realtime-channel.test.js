import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRealtimeAgent } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

// Lets pending promise chains (a stubbed fetch, an awaited token refresh) run to completion.
// setImmediate is left real by the timer mock, so it is a safe way to yield.
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

// A realtime transport whose every subscribe() ends the way `script` says, in order.
function fakeAdapter(script) {
  const subscribes = [];
  const create = async () => ({
    async subscribe(topic, handlers, onStatus) {
      const step = script.shift() ?? 'SUBSCRIBED';
      subscribes.push(step);
      if (step === 'THROW') throw new Error('handshake failed');
      if (step === 'DOUBLE_ERROR') { onStatus('CHANNEL_ERROR'); onStatus('CHANNEL_ERROR'); return; }
      onStatus(step);
    },
    setAuth() {},
  });
  return { create, subscribes };
}

function stubPlatform(t) {
  const calls = { sliceFetches: 0 };
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('slicedata')) calls.sliceFetches++;
    const body = url.includes('realtime-token') ? { token: 'rt' } : url.includes('slicedata') ? { slices: [] } : {};
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  });
  return calls;
}

async function start(t, script) {
  quiet(t);
  t.mock.method(Math, 'random', () => 0); // backoff = half its ceiling: 1s, 2s, 4s, …
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const kitDir = tempKit(t);
  const platform = stubPlatform(t);
  const adapter = fakeAdapter(script);
  const cfg = { baseUrl: 'http://platform', organizationId: 'org', boardId: 'board', token: 'tok', agentId: 'agent' };
  await startRealtimeAgent(cfg, kitDir, { createAdapter: adapter.create });
  await flush();
  return { platform, subscribes: adapter.subscribes };
}

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await flush();
}

test('resubscribes after each failure with a doubling delay, and never gives up', async (t) => {
  const { subscribes } = await start(t, ['CHANNEL_ERROR', 'THROW', 'TIMED_OUT', 'CHANNEL_ERROR', 'CHANNEL_ERROR', 'CHANNEL_ERROR', 'SUBSCRIBED']);
  assert.equal(subscribes.length, 1);

  // Delays for attempts 1..6 with Math.random = 0: 1s, 2s, 4s, 8s, 16s, 32s.
  for (const [delay, expected] of [[1_000, 2], [2_000, 3], [4_000, 4], [8_000, 5], [16_000, 6], [32_000, 7]]) {
    await tick(t, delay - 1);
    assert.equal(subscribes.length, expected - 1, `not yet resubscribed ${delay - 1}ms in`);
    await tick(t, 1);
    assert.equal(subscribes.length, expected, `resubscribed after ${delay}ms`);
  }
  // Past the old limit of 5 attempts, and recovered.
  assert.equal(subscribes.at(-1), 'SUBSCRIBED');
});

test('a subscribe that throws is retried instead of crashing', async (t) => {
  const { subscribes } = await start(t, ['THROW', 'SUBSCRIBED']);
  await tick(t, 1_000);
  assert.deepEqual(subscribes, ['THROW', 'SUBSCRIBED']);
});

test('one failure reported twice schedules a single resubscribe', async (t) => {
  const { subscribes } = await start(t, ['DOUBLE_ERROR', 'SUBSCRIBED']);
  await tick(t, 60_000);
  assert.deepEqual(subscribes, ['DOUBLE_ERROR', 'SUBSCRIBED']);
});

test('a normal first subscribe does not re-fetch the slices', async (t) => {
  const { platform } = await start(t, ['SUBSCRIBED']);
  await tick(t, 60_000);
  assert.equal(platform.sliceFetches, 1); // the startup fetch only
});

test('re-fetches the slices once after recovering from a failure', async (t) => {
  const { platform } = await start(t, ['CHANNEL_ERROR', 'SUBSCRIBED']);
  assert.equal(platform.sliceFetches, 1);
  await tick(t, 1_000);
  assert.equal(platform.sliceFetches, 2);
});
