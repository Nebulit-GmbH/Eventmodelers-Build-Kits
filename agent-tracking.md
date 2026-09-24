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
| `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `duration_ms` | from the agent's own usage report for the turn — see *Who writes it* |

Per slice: `count(*)` = iterations, `min/max(occurred_at)` = over what span, `sum(cost_usd)` = spent.

## Who writes it

After each planned-slice build turn (`onPlannedSlice`), the runner posts one trace via
`lib/tracing.js`'s `createSliceTracer`. Tasks and local-AI runs are not traced.

| runner | usage comes from | cost |
|---|---|---|
| `ralph-claude.js` | Claude Code's final `result` message | Claude Code's list price, even on a subscription |
| `ralph-exec.js` — Codex | `turn.completed` events | `null` |
| `ralph-exec.js` — OpenCode | summed `step_finish` events | as OpenCode reports it |
| `ralph-exec.js` — Gemini CLI | the final `result` (`stream-json`) or `stats.models` (`json`) | `null` |

### Non-Claude agents (`--exec`): the JSON output flag is required

> **An `--exec` harness is only traced when it runs in its JSON output mode.** Its normal,
> human-readable output carries no token counts, so without the flag there is nothing to record:
> the turn is **not** traced, and the runner logs
> `trace: no usage in the command output — run the harness in its JSON output mode to record slice cost`.
> The runner does not add the flag for you — it changes what the harness prints, so it is your call.

Put the flag into the command you pass to `--exec` (or persist as `localAi.exec`):

| agent | without tracing | with tracing |
|---|---|---|
| Codex CLI | `codex exec --full-auto` | `codex exec --json --full-auto` |
| OpenCode | `opencode run --auto` | `opencode run --auto --format json` |
| Gemini CLI | `gemini --yolo -p` | `gemini --yolo --output-format stream-json -p` (or `--output-format json`) |

```bash
eventmodelers config --agent-tracing on
eventmodelers run --exec "codex exec --json --full-auto"
```

With the flag on, the terminal shows the harness's raw JSON events instead of its usual output —
that is the trade-off. Events are matched on their shape, not the command name, so a wrapper
script around a harness is traced too, as long as it passes the JSON through to stdout.
`cost_usd` stays `null` where the harness gives none (Codex, Gemini) — no price table is kept, so
the slice cost list under-counts those turns rather than guessing; tokens and duration are still
recorded.

Each trace is also appended to `.eventmodelers/trace/slices.jsonl`; upload is best effort, no retries.

## API

```
POST /api/org/:orgId/agent-traces           {traces: [...]}  → {recorded}
     400  a trace without sliceId, a uuid agentId, or a valid sessionId (whole batch rejected)
     403  the agent is not a connected build agent: no /api/agent-alive heartbeat with
          agent_type BUILD within 45s under a token of this org
GET  /api/org/:orgId/boards/:boardId/reporting/slices/cost?sliceId=&context=   (this board's turns only)
     → {slices: [{sliceId, sliceTitle, context, iterations, firstAt, lastAt, costUsd, inputTokens, outputTokens,
                  cacheReadTokens, cacheWriteTokens, durationMs}]}
```

