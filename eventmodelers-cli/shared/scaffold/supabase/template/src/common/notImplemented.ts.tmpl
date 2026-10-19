import type {NextFunction, Request, RequestHandler, Response} from 'express';
import {MODELED_ENDPOINTS} from './modeledEndpoints';
import {EXTRA_ENDPOINTS} from './extraEndpoints';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `:param` segments match any single path segment
const toPathRegex = (path: string) =>
    path.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : escape(seg))).join('/');

// POST /api/<name> or /api/<name>/<one segment>; GET /api/query/<name>-collection (or a listed GET path)
const patterns = [...MODELED_ENDPOINTS, ...EXTRA_ENDPOINTS].map((entry) => {
    const [method, path] = entry.split(' ');
    const re = method === 'POST'
        ? new RegExp(`^/api/${toPathRegex(path)}(/[^/]+)?/?$`)
        : new RegExp(`^/api/${toPathRegex(path)}/?$`);
    return {method, re};
});

export const isModeledEndpoint = (method: string, path: string): boolean =>
    patterns.some((p) => p.method === method.toUpperCase() && p.re.test(path));

// Registered AFTER every real route: a modeled endpoint with no handler yet answers 501 Not Implemented
// (so "not built" is distinguishable from a wrong URL, which stays 404). Once a slice is built, its real
// route matches first and this never runs for it.
export const notImplemented: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent || !isModeledEndpoint(req.method, req.path)) return next();
    return res.status(501).json({ok: false, code: 'not_implemented', error: 'This feature is not built yet.'});
};
