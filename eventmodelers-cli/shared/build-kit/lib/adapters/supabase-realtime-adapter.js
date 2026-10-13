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

  // One live channel per topic. supabase.channel(topic) hands back the existing channel for a
  // topic it already knows, so re-subscribing on it would stack another set of handlers — the
  // old channel is removed first.
  const channels = new Map();
  const remove = async (topic) => {
    const channel = channels.get(topic);
    if (!channel) return;
    // Detach before removing: the removal itself makes the old channel report CLOSED, and a
    // late status from a removed channel must not count as the topic's current subscription's.
    channels.delete(topic);
    await supabase.removeChannel(channel).catch(() => {});
  };

  return {
    async subscribe(topic, handlers, onStatus) {
      await remove(topic);
      let channel = supabase.channel(topic, { config: { private: true } });
      for (const [event, handler] of Object.entries(handlers)) {
        channel = channel.on('broadcast', { event }, (msg) => handler(msg.payload));
      }
      channels.set(topic, channel);
      channel.subscribe((status) => { if (channels.get(topic) === channel) onStatus?.(status); });
    },
    // Also stops realtime-js's own rejoin loop for an errored channel.
    unsubscribe(topic) {
      return remove(topic);
    },
    setAuth(token) {
      return supabase.realtime.setAuth(token);
    },
  };
}
