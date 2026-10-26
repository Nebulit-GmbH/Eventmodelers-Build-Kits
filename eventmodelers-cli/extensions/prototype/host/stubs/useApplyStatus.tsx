import React, { useEffect, useState } from 'react'
export type ApplyPhase = 'sent' | 'working' | 'question' | 'done' | 'expired'
export interface ApplyRun { messageId: string; sessionId: string; since: number; phase: ApplyPhase; kind: 'apply' | 'rebuild' }

const POLL_MS = 2000

/** What the control log says about a request: open (sent), claimed (working), or processed — applied (done), needs-you (question), failed (expired). */
export const phaseOf = (state: string): ApplyPhase => state === 'applied' ? 'done' : state === 'needs-you' ? 'question' : state === 'failed' ? 'expired' : state === 'working' ? 'working' : 'sent'

/** Follows an Apply or a Rebuild through the control log until the agent has processed it. */
export function useApplyStatus(_boardId: string | null) {
    const [run, setRun] = useState<ApplyRun | null>(null)
    const following = run && (run.phase === 'sent' || run.phase === 'working') ? run.messageId : null
    useEffect(() => {
        if (!following) return
        const t = setInterval(async () => {
            const list: { id: string; state: string }[] | null = await fetch('/api/control').then(r => r.json()).catch(() => null)
            const mine = list?.find(e => e.id === following)
            if (mine) setRun(r => (r && r.messageId === following ? { ...r, phase: phaseOf(mine.state) } : r))
        }, POLL_MS)
        return () => clearInterval(t)
    }, [following])
    useEffect(() => {
        if (run?.phase !== 'done') return
        const t = setTimeout(() => setRun(null), 30_000)
        return () => clearTimeout(t)
    }, [run?.phase])
    return { run, start: (message: { id: string; sessionId: string }, kind: ApplyRun['kind'] = 'apply') => setRun({ messageId: message.id, sessionId: message.sessionId, since: Date.now(), phase: 'sent', kind }), dismiss: () => setRun(null) }
}

/** The pill beside the header buttons, as on the board: recorded and waiting, working, done, or a question for the person. */
export const ApplyStatusPill: React.FC<{ run: ApplyRun | null; onDismiss: () => void; onRebuild?: () => void; style?: React.CSSProperties }> = ({ run, onDismiss, onRebuild, style }) => {
    if (!run || run.kind === 'rebuild') return null
    const look = run.phase === 'question' ? { bg: '#ea580c', icon: 'fa-solid fa-circle-question', text: 'Agent has a question — run /local-prototype-control' }
        : run.phase === 'done' ? { bg: '#16a34a', icon: 'fa-solid fa-circle-check', text: 'Agent is done' }
        : run.phase === 'expired' ? { bg: '#d97706', icon: 'fa-solid fa-triangle-exclamation', text: 'The agent could not apply it' }
        : run.phase === 'working' ? { bg: '#2563eb', icon: 'fa-solid fa-spinner fa-spin', text: 'Agent is working…' }
        : { bg: '#64748b', icon: 'fa-solid fa-spinner fa-spin', text: 'Recorded — the agent picks it up (or run /local-prototype-control)' }
    const clickable = run.phase === 'done' && !!onRebuild
    return (
        <span role={clickable ? 'button' : 'status'} tabIndex={clickable ? 0 : undefined} onClick={clickable ? onRebuild : undefined}
            title={clickable ? 'Reload the prototype with the changes the agent made' : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 6, background: look.bg, color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: clickable ? 'pointer' : undefined, ...style }}>
            <i className={look.icon} />{look.text}{clickable && <i className="fa-solid fa-arrows-rotate" style={{ marginLeft: 2, opacity: 0.85 }} />}
            <button onClick={e => { e.stopPropagation(); onDismiss() }} aria-label="Hide" style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0, marginLeft: 2 }}>×</button>
        </span>
    )
}
