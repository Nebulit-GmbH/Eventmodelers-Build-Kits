// What the player sends the board's chat agent, recorded as events in the control log (.prototype/events/) instead — the agent reads
// them on its next iteration and records what it processed (see control.js):
//  /local-apply-feedback … → FeedbackRecorded (the attached json: name, events, feedbacks)
//  /prototype …      → RebuildRequested
async function record(type: string, data: unknown): Promise<{ id: string; sessionId: string } | null> {
    const res = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, data }) })
    if (!res.ok) return null
    return { id: String((await res.json()).id), sessionId: 'local' }
}

export async function sendToChat(text: string, _kind?: string, _timelineId?: string, _x?: unknown, attachments?: { file: File }[]): Promise<{ id: string; sessionId: string } | null> {
    if (text.startsWith('/local-apply-feedback')) {
        const file = attachments?.[0]?.file
        return file ? record('FeedbackRecorded', JSON.parse(await file.text())) : null
    }
    if (text.startsWith('/prototype')) return record('RebuildRequested', {})
    return null
}
export const hasChatAgent = (): boolean => true
export const requestSync = (): Promise<{ id: string; sessionId: string } | null> => record('SyncRequested', {})
export const requestFetch = (): Promise<{ id: string; sessionId: string } | null> => record('FetchRequested', {})
