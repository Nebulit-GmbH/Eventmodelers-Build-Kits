import {describe, it} from 'node:test';
import assert from 'node:assert';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import express from 'express';
import {isModeledEndpoint, notImplemented} from './notImplemented';
import {MODELED_ENDPOINTS} from './modeledEndpoints';

const slicesRoot = join(__dirname, '../slices');

const routeFiles = (dir: string): string[] =>
    !existsSync(dir) ? [] : readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return routeFiles(full);
        return /^routes(-.*)?\.ts$/.test(name) ? [full] : [];
    });

// A concrete request path for a modeled entry: `:param` -> x, and a command gets an id segment.
const samplePath = (entry: string) => {
    const [method, path] = entry.split(' ');
    return {method, url: `/api/${path.replace(/:[A-Za-z]+/g, 'x')}${method === 'POST' ? '/x' : ''}`};
};

describe('notImplemented fallback', () => {
    it('every real route is on the modeled list (guards the naming convention)', () => {
        const missing: string[] = [];
        for (const file of routeFiles(slicesRoot)) {
            const source = readFileSync(file, 'utf8');
            for (const m of source.matchAll(/router\.(get|post)\(\s*['"`]([^'"`]+)['"`]/g)) {
                const method = m[1].toUpperCase();
                const path = m[2].replace(/:[A-Za-z]+/g, 'x');
                if (!isModeledEndpoint(method, path)) missing.push(`${method} ${m[2]} (${file})`);
            }
        }
        assert.deepStrictEqual(missing, [], 'add these to src/common/extraEndpoints.ts, or rename the route to the kit convention');
    });

    it('answers 501 for a modeled endpoint with no handler, lets a real route win, leaves other paths 404', async () => {
        const app = express();
        const [first, second] = MODELED_ENDPOINTS.map(samplePath);
        if (first) app.all(first.url, (_req, res) => res.json({real: true})); // a "real" route registered first wins
        app.use(notImplemented);
        const server = app.listen(0);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        try {
            if (first) assert.equal((await fetch(base + first.url, {method: first.method})).status, 200);
            if (second) {
                const unbuilt = await fetch(base + second.url, {method: second.method});
                assert.equal(unbuilt.status, 501);
                assert.equal(((await unbuilt.json()) as {code: string}).code, 'not_implemented');
            }
            assert.equal((await fetch(`${base}/api/not-modeled-${Date.now()}`)).status, 404);
        } finally {
            server.close();
        }
    });
});
