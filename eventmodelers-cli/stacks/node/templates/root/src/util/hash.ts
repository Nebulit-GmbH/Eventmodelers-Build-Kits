// Fast djb2-style hash of any object — used to detect drift
export function hashMeta(entry: unknown): string {
    const str = JSON.stringify(entry);
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}