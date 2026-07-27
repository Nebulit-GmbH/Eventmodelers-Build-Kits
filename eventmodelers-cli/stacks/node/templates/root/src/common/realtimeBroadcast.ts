const clients = new Set<(event: string, payload: unknown) => void>();

export function subscribeRealtime(handler: (event: string, payload: unknown) => void): () => void {
    clients.add(handler);
    return () => clients.delete(handler);
}

export async function broadcastRealtime(topic: string, event: string, payload: unknown): Promise<void> {
    for (const handler of clients) {
        handler(event, payload);
    }
}
