const url = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`;
const key = process.env.SUPABASE_SECRET_KEY!;

export async function broadcastRealtime(topic: string, event: string, payload: unknown, privateChannel = true): Promise<void> {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
            'apikey': key,
        },
        body: JSON.stringify({
            messages: [{ topic, event, payload, private: privateChannel }],
        }),
    });
    if (!res.ok) {
        throw new Error(`realtime broadcast failed: ${res.status} ${await res.text()}`);
    }
}
