// Local stand-in for the board's modal service: the replay opens as an overlay the local player renders itself.
type Listener = (open: { path: string; props: any } | null) => void
const listeners = new Set<Listener>()
export const modalService = {
    openModal(path: string, props: any, _wide?: boolean): Promise<void> { listeners.forEach(l => l({ path, props })); return Promise.resolve() },
    closeModal(): void { listeners.forEach(l => l(null)) },
    subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l) } },
}
