import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseRealtimeAdapter } from '../shared/build-kit/lib/adapters/supabase-realtime-adapter.js';
import { createPocketBaseRealtimeAdapter } from '../shared/build-kit/lib/adapters/pocketbase-realtime-adapter.js';

const handlers = { message() {}, 'slice:changed'() {} };

// The real supabase-js client — its channel(topic) returning the existing channel is exactly
// the behaviour under test. Nothing listens on this address; no connection is needed.
async function supabaseAdapter(t) {
  let client;
  const adapter = await createSupabaseRealtimeAdapter(
    { supabaseUrl: 'http://127.0.0.1:1', supabaseAnonKey: 'anon' },
    'token',
    { createClient: (...args) => (client = createClient(...args)) },
  );
  t.after(async () => { await client.removeAllChannels(); client.realtime.disconnect(); });
  return { adapter, client };
}

test('supabase: resubscribing replaces the channel instead of stacking handlers on it', async (t) => {
  const { adapter, client } = await supabaseAdapter(t);

  for (let i = 0; i < 3; i++) await adapter.subscribe('board:b-slicechanged', handlers, () => {});

  const channels = client.getChannels();
  assert.equal(channels.length, 1);
  assert.equal(channels[0].bindings.broadcast.length, Object.keys(handlers).length);
});

test('supabase: status from a replaced channel is not reported', async (t) => {
  const { adapter } = await supabaseAdapter(t);

  const first = [];
  await adapter.subscribe('board:b-slicechanged', handlers, (s) => first.push(s));
  await adapter.subscribe('board:b-slicechanged', handlers, () => {});
  assert.ok(!first.includes('CLOSED'), `first subscription still reported: ${first.join(', ')}`);
});

test('supabase: different topics are kept side by side', async (t) => {
  const { adapter, client } = await supabaseAdapter(t);

  await adapter.subscribe('board:b-slicechanged', handlers, () => {});
  await adapter.subscribe('org:o', handlers, () => {});
  assert.equal(client.getChannels().length, 2);

  await adapter.unsubscribe('org:o');
  assert.deepEqual(client.getChannels().map((c) => c.subTopic), ['board:b-slicechanged']);
});

test('pocketbase: resubscribing unsubscribes the previous listener first', async () => {
  const listeners = new Set();
  class FakePocketBase {
    authStore = { save() {} };
    collection() {
      return {
        async subscribe(_topic, cb) {
          listeners.add(cb);
          return async () => { listeners.delete(cb); };
        },
      };
    }
  }
  const adapter = await createPocketBaseRealtimeAdapter({ pocketbaseUrl: 'http://pb' }, 'token', { PocketBase: FakePocketBase });

  for (let i = 0; i < 3; i++) await adapter.subscribe('board:b-slicechanged', handlers, () => {});

  assert.equal(listeners.size, 1);
});

test('pocketbase: concurrent subscribes to different topics share one SDK listener', async () => {
  const listeners = new Set();
  class FakePocketBase {
    authStore = { save() {} };
    collection() {
      return {
        async subscribe(_topic, cb) {
          await new Promise((r) => setTimeout(r, 10)); // the handshake is in flight while the others subscribe
          listeners.add(cb);
          return async () => { listeners.delete(cb); };
        },
      };
    }
  }
  const adapter = await createPocketBaseRealtimeAdapter({ pocketbaseUrl: 'http://pb' }, 'token', { PocketBase: FakePocketBase });

  await Promise.all(['board:a-slicechanged', 'board:b-slicechanged', 'org:o'].map((t) => adapter.subscribe(t, handlers, () => {})));

  assert.equal(listeners.size, 1);
});

test('pocketbase adapter resolves a path-only pocketbaseUrl against baseUrl', async () => {
  const seen = [];
  class FakePocketBase {
    constructor(url) { seen.push(url); }
    authStore = { save() {} };
  }
  const make = (cfg) => createPocketBaseRealtimeAdapter(cfg, 'token', { PocketBase: FakePocketBase });

  await make({ pocketbaseUrl: '/pb', baseUrl: 'https://host/' });
  await make({ pocketbaseUrl: '/pb', baseUrl: 'https://host/api' });
  await make({ pocketbaseUrl: 'https://other/pb', baseUrl: 'https://host' });

  assert.deepEqual(seen, ['https://host/pb', 'https://host/pb', 'https://other/pb']);
  await assert.rejects(make({ pocketbaseUrl: '/pb' }), /no baseUrl/);
});
