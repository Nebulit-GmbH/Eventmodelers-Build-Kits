function sanitizeValue(value: unknown): unknown {
    if (typeof value === 'bigint') {
        return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, sanitizeValue(v)])
        );
    }
    return value;
}

export function sanitize<T>(value: T): unknown {
    return sanitizeValue(value);
}

export const jsonBigIntReplacer = (_key: string, value: unknown): unknown =>
    typeof value === 'bigint'
        ? (Number.isSafeInteger(Number(value)) ? Number(value) : value.toString())
        : value;
