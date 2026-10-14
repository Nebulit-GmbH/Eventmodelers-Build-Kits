// PocketBase realtime adapter — the self-hosted/on-prem transport. PocketBase has no
// generic pub/sub broadcast API; realtime only fires on record create/update/delete
// within a subscribed collection, so the backend piggybacks broadcasts onto a
// `realtime_events` collection (topic/event/payload fields) and this adapter filters
// that collection's create-stream down to the requested topic. See realtime-adapter.js
// for the interface both this and the Supabase adapter implement.

const REALTIME_EVENTS_COLLECTION = 'realtime_events';

// Same backoff steps the PocketBase SDK uses for its own reconnects (see
// predefinedReconnectIntervals in the SDK) — reused here because the SDK only
// applies that backoff to a connection that drops *after* it was established.
// A failed first handshake (e.g. "Invalid realtime client" from the initial
// GET /api/realtime and the follow-up subscribe POST landing on different
// backend instances) rejects immediately with no retry at all, so we retry it
// ourselves.
const RECONNECT_INTERVALS_MS = [200, 300, 500, 1000, 1200, 1500, 2000];

// deps.PocketBase is injectable for tests; by default it is the pocketbase SDK's client.
export async function createPocketBaseRealtimeAdapter(cfg, initialToken, deps = {}) {
  const { EventSource } = await import('eventsource');
  if (!globalThis.EventSource) globalThis.EventSource = EventSource; // PocketBase's SDK assumes a browser-style global
  const PocketBase = deps.PocketBase ?? (await import('pocketbase')).default;
  const pb = new PocketBase(cfg.pocketbaseUrl);
  pb.authStore.save(initialToken, null);

  // The SDK adds one EventSource listener per subscribe() call — and keeps it when the call
  // fails — so a flaky connection retrying per topic piles listeners up (Node warns at 11).
  // Hence a single SDK subscription for the whole adapter, fanned out to topics here.
  // subscribe() replaces the topic's previous handlers (see realtime-adapter.js).
  const topics = new Map();
  let sdkUnsubscribe = null;
  let connecting = null;

  const connect = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        sdkUnsubscribe = await pb.collection(REALTIME_EVENTS_COLLECTION).subscribe('*', (e) => {
          if (e.action !== 'create') return;
          const entry = topics.get(e.record.topic);
          entry?.handlers[e.record.event]?.(e.record.payload);
        });
        return;
      } catch (err) {
        // Drop the listener the failed call left behind before trying again.
        await pb.collection(REALTIME_EVENTS_COLLECTION).unsubscribe('*').catch(() => {});
        if (attempt >= RECONNECT_INTERVALS_MS.length) throw err;
        topics.forEach((t) => t.onStatus?.(`RECONNECTING (attempt ${attempt + 1}/${RECONNECT_INTERVALS_MS.length}): ${err.message}`));
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_INTERVALS_MS[attempt]));
      }
    }
  };

  // Concurrent subscribe() calls share one in-flight connect — sdkUnsubscribe is only set
  // after the await, so without this each would open its own SDK subscription.
  const ensureSdkSubscription = () => {
    if (sdkUnsubscribe) return Promise.resolve();
    connecting ??= connect().finally(() => { connecting = null; });
    return connecting;
  };

  const remove = async (topic) => {
    topics.delete(topic);
    if (topics.size || !sdkUnsubscribe) return;
    const unsubscribe = sdkUnsubscribe;
    sdkUnsubscribe = null;
    await unsubscribe().catch(() => {});
  };

  return {
    async subscribe(topic, handlers, onStatus) {
      topics.set(topic, { handlers, onStatus });
      try {
        await ensureSdkSubscription();
      } catch (err) {
        topics.delete(topic);
        throw err;
      }
      onStatus?.('SUBSCRIBED');
    },
    unsubscribe(topic) {
      return remove(topic);
    },
    setAuth(token) {
      pb.authStore.save(token, null);
    },
  };
}
