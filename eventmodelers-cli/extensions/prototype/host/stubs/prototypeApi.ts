// The prototype is the local page, not one stored on the board.
export type PrototypeLoad =
    | { kind: 'found', html: string, contextName: string }
    | { kind: 'missing', contextName?: string }
    | { kind: 'signed-out' }
    | { kind: 'failed' }

export async function fetchLocalPrototype(): Promise<PrototypeLoad> {
    try {
        const [page, ctx] = await Promise.all([fetch('/page.html', { cache: 'no-store' }), fetch('/api/context').then(r => r.json()).catch(() => ({}))])
        if (page.status === 404) return { kind: 'missing', contextName: ctx.name }
        if (!page.ok) return { kind: 'failed' }
        return { kind: 'found', html: await page.text(), contextName: ctx.name || '' }
    } catch { return { kind: 'failed' } }
}
export const fetchPrototype = (): Promise<PrototypeLoad> => fetchLocalPrototype()
