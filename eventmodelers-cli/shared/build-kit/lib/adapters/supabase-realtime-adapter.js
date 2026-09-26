// Supabase realtime adapter — the hosted-SaaS transport. Subscribes to a private
// broadcast channel and dispatches named broadcast events to caller-supplied handlers.
// See realtime-adapter.js for the interface both this and the PocketBase adapter implement.

// deps.createClient is injectable for tests; by default it is supabase-js's own.
export async function createSupabaseRealtimeAdapter(cfg, initialToken, deps = {}) {
  const createClient = deps.createClient ?? (await import('@supabase/supabase-js')).createClient;
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { apikey: cfg.supabaseAnonKey } },
  });
  await supabase.realtime.setAuth(initialToken);

  // supabase.channel(topic) hands back the existing channel for a topic it already knows, so
  // re-subscribing on it would stack another set of handlers — the old channel is removed first.
  let current = null;

  return {
    async subscribe(topic, handlers, onStatus) {
      // Detach before removing: the removal itself makes the old channel report CLOSED, and a
      // late status from a replaced channel must not count as this subscription's.
      const previous = current;
      current = null;
      if (previous) await supabase.removeChannel(previous).catch(() => {});
      let channel = supabase.channel(topic, { config: { private: true } });
      for (const [event, handler] of Object.entries(handlers)) {
        channel = channel.on('broadcast', { event }, (msg) => handler(msg.payload));
      }
      current = channel;
      channel.subscribe((status) => { if (channel === current) onStatus?.(status); });
    },
    setAuth(token) {
      return supabase.realtime.setAuth(token);
    },
  };
}
