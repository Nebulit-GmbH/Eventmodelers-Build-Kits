import { parseItems, type FeedbackItem } from '@player/feedback/feedbackModel'
// Locally a saved feedback is recorded at once, as a FeedbackRecorded event in the control log (.prototype/events/): the agent translates it into
// changes and applies them, and the prototype is rebuilt. The items themselves live in memory for the session — the list is history, nothing is
// left behind in the browser; deleting one here removes it from the list only.
const memory = new Map<string, string>()

export function loadFeedback(key: string): FeedbackItem[] {
    return parseItems(memory.get(key) ?? null)
}

export function saveFeedback(key: string, items: FeedbackItem[]): boolean {
    const known = new Set(loadFeedback(key).map(i => i.id))
    memory.set(key, JSON.stringify(items))
    for (const item of items.filter(i => !known.has(i.id))) {
        void fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'FeedbackRecorded', data: { name: document.title.replace(/^Prototype · /, ''), events: item.trail?.events ?? [], feedbacks: [item] } }) })
    }
    return true
}
