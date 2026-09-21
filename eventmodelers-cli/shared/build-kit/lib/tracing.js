// Agent tracing (POC): report what a turn cost, since only the runner can see it.
//
// The platform already records WHAT an agent did — it sees every MCP and REST call and stamps the
// action on each one. What it cannot see is what the model spent deciding to do it, and that
// cannot be attached to those calls either: Claude Code expands .mcp.json's `${VAR}` headers once
// at its own startup, so a rolling token count can never ride on an MCP call. A session id can
// (it is fixed per process), so identity goes on the headers and cost is posted separately; the
// two are joined on session_id after the fact.
//
// One canonical copy, imported by cli.js and copied into every installed kit — the same
// arrangement lib/adapters/realtime-adapter.js uses.
//
// Best effort: each event is appended to a local JSONL file, then POSTed once. No retries, no
// buffering. A failed upload is logged and forgotten; the file is the record.

import { randomUUID } from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Must match backend/src/slices/agent-tracing/AgentTracingEvent.ts.
export const PROMPT_TOKENS_SPENT = 'prompt:tokens-spent';
export const SLICE_TOKENS_SPENT = 'slice:tokens-spent';
export const SESSION_COST_RECORDED = 'session:cost-recorded';

export const newId = () => randomUUID();

const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The headers an agent→platform call carries. All optional: a call that knows none of this
 *  behaves exactly as it did before tracing existed, and the platform records nothing for it. */
export function tracingHeaders({ agentId, agentName, agentType, sessionId, turnId, action, usage } = {}) {
  const h = {};
  if (agentId) h['x-agent-id'] = agentId;
  if (agentName) h['x-agent-name'] = agentName;
  if (agentType) h['x-agent-type'] = agentType;
  if (sessionId) h['x-agent-session-id'] = sessionId;
  if (turnId) h['x-agent-turn-id'] = turnId;
  if (action) h['x-agent-action'] = action;
  // Compact k=v;k=v rather than JSON — this value is also assembled by hand in skills' curl
  // fallbacks. The backend ignores keys it does not know (parseUsageHeader).
  if (usage) {
    const p = [];
    if (n(usage.inputTokens)) p.push(`in=${n(usage.inputTokens)}`);
    if (n(usage.outputTokens)) p.push(`out=${n(usage.outputTokens)}`);
    if (n(usage.cacheReadTokens)) p.push(`cr=${n(usage.cacheReadTokens)}`);
    if (n(usage.cacheWriteTokens)) p.push(`cw=${n(usage.cacheWriteTokens)}`);
    if (usage.costUsd != null) p.push(`cost=${Number(usage.costUsd).toFixed(6)}`);
    if (usage.costBasis) p.push(`basis=${usage.costBasis}`);
    if (usage.durationMs) p.push(`ms=${n(usage.durationMs)}`);
    if (usage.model) p.push(`model=${String(usage.model).replace(/[;\s]/g, '')}`);
    if (p.length) h['x-agent-usage'] = p.join(';');
  }
  return h;
}

/** Claude Code's `result` message — the only one whose numbers are final. The `assistant` events
 *  repeat one call's usage per content block AND report it mid-stream (a call that ended at 51
 *  output tokens shows 3 there), so they cannot be used for accounting. `modelUsage` names the
 *  dominant model, which matters when subagents ran on a cheaper one than the lead.
 *  costBasis 'list': Claude Code reports list price even on a subscription, where nothing was
 *  billed per call — the figure is notional and the column says so. */
export function usageFromClaudeResult(msg) {
  const u = msg?.usage ?? {};
  const [dominant] = Object.entries(msg?.modelUsage ?? {})
    .sort((a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0))[0] ?? [];
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
    reasoningTokens: n(u.output_tokens_details?.thinking_tokens),
    costUsd: Number.isFinite(msg?.total_cost_usd) ? msg.total_cost_usd : null,
    costBasis: 'list',
    durationMs: Number.isFinite(msg?.duration_ms) ? msg.duration_ms : null,
    model: dominant ?? null,
  };
}

/** A local model's per-round usage. Ollama reports it at the top level of /api/chat,
 *  OpenAI-compatible servers under `usage` — both siblings of the message, which is why
 *  unwrapping first used to throw them away. costUsd 0 on basis 'local' is genuinely free, a
 *  different fact from unknown; tokens and wall time are the real bill here. */
export function usageFromLocalAi(raw, durationMs) {
  const openai = raw?.usage;
  if (!openai && !Number.isFinite(raw?.eval_count) && !Number.isFinite(raw?.prompt_eval_count)) return null;
  return {
    inputTokens: n(openai ? openai.prompt_tokens : raw.prompt_eval_count),
    outputTokens: n(openai ? openai.completion_tokens : raw.eval_count),
    costUsd: 0,
    costBasis: 'local',
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    model: typeof raw?.model === 'string' ? raw.model : null,
  };
}

/** Records turn costs. `record()` is fire-and-forget; `end()` awaits the session rollup, the one
 *  upload that must not race process exit. */
export function createTracer({
  baseUrl, token, organizationId, boardId, agentId, agentName, agentType,
  sessionId = newId(), traceFile, log = () => {}, enabled = true,
} = {}) {
  const canUpload = !!(enabled && baseUrl && token && organizationId);
  const startedAt = Date.now();
  let turns = 0;
  // The session event is a DELTA of what has not been reported yet, so that
  // `sum(cost) where event_type = 'session:cost-recorded'` is the session's cost rather than
  // counting earlier work again in every later rollup.
  let unreported = null;

  const add = (a, b) => !a ? b : {
    inputTokens: n(a.inputTokens) + n(b.inputTokens),
    outputTokens: n(a.outputTokens) + n(b.outputTokens),
    cacheReadTokens: n(a.cacheReadTokens) + n(b.cacheReadTokens),
    cacheWriteTokens: n(a.cacheWriteTokens) + n(b.cacheWriteTokens),
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0),
    costBasis: a.costBasis ?? b.costBasis,
    durationMs: (a.durationMs ?? 0) + (b.durationMs ?? 0),
    model: a.model ?? b.model,
  };

  async function post(event) {
    if (!canUpload) return;
    try {
      const res = await fetch(`${baseUrl}/api/org/${organizationId}/agent-tracing/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-token': token,
          ...tracingHeaders({ agentId, agentName, agentType, sessionId }),
        },
        body: JSON.stringify({ events: [event] }),
        signal: AbortSignal.timeout(15_000),
      });
      // Includes a platform with no such endpoint yet (404): say so and carry on.
      if (!res.ok) log(`trace: upload failed (HTTP ${res.status}) — kept locally only`);
    } catch (err) {
      log(`trace: upload error (${err.message}) — kept locally only`);
    }
  }

  function write(event) {
    if (!traceFile) return;
    try {
      mkdirSync(dirname(traceFile), { recursive: true });
      appendFileSync(traceFile, `${JSON.stringify(event)}\n`);
    } catch (err) {
      if (!write.warned) { write.warned = true; log(`trace: cannot write ${traceFile} (${err.message})`); }
    }
  }

  const build = (eventType, usage, fields) => ({
    id: newId(), eventType, occurredAt: new Date().toISOString(),
    boardId, agentId, agentName, agentType, sessionId, usage, ...fields,
  });

  return {
    sessionId,

    /** One turn. `eventType` is PROMPT_TOKENS_SPENT or SLICE_TOKENS_SPENT; `fields` carries
     *  whatever identifies it (promptId / sliceId / nodeId / turnId / action / status). */
    record(eventType, usage, fields = {}) {
      if (!usage) return;
      turns += 1;
      unreported = add(unreported, usage);
      const event = build(eventType, usage, fields);
      write(event);
      post(event).catch(() => {});
    },

    /** The session rollup, awaited. Safe to call twice — the second has nothing to report. */
    async end(fields = {}) {
      if (!unreported) return;
      const usage = { ...unreported, durationMs: Date.now() - startedAt };
      unreported = null;
      const event = build(SESSION_COST_RECORDED, usage, { meta: { turns }, ...fields });
      write(event);
      await post(event);
    },
  };
}
