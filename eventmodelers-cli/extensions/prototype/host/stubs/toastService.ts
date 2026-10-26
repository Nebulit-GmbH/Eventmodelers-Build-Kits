// Local stand-in for the board's toasts: one small message at the bottom, like the app's.
let el: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout>
export const toastService = {
    show(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000): void {
        // Submit records an event for the agent; the toast says so.
        if (message.startsWith('Gave the feedback to the agent')) message = 'Feedback recorded — the agent applies it (or run /local-prototype-control)'
        if (!el) {
            el = document.createElement('div')
            el.setAttribute('role', 'status')
            Object.assign(el.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: '100000', padding: '10px 16px', borderRadius: '8px', color: '#fff', fontSize: '13px', boxShadow: '0 8px 24px rgba(0,0,0,.25)' })
            document.body.appendChild(el)
        }
        el.textContent = message
        el.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#334155'
        el.style.display = 'block'
        clearTimeout(timer)
        timer = setTimeout(() => { if (el) el.style.display = 'none' }, Math.max(duration, 2500))
    },
}
