// The local player: PrototypeModal of the board app (src/components/prototypeplayer/PrototypeModal.tsx), with the page coming from this
// folder instead of the board's storage. The feedback toggle, composer, list, replay and replay bar are the app's own components —
// built from its source by build.mjs; only what needs the board (login, chat, the modal service) is replaced by ./stubs. Submit files the feedback
// on the platform through this folder's server (stubs/submitFeedback.ts); the platform's /apply-feedback applies it.
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
import { usePrototypeRebuild } from '@player/usePrototypeRebuild'
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
        title="Sync: write every local model change that has not been synced yet to the board"
        failedTitle="The agent could not sync everything — see its note in the pill, or run /local-prototype-control" />
)

/** Fetch: records FetchRequested — the agent brings the board's latest slice definitions in (refused while there are unsynced local edits) and the page follows. */
const FetchButton: React.FC = () => (
    <RequestButton request={requestFetch} label="Fetch" working="Fetching" done="Fetched" failed="Fetch refused" icon="fa-solid fa-cloud-arrow-down" color="#0f766e"
        title="Fetch: take the board's latest slice definitions into the local model (never over local edits that are not synced yet)"
        failedTitle="Not fetched — the local model has edits that are not synced yet: Sync first" />
)

/** What this run does by itself: whether an agent is connected (answers Sync, Fetch, Rebuild) and whether changes go to the board on their own (--sync). */
const RunStatus: React.FC = () => {
    const [st, setSt] = useState<{ sync: boolean; agent: boolean; busy: boolean } | null>(null)
    useEffect(() => {
        const read = () => fetch('/api/status', { cache: 'no-store' }).then(r => r.json()).then(setSt).catch(() => setSt(null))
        void read()
        const t = setInterval(read, 3000)
        return () => clearInterval(t)
    }, [])
    if (!st) return null
    const pill = (on: boolean, icon: string, text: string, title: string) => (
        <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: on ? '#16a34a' : '#64748b', color: '#fff' }}>
            <i className={icon} />{text}
        </span>
    )
    return (<>
        {pill(st.agent, st.busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-robot', st.agent ? (st.busy ? 'Agent working' : 'Agent connected') : 'No agent',
            st.agent ? 'An agent is connected: it answers Sync, Fetch and Rebuild' : 'No agent is connected — start with `eventmodelers run --prototype` so Sync, Fetch and Rebuild are answered')}
        {pill(st.sync, 'fa-solid fa-cloud-arrow-up', st.sync ? 'Auto-sync on' : 'Auto-sync off',
            st.sync ? 'Changes are written to the board automatically (--sync)' : 'Changes stay local until Sync — start with --sync to write them to the board automatically')}
    </>)
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
    const feedback = usePrototypeFeedback(frame, { timelineId: 'local', title: name, html, boardId: 'local' })
    const agentRebuild = usePrototypeRebuild({ timelineId: 'local', title: name, boardId: 'local', name, onRebuilt: () => reloadRef.current() })

    const reload = useCallback(() => { setFrameReady(false); setRun(r => r + 1) }, [])
    reloadRef.current = reload
    useEffect(() => { void fetchLocalPrototype().then(setLoad) }, [run])
    useEffect(() => { document.title = `Prototype · ${name}` }, [name])

    // A rebuild (the page changed on disk) reloads the page, like the board's player does when the agent rebuilt it.
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
                {load?.kind === 'found' && (
                    <a className="button is-small" href="/walkthrough" target="_blank" rel="noopener noreferrer" style={{ margin: 0, height: 24, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--text-primary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }}
                        title="Everything that is only local, slice by slice"><i className="fa-solid fa-route" />Walk me through it</a>
                )}
                <button className="button is-small" style={{ margin: 0, height: 24, width: 28, padding: 0 }} onClick={copyLink} title="Copy the link to this prototype" aria-label="Copy link"><i className="fa-solid fa-link" /></button>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <RunStatus />
                    {load?.kind === 'found' && <RebuildButton rebuild={agentRebuild} />}
                    {load?.kind === 'found' && <FetchButton />}
                    {load?.kind === 'found' && <SyncButton />}
                    {load?.kind === 'found' && (
                        <button className="button is-small" style={SQUARE} onClick={reload} title="Reload: fetch the latest version" aria-label="Reload"><i className="fa-solid fa-arrows-rotate" /></button>
                    )}
                    {load?.kind === 'found' && <FeedbackToggle feedback={feedback} style={{ margin: 0 }} onRebuild={() => void agentRebuild.rebuild()} />}
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
