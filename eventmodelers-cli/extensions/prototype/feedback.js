// Feedback goes to the platform, as from the board's own player: the player collects it, Submit hands the named set to this server
// (`POST /api/feedback`), which files it with the credentials of this folder — `POST …/prototype/:contextId/feedback`, the JSON gzipped as the raw
// body, the same endpoint the platform's player uses. Nothing is translated or applied here: the platform's /apply-feedback applies what is
// stored there.
import { gzipSync } from 'node:zlib';
import { paths, readJson } from './state.js';

const MAX_BYTES = 5 * 1024 * 1024; // compressed, what the platform accepts

const apiOf = (cfg) => `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;

/** The refused structure's problems (`context.problems` of a 400), as plain strings. */
const problemsOf = (body) => (Array.isArray(body?.context?.problems) ? body.context.problems.filter((p) => typeof p === 'string').slice(0, 20) : []);

/**
 * Files one named set of feedback ({ name, events, feedbacks }) for the prototype's context on the platform. `contexts` looks the context's id up by
 * name when the folder has none recorded (fetched before ids were kept). Resolves to { ok: true, id } or { ok: false, problems[] } — never throws.
 */
export async function submitFeedback(cwd, cfg, submission, { contexts, fetchImpl = fetch } = {}) {
  try {
    if (!cfg || !cfg.boardId || !cfg.organizationId || !cfg.token) return { ok: false, problems: ['No board is connected to this prototype folder — feedback is submitted to the platform, so it needs one (`eventmodelers init --prototype`, or the connect skill).'] };
    const state = readJson(paths(cwd).state, {});
    let contextId = state.contextId;
    if (!contextId && contexts && state.context) contextId = (await contexts(cfg)).find((c) => c.title === state.context)?.id;
    if (!contextId) return { ok: false, problems: ['This prototype is not tied to a context or timeline of the board — run `eventmodelers prototype fetch --context "<name>"` first.'] };
    const body = gzipSync(JSON.stringify(submission));
    if (body.length > MAX_BYTES) return { ok: false, problems: [`The feedback is larger than ${MAX_BYTES / 1024 / 1024} MB compressed — submit fewer items.`] };
    const res = await fetchImpl(`${apiOf(cfg)}/prototype/${encodeURIComponent(contextId)}/feedback`, {
      method: 'POST',
      headers: { 'x-token': cfg.token, 'x-user-id': 'prototype-local', 'content-type': 'application/gzip' },
      body,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (res.ok) return { ok: true, id: String(data?.id ?? '') };
    if (res.status === 400) { const problems = problemsOf(data); if (problems.length) return { ok: false, problems }; }
    if (res.status === 401 || res.status === 403) return { ok: false, problems: [`The board refused these credentials for feedback (HTTP ${res.status}) — you need access to this board.`] };
    if (res.status === 402) return { ok: false, problems: ['The platform needs an active license (of a Team plan or above) to store feedback.'] };
    if (res.status === 413) return { ok: false, problems: ['The platform refused the upload as too large — submit fewer items.'] };
    return { ok: false, problems: [`The platform could not store the feedback (HTTP ${res.status}${data?.error ? `: ${data.error}` : ''}).`] };
  } catch (err) {
    return { ok: false, problems: [`Could not reach the platform: ${err.message}`] };
  }
}
