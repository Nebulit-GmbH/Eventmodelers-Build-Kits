// Realtime adapter — picks the platform's realtime transport per cfg.realtimeProvider
// (set by /api/config: Supabase broadcast channels for the hosted SaaS, PocketBase
// record-change events for self-hosted/on-prem) and hands back one common interface:
//
//   subscribe(topic, handlers, onStatus?) — handlers is a { [eventName]: (payload) => void }
//     map; onStatus?.(status) fires once the subscription is live ('SUBSCRIBED'). Calling it
//     again for the same topic replaces that topic's subscription — never adds to it — and a
//     replaced one no longer reports status. Different topics live side by side.
//   unsubscribe(topic) — drop the topic's subscription (a no-op if there is none).
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
import { backoffMs } from '../backoff.js';

export async function createRealtimeAdapter(cfg, initialToken) {
  const provider = cfg.realtimeProvider ?? 'supabase';
  return provider === 'pocketbase'
    ? createPocketBaseRealtimeAdapter(cfg, initialToken)
    : createSupabaseRealtimeAdapter(cfg, initialToken);
}

const FAILED = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);
// A subscription has to hold this long before its failures are forgiven. Resetting on the
// bare SUBSCRIBED let a channel that flaps (SUBSCRIBED, CHANNEL_ERROR, SUBSCRIBED, …) retry
// at the shortest delay forever.
const STABLE_MS = 60_000;

// Keeps one topic subscribed for the life of the process. A failed channel is removed at
// once — otherwise realtime-js keeps rejoining it on its own fixed schedule, which is where
// the flood of SUBSCRIBED/CHANNEL_ERROR lines came from — and re-joined after an exponential
// backoff, with a fresh token, for as long as it takes.
//
// onSubscribed({ recovered }) runs on every successful join; recovered is true when it
// follows a failure (broadcasts sent while the channel was down are gone).
export function keepSubscribed(realtime, topic, handlers, {
  log = console.log,
  refreshToken = async () => {},
  onSubscribed = () => {},
  backoff = { baseMs: 2_000, capMs: 5 * 60_000 },
} = {}) {
  let failures = 0;
  let down = false;
  let retryPending = false;
  let stableTimer = null;

  const onFailure = (reason) => {
    // One failure can be reported more than once (a channel erroring while its retry is
    // already scheduled); a second resubscribe on top would join the channel twice.
    if (retryPending) return;
    retryPending = true;
    down = true;
    clearTimeout(stableTimer);
    failures += 1;
    const delay = backoffMs(failures, backoff);
    log(`channel "${topic}": ${reason} (attempt ${failures}) — resubscribing in ${Math.round(delay / 1000)}s`);
    realtime.unsubscribe(topic).catch(() => {});
    setTimeout(async () => {
      // A failed refresh is the caller's to log; rejoining on the old token is still worth a try.
      await refreshToken(`channel ${reason}`).catch(() => {});
      retryPending = false;
      subscribe();
    }, delay);
  };

  const onStatus = (status) => {
    if (FAILED.has(status)) return onFailure(status);
    if (status !== 'SUBSCRIBED') return log(`channel "${topic}": ${status}`);
    const recovered = down;
    down = false;
    log(`channel "${topic}": SUBSCRIBED${recovered ? ` — recovered after ${failures} failed attempt(s)` : ''}`);
    clearTimeout(stableTimer);
    stableTimer = setTimeout(() => { failures = 0; }, STABLE_MS);
    onSubscribed({ recovered });
  };

  const subscribe = () => {
    realtime.subscribe(topic, handlers, onStatus)
      .catch((err) => onFailure(`subscribe failed: ${err.message}`));
  };
  subscribe();
}
