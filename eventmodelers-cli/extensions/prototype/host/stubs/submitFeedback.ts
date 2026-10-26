type Submission = { name: string; events: unknown[]; feedbacks: unknown[] }
export type SubmitOutcome = { ok: true; id: string } | { ok: false; problems: string[] }

/** Submit hands the feedback to the agent: it records FeedbackRecorded, which the next iteration translates into changes. */
export async function submitPrototypeFeedback(_org: unknown, _board: unknown, _timeline: unknown, submission: Submission): Promise<SubmitOutcome> {
    const res = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'FeedbackRecorded', data: submission }) })
    if (!res.ok) return { ok: false, problems: [(await res.json().catch(() => ({ error: 'Could not store the feedback' }))).error] }
    return { ok: true, id: String((await res.json()).id) }
}
