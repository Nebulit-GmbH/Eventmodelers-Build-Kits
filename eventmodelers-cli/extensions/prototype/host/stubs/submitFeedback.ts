type Submission = { name: string; events: unknown[]; feedbacks: unknown[] }
export type SubmitOutcome = { ok: true; id: string } | { ok: false; problems: string[] }

/** Submit files the named set of feedback on the platform, as the board's own player does — through this folder's server (`POST /api/feedback`), which holds the credentials. */
export async function submitPrototypeFeedback(_org: unknown, _board: unknown, _timeline: unknown, submission: Submission): Promise<SubmitOutcome> {
    try {
        const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission) })
        const body = await res.json().catch(() => null)
        if (body && body.ok === true) return { ok: true, id: String(body.id ?? '') }
        const problems = body && Array.isArray(body.problems) ? body.problems.filter((p: unknown): p is string => typeof p === 'string') : []
        return { ok: false, problems: problems.length ? problems : ['Could not submit the feedback.'] }
    } catch {
        return { ok: false, problems: ['The prototype server could not be reached — is `eventmodelers run --prototype` still running?'] }
    }
}
