// What a slice costs: one trace per build turn against one slice, posted to the platform's
// /api/org/:orgId/boards/:boardId/agent-traces. Only the runner can see what a turn cost, so it reports it.
//
// Best effort: each trace is appended to a local JSONL file, then POSTed once. No retries, no
// buffering. A failed upload is logged and forgotten; the file is the record.

import { randomUUID } from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const newId = () => randomUUID();

const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Claude Code's `result` message — the only one whose numbers are final. The `assistant` events
 *  repeat one call's usage per content block AND report it mid-stream, so they cannot be used for
 *  accounting. `modelUsage` names the dominant model, which matters when subagents ran on a
 *  cheaper one than the lead. Cost is list price, even on a subscription. */
export function usageFromClaudeResult(msg) {
  const u = msg?.usage ?? {};
  const [dominant] = Object.entries(msg?.modelUsage ?? {})
    .sort((a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0))[0] ?? [];
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
    costUsd: Number.isFinite(msg?.total_cost_usd) ? msg.total_cost_usd : null,
    durationMs: Number.isFinite(msg?.duration_ms) ? msg.duration_ms : null,
    model: dominant ?? null,
  };
}

/** A local model's per-round usage. Ollama reports it at the top level of /api/chat,
 *  OpenAI-compatible servers under `usage`. Cost 0: a local model is genuinely free. */
export function usageFromLocalAi(raw, durationMs) {
  const openai = raw?.usage;
  if (!openai && !Number.isFinite(raw?.eval_count) && !Number.isFinite(raw?.prompt_eval_count)) return null;
  return {
    inputTokens: n(openai ? openai.prompt_tokens : raw.prompt_eval_count),
    outputTokens: n(openai ? openai.completion_tokens : raw.eval_count),
    costUsd: 0,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    model: typeof raw?.model === 'string' ? raw.model : null,
  };
}

/** Records slice build turns. The agent id is the session: the platform requires one, and a
 *  restart of the same build agent is still the same agent building the same slices. */
export function createSliceTracer({ baseUrl, token, organizationId, agentId, traceFile, log = () => {}, enabled = true } = {}) {
  const canUpload = !!(enabled && baseUrl && token && organizationId && agentId);

  async function post(trace) {
    // The platform files a trace under the board in its path — a turn without a board has nowhere to go.
    if (!canUpload || !trace.boardId) return;
    try {
      const res = await fetch(`${baseUrl}/api/org/${organizationId}/boards/${trace.boardId}/agent-traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token, 'x-agent-id': agentId },
        body: JSON.stringify({ traces: [trace] }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) log(`trace: upload failed (HTTP ${res.status}${await res.text().then((t) => `: ${t}`).catch(() => '')}) — kept locally only`);
    } catch (err) {
      log(`trace: upload error (${err.message}) — kept locally only`);
    }
  }

  function write(trace) {
    if (!enabled || !traceFile) return;
    try {
      mkdirSync(dirname(traceFile), { recursive: true });
      appendFileSync(traceFile, `${JSON.stringify(trace)}\n`);
    } catch (err) {
      if (!write.warned) { write.warned = true; log(`trace: cannot write ${traceFile} (${err.message})`); }
    }
  }

  return {
    /** One build turn: `{sliceId, sliceTitle, context, ticketNumber, boardId, attempt, status}` plus its usage.
     *  ticketNumber is the slice's ticket at build time — it can change, so it travels with each turn. */
    record({ sliceId, sliceTitle = null, context = null, ticketNumber = null, boardId = null, attempt = null, status = 'ok' }, usage) {
      if (!sliceId || !usage) return;
      const trace = {
        id: newId(), occurredAt: new Date().toISOString(),
        boardId, sliceId, sliceTitle, context, ticketNumber, agentId, sessionId: agentId, attempt, status, ...usage,
      };
      write(trace);
      post(trace).catch(() => {});
    },
  };
}
