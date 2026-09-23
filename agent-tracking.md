# Agent tracking — what does a slice cost?

**Off by default** — opt in per project with `agentTracing: true` in `.eventmodelers/config.json` (asked on `init`, or `eventmodelers config --agent-tracing on|off`). Off means the runner sends nothing.

Scope, for now: **build agents and slice builds only.** No modeling-agent tracing, no MCP action
trail, no session rollups.

## What is recorded

One row per build turn against one slice (= one iteration), in the platform's `agent_traces`
table (`backend/supabase/migrations/V87__agent_traces.sql`, SQLite mirror `V26`):

| column | |
|---|---|
| `id` | the turn id — idempotency key, a re-sent batch is ignored |
| `occurred_at`, `organization_id`, `board_id` | |
| `slice_id` | the SLICE_BORDER node's uuid — required |
| `slice_title`, `context` | the slice's name and context at build time (V88 / SQLite V27); the summary reports them as of the latest build |
| `agent_id`, `session_id` | required; the runner uses the agent id as the session. A session id containing `$` (an unexpanded placeholder) is rejected |
| `attempt` | the runner's retry count for this slice |
| `status` | `ok` / `error` |
| `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `duration_ms` | from Claude Code's final `result` message for the turn |

Per slice: `count(*)` = iterations, `min/max(occurred_at)` = over what span, `sum(cost_usd)` = spent.

## Who writes it

`shared/build-kit/ralph-claude.js` — after each planned-slice build turn (`onPlannedSlice`), it
posts one trace via `lib/tracing.js`'s `createSliceTracer`. Tasks and local-AI runs are not traced.
Each trace is also appended to `.eventmodelers/trace/slices.jsonl`; upload is best effort, no retries.

## API

```
POST /api/org/:orgId/boards/:boardId/agent-traces   {traces: [...]}  → {recorded}
     400  a trace without sliceId, a uuid agentId, or a valid sessionId, or naming a boardId other
          than the path's (whole batch rejected); a trace without a boardId is filed under the path's
     403  no access to the board in this org, or the agent is not a connected build agent: no
          /api/agent-alive heartbeat with agent_type BUILD within 45s under a token of this org
     404  no such board
GET  /api/org/:orgId/boards/:boardId/reporting/slices/cost?sliceId=&context=   (this board's turns only)
     → {slices: [{sliceId, sliceTitle, context, iterations, firstAt, lastAt, costUsd, inputTokens, outputTokens,
                  cacheReadTokens, cacheWriteTokens, durationMs}]}
```

Cost is Claude Code's list price, even on a subscription.
