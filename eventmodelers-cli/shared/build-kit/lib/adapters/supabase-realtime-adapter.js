// Supabase realtime adapter — the hosted-SaaS transport. Subscribes to a private
// broadcast channel and dispatches named broadcast events to caller-supplied handlers.
// See realtime-adapter.js for the interface both this and the PocketBase adapter implement.

export async function createSupabaseRealtimeAdapter(cfg, initialToken) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { apikey: cfg.supabaseAnonKey } },
  });
  await supabase.realtime.setAuth(initialToken);

  // A resubscribe must replace the channel, not add to it: supabase.channel(topic) hands back
  // the existing channel for a topic it already knows, so every retry used to stack another
  // set of broadcast handlers onto it — after N reconnects each slice:changed ran N+1 times.
  let current = null;

  return {
    async subscribe(topic, handlers, onStatus) {
      if (current) await supabase.removeChannel(current).catch(() => {});
      let channel = supabase.channel(topic, { config: { private: true } });
      for (const [event, handler] of Object.entries(handlers)) {
        channel = channel.on('broadcast', { event }, (msg) => handler(msg.payload));
      }
      current = channel;
      // Once removed, the old channel reports CLOSED — only the current one speaks for the subscription.
      channel.subscribe((status) => { if (channel === current) onStatus?.(status); });
    },
    setAuth(token) {
      return supabase.realtime.setAuth(token);
    },
  };
}
