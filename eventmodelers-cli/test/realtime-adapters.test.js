import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseRealtimeAdapter } from '../shared/build-kit/lib/adapters/supabase-realtime-adapter.js';
import { createPocketBaseRealtimeAdapter } from '../shared/build-kit/lib/adapters/pocketbase-realtime-adapter.js';

const handlers = { message() {}, 'slice:changed'() {} };

test('supabase: resubscribing replaces the channel instead of stacking handlers on it', async (t) => {
  // The real supabase-js client — its channel(topic) returning the existing channel is exactly
  // the behaviour under test. Nothing listens on this address; no connection is needed.
  let client;
  const adapter = await createSupabaseRealtimeAdapter(
    { supabaseUrl: 'http://127.0.0.1:1', supabaseAnonKey: 'anon' },
    'token',
    { createClient: (...args) => (client = createClient(...args)) },
  );
  t.after(async () => { await client.removeAllChannels(); client.realtime.disconnect(); });

  for (let i = 0; i < 3; i++) await adapter.subscribe('board:b-slicechanged', handlers, () => {});

  const channels = client.getChannels();
  assert.equal(channels.length, 1);
  assert.equal(channels[0].bindings.broadcast.length, Object.keys(handlers).length);
});

test('supabase: status from a replaced channel is not reported', async (t) => {
  let client;
  const adapter = await createSupabaseRealtimeAdapter(
    { supabaseUrl: 'http://127.0.0.1:1', supabaseAnonKey: 'anon' },
    'token',
    { createClient: (...args) => (client = createClient(...args)) },
  );
  t.after(async () => { await client.removeAllChannels(); client.realtime.disconnect(); });

  const first = [];
  await adapter.subscribe('board:b-slicechanged', handlers, (s) => first.push(s));
  await adapter.subscribe('board:b-slicechanged', handlers, () => {});
  assert.ok(!first.includes('CLOSED'), `first subscription still reported: ${first.join(', ')}`);
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
