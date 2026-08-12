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

export async function createPocketBaseRealtimeAdapter(cfg, initialToken) {
  const { EventSource } = await import('eventsource');
  if (!globalThis.EventSource) globalThis.EventSource = EventSource; // PocketBase's SDK assumes a browser-style global
  const { default: PocketBase } = await import('pocketbase');
  const pb = new PocketBase(cfg.pocketbaseUrl);
  pb.authStore.save(initialToken, null);

  return {
    async subscribe(topic, handlers, onStatus) {
      for (let attempt = 0; ; attempt++) {
        try {
          await pb.collection(REALTIME_EVENTS_COLLECTION).subscribe('*', (e) => {
            if (e.action !== 'create' || e.record.topic !== topic) return;
            handlers[e.record.event]?.(e.record.payload);
          });
          onStatus?.('SUBSCRIBED');
          return;
        } catch (err) {
          if (attempt >= RECONNECT_INTERVALS_MS.length) throw err;
          onStatus?.(`RECONNECTING (attempt ${attempt + 1}/${RECONNECT_INTERVALS_MS.length}): ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_INTERVALS_MS[attempt]));
        }
      }
    },
    setAuth(token) {
      pb.authStore.save(token, null);
    },
  };
}
