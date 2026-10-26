// The local player: PrototypeModal of the board app (src/components/prototypeplayer/PrototypeModal.tsx), with the page coming from this
// folder instead of the board's storage. The feedback toggle, composer, list, replay and replay bar are the app's own components —
// built from its source by build.mjs; only what needs the board (login, chat, storage) is replaced by ./stubs.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { sandboxDocument } from '@player/sandboxDocument'
import { feedbackHead, usePrototypeFeedback, FeedbackToggle, FeedbackPanel, ReplayBar } from '@player/feedback'
import { modalService } from './stubs/modalService'
import { modalComponentRegistry } from './stubs/modalRegistry'
import { fetchLocalPrototype, type PrototypeLoad } from './stubs/prototypeApi'
import { requestFetch, requestSync } from './stubs/chatSend'
import { phaseOf } from './stubs/useApplyStatus'
import { RebuildButton } from '@player/RebuildButton'
import '@player/feedback/FeedbackReplay' // registers the replay overlay

const SQUARE: React.CSSProperties = { margin: 0, width: 30, height: 30, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }

/** A button that records a control request (Sync, Fetch) and follows it through the control log: working while the agent does it, then done or failed. */
const RequestButton: React.FC<{ request: () => Promise<{ id: string } | null>; label: string; working: string; done: string; failed: string; icon: string; color: string; title: string; failedTitle: string }> = (p) => {
    const [run, setRun] = useState<{ id: string; phase: 'sent' | 'working' | 'done' | 'question' | 'expired' } | null>(null)
    const open = run?.phase === 'sent' || run?.phase === 'working'
    useEffect(() => {
        if (!open) return
        const t = setInterval(async () => {
            const list: { id: string; state: string }[] | null = await fetch('/api/control').then(r => r.json()).catch(() => null)
            const mine = list?.find(e => e.id === run!.id)
            if (mine) setRun(r => (r && r.id === mine.id ? { ...r, phase: phaseOf(mine.state) } : r))
        }, 2000)
        return () => clearInterval(t)
    }, [open, run?.id])
    useEffect(() => {
        if (!run || open) return
        const t = setTimeout(() => setRun(null), 15_000)
        return () => clearTimeout(t)
    }, [run, open])
    const bad = run?.phase === 'expired' || run?.phase === 'question'
    return (
        <button className="button is-small" disabled={open}
            style={{ margin: 0, height: 30, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, width: 'auto', fontWeight: 600, color: '#fff', background: bad ? '#ea580c' : p.color, borderColor: bad ? '#ea580c' : p.color, opacity: open ? 0.7 : 1 }}
            onClick={async () => { const sent = await p.request(); if (sent) setRun({ id: sent.id, phase: 'sent' }) }}
            title={open ? `${p.working}…` : bad ? p.failedTitle : p.title}>
            <i className={open ? 'fa-solid fa-spinner fa-spin' : bad ? 'fa-solid fa-triangle-exclamation' : run?.phase === 'done' ? 'fa-solid fa-check' : p.icon} />
            {open ? `${p.working}…` : bad ? p.failed : run?.phase === 'done' ? p.done : p.label}
        </button>
    )
}

const SyncButton: React.FC = () => (
    <RequestButton request={requestSync} label="Sync" working="Syncing" done="Synced" failed="Sync failed" icon="fa-solid fa-cloud-arrow-up" color="#2563eb"
        title="Sync: write every change that has not been synced yet to the board — the changes feedback was translated into first, in order, then the rest"
        failedTitle="The agent could not sync everything — see its note in the pill, or run /local-prototype-control" />
)

/** Fetch: records FetchRequested — the agent brings the board's latest slice definitions in (refused while there are unsynced local edits) and the page follows. */
const FetchButton: React.FC = () => (
    <RequestButton request={requestFetch} label="Fetch" working="Fetching" done="Fetched" failed="Fetch refused" icon="fa-solid fa-cloud-arrow-down" color="#0f766e"
        title="Fetch: take the board's latest slice definitions into the local model (never over local edits that are not synced yet)"
        failedTitle="Not fetched — the local model has edits that are not synced yet: Sync first" />
)

interface Question { id: string; question: string; options: string[] }
interface FeedbackDetail { id: string; type: string; root: string; state: string; note: string; comments: { id: string; comment: string; element: string; screen: string }[]; questions: Question[]; answers: { text: string; answer: string }[] }

const post = (type: string, data: unknown) => fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, data }) })

/** The modal behind the orange "Feedback needs you" pill: the open questions with their options to click, a field for an answer of your own, and Discard. */
const QuestionModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
    const [d, setD] = useState<FeedbackDetail | null>(null)
    const [picked, setPicked] = useState<Record<string, string>>({})
    const [typed, setTyped] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    useEffect(() => { void fetch(`/api/control/${id}`).then(r => r.json()).then(setD).catch(() => setD(null)) }, [id])
    const answerOf = (q: Question) => (typed[q.id] || '').trim() || picked[q.id] || ''
    // One answer is enough — a question left blank is left to the agent's judgment (or asked again), and an answer in the person's own words counts as much as an option.
    const ready = !!d && d.questions.some(q => answerOf(q))
    const send = async () => {
        if (!d || !ready) return
        setBusy(true)
        await post('FeedbackAnswered', { ref: d.root, answers: d.questions.filter(q => answerOf(q)).map(q => ({ question: q.id, text: q.question, answer: answerOf(q) })) })
        onClose()
    }
    const discard = async () => {
        if (!d) return
        setBusy(true)
        await post('FeedbackDiscarded', { ref: d.root })
        onClose()
    }
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
            <div role="dialog" aria-label="Feedback needs you" onClick={e => e.stopPropagation()}
                style={{ width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '2px solid #ea580c', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.35)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#ea580c' }}>
                    <i className="fa-solid fa-circle-question" />Feedback needs you
                    <button className="button is-small" style={{ margin: 0, marginLeft: 'auto', width: 30, height: 30, padding: 0 }} onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
                </div>
                {!d && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading…</p>}
                {d && d.comments.map(c => (
                    <div key={c.id} style={{ padding: '6px 10px', borderLeft: '4px solid #5b8def', background: 'rgba(91,141,239,.08)', borderRadius: 6, fontSize: 13 }}>
                        <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{c.comment}</div>
                        {(c.screen || c.element) && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[c.screen, c.element && `“${c.element.slice(0, 60)}”`].filter(Boolean).join(' · ')}</div>}
                    </div>
                ))}
                {d && d.questions.length === 0 && (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{d.note || 'The agent could not finish this feedback.'}</p>
                )}
                {d && d.questions.map(q => (
                    <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontWeight: 600 }}>{q.question}</div>
                        {q.options.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {q.options.map(o => (
                                    <button key={o} className="button is-small" onClick={() => { setPicked({ ...picked, [q.id]: o }); setTyped({ ...typed, [q.id]: '' }) }} aria-pressed={picked[q.id] === o && !typed[q.id]}
                                        style={{ margin: 0, height: 'auto', minHeight: 30, padding: '6px 10px', textAlign: 'left', whiteSpace: 'normal', justifyContent: 'flex-start', ...(picked[q.id] === o && !typed[q.id] ? { background: '#2563eb', borderColor: '#2563eb', color: '#fff' } : {}) }}>
                                        {o}
                                    </button>
                                ))}
                            </div>
                        )}
                        <input className="input is-small" placeholder={q.options.length ? 'Or answer in your own words' : 'Your answer'} value={typed[q.id] || ''} onChange={e => setTyped({ ...typed, [q.id]: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter' && ready) void send() }} />
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="button is-small" style={{ margin: 0, background: '#dc2626', borderColor: '#dc2626', color: '#fff', fontWeight: 600 }} disabled={busy || !d} onClick={() => void discard()}
                        title="Drop this feedback: its changes that were not executed yet are removed">
                        <i className="fa-solid fa-trash" style={{ marginRight: 6 }} />Discard
                    </button>
                    <span style={{ flex: 1 }} />
                    <button className="button is-small" style={{ margin: 0 }} onClick={onClose}>Close</button>
                    {d && d.questions.length > 0 && (
                        <button className="button is-small is-primary" style={{ margin: 0, fontWeight: 600 }} disabled={!ready || busy} onClick={() => void send()}>
                            <i className="fa-solid fa-paper-plane" style={{ marginRight: 6 }} />Send answer
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

/** Where the feedback given in this session stands (the control log's latest feedback request): recorded, applying, done — or, orange, needing an answer: click it. */
const FeedbackStatus: React.FC = () => {
    const [since] = useState(() => Date.now())
    const [item, setItem] = useState<{ id: string; state: string; note: string } | null>(null)
    const [hidden, setHidden] = useState<string | null>(null)
    const [asking, setAsking] = useState(false)
    useEffect(() => {
        const t = setInterval(async () => {
            const list: { id: string; type: string; at: string; state: string; note: string }[] | null = await fetch('/api/control').then(r => r.json()).catch(() => null)
            const mine = (list || []).filter(e => (e.type === 'FeedbackRecorded' || e.type === 'FeedbackAnswered') && Date.parse(e.at) >= since - 5000).pop()
            setItem(mine ? { id: mine.id, state: mine.state, note: mine.note } : null)
        }, 2000)
        return () => clearInterval(t)
    }, [since])
    if (!item || item.state === 'discarded' || hidden === item.id) return null
    const needsYou = item.state === 'needs-you'
    const look = item.state === 'applied' ? { bg: '#16a34a', icon: 'fa-solid fa-circle-check', text: 'Feedback applied' }
        : needsYou ? { bg: '#ea580c', icon: 'fa-solid fa-circle-question', text: 'Feedback needs you' }
        : item.state === 'failed' ? { bg: '#d97706', icon: 'fa-solid fa-triangle-exclamation', text: 'Feedback could not be applied' }
        : item.state === 'working' ? { bg: '#2563eb', icon: 'fa-solid fa-spinner fa-spin', text: item.note ? `Applying feedback… ${item.note}` : 'Applying feedback…' }
        : { bg: '#64748b', icon: 'fa-solid fa-spinner fa-spin', text: 'Feedback recorded — the agent picks it up' }
    const done = item.state === 'applied' || needsYou || item.state === 'failed'
    return (
        <>
            <span role={needsYou ? 'button' : 'status'} tabIndex={needsYou ? 0 : undefined} onClick={needsYou ? () => setAsking(true) : undefined}
                onKeyDown={needsYou ? e => { if (e.key === 'Enter' || e.key === ' ') setAsking(true) } : undefined}
                title={needsYou ? 'Click to answer the agent\'s questions, or discard this feedback' : item.note || undefined}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 6, background: look.bg, color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: needsYou ? 'pointer' : undefined }}>
                <i className={look.icon} />{look.text}
                {done && <button onClick={e => { e.stopPropagation(); setHidden(item.id) }} aria-label="Hide" style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0, marginLeft: 2 }}>×</button>}
            </span>
            {asking && <QuestionModal id={item.id} onClose={() => setAsking(false)} />}
        </>
    )
}

/** When the server behind the page stops (the run was ended, it crashed) the page would just go blank: say so, and reload once it is back. */
const ServerWatch: React.FC = () => {
    const [down, setDown] = useState(false)
    const wasDown = useRef(false)
    const misses = useRef(0)
    useEffect(() => {
        const t = setInterval(async () => {
            const ok = await fetch('/api/context', { cache: 'no-store' }).then(r => r.ok).catch(() => false)
            if (ok) { misses.current = 0; if (wasDown.current) location.reload(); setDown(false) }
            else if (++misses.current >= 2) { wasDown.current = true; setDown(true) }
        }, 2000)
        return () => clearInterval(t)
    }, [])
    if (!down) return null
    return (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#b91c1c', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fa-solid fa-plug-circle-xmark" />The prototype server stopped. Start it again with <code style={{ background: 'rgba(0,0,0,.25)', padding: '0 6px', borderRadius: 4 }}>eventmodelers run --prototype</code> — this page reloads by itself when it is back.
        </div>
    )
}

const LocalPlayer: React.FC = () => {
    const [load, setLoad] = useState<PrototypeLoad | null>(null)
    const [run, setRun] = useState(0)
    const [frameReady, setFrameReady] = useState(false)
    const [studio, setStudio] = useState<string | null>(null)
    useEffect(() => { void fetch('/api/context').then(r => r.json()).then(c => setStudio(c.studio || null)).catch(() => setStudio(null)) }, [])
    const frame = useRef<HTMLIFrameElement>(null)
    const html = load?.kind === 'found' ? load.html : undefined
    const name = (load && 'contextName' in load && load.contextName) || 'Prototype'
    const reloadRef = useRef<() => void>(() => {})
    const feedback = usePrototypeFeedback(frame, { timelineId: 'local', title: name, html, boardId: 'local', name, onRebuilt: () => reloadRef.current() })

    const reload = useCallback(() => { setFrameReady(false); setRun(r => r + 1) }, [])
    reloadRef.current = reload
    useEffect(() => { void fetchLocalPrototype().then(setLoad) }, [run])
    useEffect(() => { document.title = `Prototype · ${name}` }, [name])

    // A rebuild (the page changed on disk) or a finished feedback reloads the page, like the board's player does when the agent rebuilt it.
    useEffect(() => {
        const source = new EventSource('/__reload')
        source.onmessage = () => reload()
        window.addEventListener('proto-local-reload', reload)
        return () => { source.close(); window.removeEventListener('proto-local-reload', reload) }
    }, [reload])

    // The replay opens as an overlay (the board opens it as a modal).
    const [modal, setModal] = useState<{ path: string; props: any } | null>(null)
    useEffect(() => modalService.subscribe(setModal), [])
    const Modal = modal ? modalComponentRegistry.get(modal.path) : null

    const copyLink = () => { void navigator.clipboard.writeText(window.location.href) }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', minHeight: '70vh', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                <i className="fas fa-circle-play" style={{ color: '#22c55e' }} />
                <span>Prototype · <strong style={{ color: 'var(--text-primary)' }}>{name}</strong></span>
                {load?.kind === 'found' && (
                    <button onClick={reload} title="Restart: load the latest version and start over with an empty event log" aria-label="Restart"
                        style={{ background: 'none', border: 'none', padding: '4px', cursor: 'pointer', color: 'inherit', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
                        <i className="fas fa-rotate-right" />
                    </button>
                )}
                {studio && (
                    <a className="button is-small" href={studio} target="_blank" rel="noopener noreferrer" style={{ margin: 0, height: 24, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--text-primary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }}
                        title="Open this board in EM Studio on eventmodelers.ai"><i className="fa-solid fa-arrow-up-right-from-square" />Jump to Board</a>
                )}
                <button className="button is-small" style={{ margin: 0, height: 24, width: 28, padding: 0 }} onClick={copyLink} title="Copy the link to this prototype" aria-label="Copy link"><i className="fa-solid fa-link" /></button>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {load?.kind === 'found' && <FeedbackStatus />}
                    {load?.kind === 'found' && <RebuildButton feedback={feedback} />}
                    {load?.kind === 'found' && <FetchButton />}
                    {load?.kind === 'found' && <SyncButton />}
                    {load?.kind === 'found' && (
                        <button className="button is-small" style={SQUARE} onClick={reload} title="Reload: fetch the latest version" aria-label="Reload"><i className="fa-solid fa-arrows-rotate" /></button>
                    )}
                    {load?.kind === 'found' && <FeedbackToggle feedback={feedback} style={{ margin: 0 }} />}
                </span>
            </div>

            <ServerWatch />
            {!load && <Spinner />}
            {load?.kind === 'missing' && (
                <div style={{ padding: '24px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <p><strong>No prototype has been built for {name} yet.</strong></p>
                    <p>Run <code>/local-prototype</code> in Claude Code in this folder — it appears here as soon as it is built.</p>
                </div>
            )}
            {load?.kind === 'failed' && <p style={{ padding: '24px', color: 'var(--text-secondary)' }}>The prototype could not be loaded. <button className="button is-small" onClick={reload}>Try again</button></p>}

            {load?.kind === 'found' && (
                <div style={{ position: 'relative', flex: 1, display: 'flex', minHeight: 0 }}>
                    <iframe ref={frame} key={run} title={`Prototype of ${name}`} sandbox="allow-scripts"
                        srcDoc={sandboxDocument(load.html, window.location.origin, feedbackHead())}
                        onLoad={() => setTimeout(() => setFrameReady(true), 500)}
                        style={{ flex: 1, width: '100%', minHeight: 0, border: '1px solid var(--border-default)', borderRadius: '8px', background: '#fff' }} />
                    <FeedbackPanel feedback={feedback} />
                    {!frameReady && (
                        <div style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: '8px', border: '1px solid var(--border-default)' }}><Spinner /></div>
                    )}
                </div>
            )}
            {load?.kind === 'found' && <ReplayBar key={run} frame={frame} />}

            {Modal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-canvas)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Feedback replay
                        <button className="button is-small" style={{ ...SQUARE, marginLeft: 'auto' }} onClick={() => modalService.closeModal()} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
                    </div>
                    <Modal {...modal!.props} />
                </div>
            )}
        </div>
    )
}

const Spinner: React.FC = () => (
    <div role="status" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', height: '100%', padding: '24px', color: 'var(--text-secondary)' }}>
        <i className="fas fa-circle-notch fa-spin" style={{ fontSize: '22px' }} />
        <span>Loading the prototype…</span>
    </div>
)

createRoot(document.getElementById('root')!).render(<div style={{ minHeight: '100vh', padding: 12, boxSizing: 'border-box', background: 'var(--bg-canvas)', display: 'flex', flexDirection: 'column' }}><LocalPlayer /></div>)
