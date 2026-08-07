// PocketBase realtime adapter — the self-hosted/on-prem transport. PocketBase has no
// generic pub/sub broadcast API; realtime only fires on record create/update/delete
// within a subscribed collection, so the backend piggybacks broadcasts onto a
// `realtime_events` collection (topic/event/payload fields) and this adapter filters
// that collection's create-stream down to the requested topic. See realtime-adapter.js
// for the interface both this and the Supabase adapter implement.

const REALTIME_EVENTS_COLLECTION = 'realtime_events';

export async function createPocketBaseRealtimeAdapter(cfg, initialToken) {
  const { EventSource } = await import('eventsource');
  if (!globalThis.EventSource) globalThis.EventSource = EventSource; // PocketBase's SDK assumes a browser-style global
  const { default: PocketBase } = await import('pocketbase');
  const pb = new PocketBase(cfg.pocketbaseUrl);
  pb.authStore.save(initialToken, null);

  return {
    async subscribe(topic, handlers, onStatus) {
      await pb.collection(REALTIME_EVENTS_COLLECTION).subscribe('*', (e) => {
        if (e.action !== 'create' || e.record.topic !== topic) return;
        handlers[e.record.event]?.(e.record.payload);
      });
      onStatus?.('SUBSCRIBED');
    },
    setAuth(token) {
      pb.authStore.save(token, null);
    },
  };
}
