// Supabase realtime adapter — the hosted-SaaS transport. Subscribes to a private
// broadcast channel and dispatches named broadcast events to caller-supplied handlers.
// See realtime-adapter.js for the interface both this and the PocketBase adapter implement.

export async function createSupabaseRealtimeAdapter(cfg, initialToken) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { apikey: cfg.supabaseAnonKey } },
  });
  await supabase.realtime.setAuth(initialToken);

  return {
    async subscribe(topic, handlers, onStatus) {
      let channel = supabase.channel(topic, { config: { private: true } });
      for (const [event, handler] of Object.entries(handlers)) {
        channel = channel.on('broadcast', { event }, (msg) => handler(msg.payload));
      }
      channel.subscribe((status) => onStatus?.(status));
    },
    setAuth(token) {
      return supabase.realtime.setAuth(token);
    },
  };
}
