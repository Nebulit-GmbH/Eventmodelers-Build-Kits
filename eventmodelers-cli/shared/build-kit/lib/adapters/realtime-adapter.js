// Realtime adapter — picks the platform's realtime transport per cfg.realtimeProvider
// (set by /api/config: Supabase broadcast channels for the hosted SaaS, PocketBase
// record-change events for self-hosted/on-prem) and hands back one common interface:
//
//   subscribe(topic, handlers, onStatus?) — handlers is a { [eventName]: (payload) => void }
//     map; onStatus?.(status) fires once the subscription is live ('SUBSCRIBED').
//   setAuth(token) — refresh the short-lived realtime token on the live connection.
//
// cfg.realtimeProvider absent (older servers, predating PocketBase support) means
// 'supabase' — the only transport that ever existed before it.
//
// Single source of truth for both runtimes that need it: cli.js's modeling loop
// imports this file directly out of the npm package (shared/build-kit/lib/adapters/...),
// and every useShared:true stack gets this whole adapters/ folder copied alongside
// ralph.js into the installed kit (see copyDirContents in cli.js), so ralph.js's copy
// imports it via the relative path './adapters/realtime-adapter.js' from wherever it
// ends up on disk.

import { createSupabaseRealtimeAdapter } from './supabase-realtime-adapter.js';
import { createPocketBaseRealtimeAdapter } from './pocketbase-realtime-adapter.js';

export async function createRealtimeAdapter(cfg, initialToken) {
  const provider = cfg.realtimeProvider ?? 'supabase';
  return provider === 'pocketbase'
    ? createPocketBaseRealtimeAdapter(cfg, initialToken)
    : createSupabaseRealtimeAdapter(cfg, initialToken);
}
