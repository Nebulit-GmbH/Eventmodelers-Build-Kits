# Agent Tracking — token spend and action trail

Status: **POC, implemented, not committed.** Built 2026-09-21.
Spans two repos: `eventmodelers-plattform/backend` (branch `main`) and `Eventmodelers-Build-Kits/eventmodelers-cli`.

---

## 1. The goal

Make agent work traceable and put a number on it: what each agent call *did*, what each turn *cost*, and be able to craft reports **after the fact** — including reports nobody thought of when the data was written. It has to work across the whole range of agent hosts the CLI supports, not just Claude Code.

Concretely, as requested:

- an event per use case: prompt token spend, session cost, slice cost per turn;
- every agent call carries the information as headers;
- the action is recorded per call;
- enabled for MCP as well as REST;
- a new `agent_tracing_events` table keyed by `organization_id`, `board_id`, `node_id` (optional);
- a small library function called from each call, which records an event **if the headers are present**;
- an RLS policy: you must be a member of the org to read the events.

---

## 2. The constraint that shaped everything

**Claude Code expands `.mcp.json`'s `${VAR}` header values once, at its own startup, then sends byte-identical headers on every MCP call for the life of that process.**

So of the things we want to send:

- a **session id** survives it — it is fixed per process, which is exactly what a session is;
- a **rolling token count** cannot, ever.

There is no per-request re-resolution, and an MCP tool handler cannot reach the HTTP request either: handlers receive `McpToolContext`, which carries no `req`, and there is no AsyncLocalStorage in the backend.

That splits the design in two halves, joined on `session_id`:

| Half | Who produces it | What it knows |
|---|---|---|
| **Action trail** | the platform, observing its own calls | exact action, board, node, agent, session, timestamp — **no tokens** |
| **Cost events** | the runner, watching its host's output | exact tokens/cost per turn — posted separately |

`--local-ai` is the one exception: the CLI drives that tool loop itself, so its MCP calls *do* carry the round's exact usage in a header. That is the most precise attribution anywhere in the system.

### What each host can actually report

| Surface | Tokens available? | How |
|---|---|---|
| Claude Code (`run --modeling`, `ralph-claude.js`) | yes, per turn | `--output-format stream-json` → the `result` message |
| `--local-ai` (Ollama / vLLM / LM Studio / llama.cpp / TGI) | yes, per round | `usage` / `prompt_eval_count`+`eval_count` on the model response |
| `--exec` (Codex, Gemini CLI, OpenCode, Hermes, Pi …) | **no** | `stdio: 'inherit'`, no cross-harness schema — a black box |
| MCP calls (any host) | no | headers expand once; see above |

### Measured, not assumed (claude 2.1.278)

Probed directly while building this, because getting it wrong produces a tidy breakdown that quietly disagrees with the bill:

- **`assistant` events repeat.** One API call emits one event *per content block* (thinking, tool_use, text), each carrying the same message-level `usage`. They share `message.id` — dedupe on that or you multiply a call's cost by 2–3×.
- **Their usage is a mid-stream snapshot.** A call that finished at 51 output tokens reported `output_tokens: 3` on its `assistant` events. Even deduped, they are unusable for accounting.
- **`result` is the only authoritative message**: final `usage` (incl. `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens_details.thinking_tokens`), `total_cost_usd`, `duration_ms`, `num_turns`, `subagent_stats`, and `modelUsage` keyed by model id with per-model `costUSD`/`costBasis`.
- **`usage.iterations[]` is not one-per-API-call** — a two-call turn showed `iterations: 1`.
- **`costBasis: "list"`** — list price is reported even on a subscription where nothing was billed per call. Tokens are the trustworthy number; dollars are notional.
- **`modelUsage` is the only way to price a mixed-model turn** (Opus lead, Haiku subagents). Flat `usage` has already summed them.

**Consequence:** the per-step *cost* breakdown was dropped. Steps are a trail (what happened, in order); turns carry the cost.

---

## 3. What was built

### Backend — `eventmodelers-plattform/backend`

| File | Lines | What |
|---|---|---|
| `supabase/migrations/V86__agent_tracing_events.sql` | 129 | table, 9 reporting indexes, RLS |
| `migrations/sqlite/V25__agent_tracing_events.sql` | 72 | on-prem mirror |
| `src/slices/agent-tracing/AgentTracingEvent.ts` | 113 | event types, header names, usage shape |
| `src/slices/agent-tracing/recordTracingEvent.ts` | 267 | **the library** |
| `src/slices/agent-tracing/routes.ts` | 368 | ingest + report + raw events |
| `src/slices/agent-tracing/AgentTracing.test.ts` (+2 dialect wrappers) | 197 | DB tests, both dialects |
| `src/slices/agent-tracing/usageHeader.test.ts` | 111 | header-contract tests, no DB |

Modified (one hook each): `src/slices/mcp/routes.ts:171`, `src/slices/change/api-nodes/routes.ts:330`, `src/slices/change/api-prompts/routes.ts:268` and `:399`.

#### The table

Append-only. Nothing updates or deletes a row; reports aggregate at read time. **Every identifier a future question might group by is carried on the row** rather than joined in later — that redundancy is the whole point of being able to report after the fact.

Scope: `organization_id` (NOT NULL, the tenant key and the RLS predicate), `board_id`, `node_id`.
Who: `agent_id`, `agent_name`, `agent_type`, `session_id`, `turn_id`, `prompt_id`, `slice_id`.
What: `action`, `surface`, `status`, `model`.
How much: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `cost_usd`, `cost_basis`, `duration_ms`.
When/extras: `occurred_at`, `meta`.

Deliberate choices:

- **Token kinds split, never summed into one total.** Cache reads bill at a fraction of fresh input, so a single `total_tokens` would overstate every cached turn — which is most of them, since an agent re-sends its whole prompt each call.
- **`cost_basis`** distinguishes "$0.00 because it was free" (`local`) from "$0.00 because we never found out" (`unavailable`) from "list price, not a bill" (`list`).
- **agent labels are denormalized copies**, not FKs to `agent_alive` — that table is pruned every ping (rows older than 5 min are deleted), so a FK would delete history.
- **`occurred_at` is stored as an ISO-8601 string.** Postgres parses it into `TIMESTAMPTZ`; SQLite's mirror column is `TEXT` whose ISO form sorts lexicographically. One value is correct for both dialects, and `from`/`to` range filters work unchanged on each.

#### RLS

Follows the codebase's standard four-policy shape:

```sql
CREATE POLICY "agent_tracing_events_select"
    ON public.agent_tracing_events FOR SELECT TO authenticated
    USING (organization_id = ANY(public.current_user_orga_ids()));
-- + no_insert / no_update / no_delete (WITH CHECK (false) / USING (false))
```

Org-wide on purpose, not per-user: an agent's spend is the org's money and the org's token budget, not private to whoever typed the prompt. Writes are denied because they only ever happen through the backend's Knex connection (a direct Postgres connection, which bypasses RLS anyway) — this keeps the log append-only from the frontend's anon-key client.

#### The events

| Event type | Meaning |
|---|---|
| `agent:action-traced` | one agent→platform call (MCP tool call or REST endpoint). Always has `action`. Tokens only if the caller knew them. |
| `prompt:tokens-spent` | a prompt from the board's queue was worked to completion (`prompt_id` + `node_id`). |
| `slice:tokens-spent` | one build turn against one slice. `slice_id` is the SLICE_BORDER node's uuid, mirrored into `node_id`. |
| `session:cost-recorded` | a session rollup, emitted at shutdown. **A delta**, not a snapshot. |

> **Rows of different event types overlap by design.** A prompt turn produces both an action row and a cost row. Filter by a single `event_type` when summing. `session:cost-recorded` is a delta of what the per-turn events have not already reported, so summing session rows gives the session's cost rather than counting earlier turns again in every later rollup.

#### The library

```ts
// one line at a call site — records only if tracing headers are present
void recordAgentAction(req, {organizationId, action: 'place_element', surface: 'mcp', boardId});

// bulk append, used by the ingest endpoint
await recordTracingEvents([...]);
```

Neither throws and neither is worth awaiting in a request path: tracing is bookkeeping about work that already succeeded, and a failed write must never turn a successful board operation into a 500.

`tracingContextFromRequest(req)` returns `present: false` when no tracing header is there at all, and the recorder returns early — that is what keeps ordinary frontend traffic out of the log.

#### Hook points

- **MCP — one hook covers all ~40 tools.** `handleMcp()` (`src/slices/mcp/routes.ts`) is the only frame holding both `req` and the parsed JSON-RPC body, so the tool name comes from `params.name` and no tool file was touched. Recorded *after* `transport.handleRequest`, so `duration_ms` is real and nothing can delay a tool call. Protocol chatter (`initialize`, `tools/list`, notifications) is skipped — a handshake is not work, and including it would bury the rows that matter. A JSON-RPC error still returns HTTP 200, so `status` is the transport's answer, not the tool's.
- **REST** — explicit calls in `POST /nodes/events` (one row per *call*, not per event in the batch; `node_id` set only when the batch names exactly one node), `POST /prompts/:id/status` (the natural carrier for a prompt's cost — this call is built per request, so it *can* bring a usage header), `GET /prompts/next` (the moment a turn begins; anchors the cost row that lands later).
- **`/api/agent-alive` deliberately not hooked** — a 15-second liveness ping is not work, and a row per ping would bury everything else.

#### Endpoints

```
POST /api/org/:orgId/agent-tracing/events     ingest what a runner measured (idempotent on event id)
GET  /api/org/:orgId/agent-tracing/report     aggregate: ?groupBy=action|agent|session|slice|prompt|
                                              board|node|model|surface|type  &from &to &<filters>
GET  /api/org/:orgId/agent-tracing/events     raw rows, newest first, every identifier filterable
```

The report endpoint aggregates server-side rather than shipping rows to the browser: the point of an append-only log is that nobody knows in advance which grouping a future question needs, and shipping a month of rows to answer "what did this board cost, by action?" scales badly once agents get busy. `groupBy` and every filter are whitelists mapped to columns, never the raw parameter.

### CLI — `Eventmodelers-Build-Kits/eventmodelers-cli`

`shared/build-kit/lib/tracing.js` (180 lines) — one canonical copy, imported by `cli.js` and copied into every installed kit, the same arrangement `lib/adapters/realtime-adapter.js` uses.

Exports: `tracingHeaders()`, `usageFromClaudeResult()`, `usageFromLocalAi()`, `createTracer()`, the three event-type constants, `newId()`.

Wired in at:

| File | What changed |
|---|---|
| `cli.js:654` | `agentHeaders()` now emits the whole `x-agent-*` set |
| `cli.js:1447` | `.mcp.json` gains `x-agent-session-id: ${EVENTMODELERS_SESSION_ID}` |
| `cli.js:1908` | tracer created; session minted; `EVENTMODELERS_SESSION_ID` into the `claude` env |
| `cli.js:2019` | `result` message → `tracer.record(PROMPT_TOKENS_SPENT, …)` |
| `cli.js:1929` | SIGINT/SIGTERM → `tracer.end()` |
| `shared/build-kit/lib/ralph.js:165` | `agentHeaders()` likewise; session minted in `startRalph` and exported to the env |
| `shared/build-kit/lib/ralph.js` | `onTask(prompt, context)` / `onPlannedSlice(prompt, context)` — a second arg carrying the slice the turn is about, so cost lands on the slice. Runners that only want the prompt are untouched. |
| `shared/build-kit/ralph-claude.js:130` | `result` → `tracer.record(SLICE_TOKENS_SPENT, …)` |
| `shared/build-kit/lib/local-ai-agent.js:153` | MCP calls carry the round's usage — the one place cost rides on the call it describes |
| `shared/build-kit/lib/local-ai-agent.js:331` | per-turn event; `chat()` now keeps the raw response so usage survives `d.unwrap` |

Headers:

```
x-agent-id           (pre-existing)
x-agent-name
x-agent-type         MODELING | BUILD
x-agent-session-id
x-agent-turn-id
x-agent-action       what the caller says it is doing
x-agent-usage        in=9;out=45;cr=31000;cw=22127;think=39;cost=0.044488;basis=list;ms=4200;model=…
```

`x-agent-usage` is compact `k=v;k=v` rather than JSON because the same value is assembled by hand in skills' `curl` fallbacks, where every character is one more thing to quote wrong. The backend ignores keys it does not know, so an older backend keeps accepting headers from a newer CLI.

Each event is appended to a local `.eventmodelers/trace/<session>.jsonl` first, then POSTed once.

---

## 4. Deliberately *not* built

Four layers of defensive machinery were added and then removed during review. Recorded here so they don't get reinvented:

| Removed | Why |
|---|---|
| Circuit breaker for "table doesn't exist yet" | The migration ships with the backend. A missing table is a half-applied deploy — finish the deploy. |
| Retry queue for failed uploads | The local trace file is already the durable record. |
| Send buffer that replaced it | With steps kept local, ~one event per turn is uploaded — it was batching a single item. |
| In-flight tracking that replaced that | Only mattered for the final event before `process.exit`; `end()` awaits that one post directly. |

Also not built: per-step cost rows (see §2 — the numbers would be wrong), a periodic session rollup timer, and any tolerance for a `503`.

**This is best effort.** Write locally, try once, log, move on.

---

## 5. Independent deployability

| Scenario | Result |
|---|---|
| Backend deployed, **unchanged CLI** | **Works.** And the action trail lights up immediately with no CLI change at all, because every released CLI already sends `x-agent-id`. Rows have no session and no tokens, which is the honest result. |
| Backend deployed, **non-agent traffic** (browser) | **Works.** No tracing header → `present: false` → no row, no error. |
| **New CLI, older backend** | **Works.** Upload gets a 404, one log line, agent carries on. Events remain in the local trace file. |
| Backend deployed **without its migration** | **Broken, loudly.** By decision: that is a half-applied deploy, not a state to work around. |

The first two are covered by tests.

---

## 6. `board_events` index audit

Asked as part of this work. Audited every query in the backend and the frontend.

**Nothing is missing.** Every read path is served by an existing index, and the Postgres/SQLite mirrors are in lockstep (SQLite's V14 twin omits `node_type`, which nothing queries).

| Query | Predicate | Served by |
|---|---|---|
| `getBoardEvents` (board load) | `board_id` [+ `seq >`] + silent filter | `board_events_board_id_seq` |
| frontend event sync (PostgREST, RLS) | `board_id` + `seq >` | same |
| `getNodeEvents` (per-node history) | `board_id` + `node_id`, order `seq` | `board_events_board_id_node_id` (V57) |
| `getChangedNodeIdsSince` ×3 (realtime gap recovery) | `board_id`, `max(seq)`, `seq >` | `board_events_board_id_seq` |
| `GitExtension.loadMissedEvents` | `board_id` + `seq >` | same |
| `PersistImport` / `DeleteBoard` | `board_id` DELETE | same |
| `searchBoardEvents` | `board_id` + `node->>'name' ilike '%…%'` | `board_id` only — a leading-wildcard `ilike` is unindexable without a trigram GIN index, which has no SQLite equivalent |

The finding is the opposite of the question: **three indexes have no reader in the code.**

- `board_events_board_id_timestamp` (V1) — everything uses `seq`; nothing filters or orders `board_events` by `timestamp`.
- `board_events_event_type_board_node` (V14) — leads with `event_type`, and the only `event_type` predicate in the codebase is a `whereNotIn` negation, which no index can serve. V57 already diagnosed this and added its own index as the fix, but left V14's in place.
- `board_events_organization_id` (V74) — every `organization_id` reference on `board_events` is an insert. No query filters by it. (The `ListBoards` org filter is on `boards`, not `board_events`.)

On an append-only table written on every node change, that is three lots of write amplification for no read benefit. **Not removed** — the ask was to check for missing indexes, and dropping indexes is a separate call. If wanted: a `V87__` + `migrations/sqlite/V26__` pair.

Optional addition considered and rejected as unmeasured: a covering index for the gap-recovery query (`(board_id, seq) INCLUDE (node_id, user_id, event_type)`). The range is bounded by how far behind a reconnecting client is, so the heap-fetch saving is modest against a write cost on the hottest table in the system.

---

## 7. Verification

- `tsc --noEmit` clean.
- **861/861 backend tests pass** (835 before, +26 new) — the new DB tests run on both Postgres (testcontainer) and SQLite via the existing `dualDialectTestHarness`.
- End-to-end against a stub platform: both event types arrive with the right headers, action, ids and token/cost breakdown; `session:cost-recorded` follows on `end()`.
- `node --check` on every touched CLI file; `cli.js` loads and `run --help` works.

Test coverage worth keeping: no-headers-records-nothing, `x-agent-id`-only records an action row, full header set round-trips, runner-uploaded cost events land, duplicate id is ignored, group-by-action sums correctly on both dialects, oversized agent-chosen labels are bounded.

---

## 8. Conclusion

The question "what did this agent cost?" is answerable now, and the honest shape of the answer is:

1. **The action trail is complete and free.** The platform sees every MCP tool call and every agent REST call and stamps the action on it. This needs no CLI change to start working.
2. **Cost is per turn, not per step**, and that is a measurement limit rather than a design shortcut — `assistant` stream events repeat and under-report, so any per-step dollar figure would be fiction. Per-step *sequence* is in the local trace file.
3. **`--exec` harnesses report nothing.** Codex, Gemini CLI, OpenCode, Hermes and Pi are black boxes by construction. If their cost matters, the host-agnostic answer is a pass-through proxy on `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` reading `usage` out of each response — one mechanism for every harness that talks to a remote model, with no per-vendor parsing. Not built; the per-vendor alternative is a treadmill and contradicts `ralph-exec.js`'s own design note.
4. **Dollars are softer than tokens.** `costBasis: 'list'` means Claude Code's figure is list price even on a subscription. Report tokens as fact and dollars as an estimate, or the numbers will be argued with.
5. **The slice is the unit that will matter to customers.** "This slice cost $X across N turns" comes free from `slice:tokens-spent`, and it is the only figure here a non-engineer can act on.

### Open / next

- Nothing is committed. Two repos, no branch made.
- Migrations not applied anywhere (`npm run flyway:migrate`, `npm run migrate:sqlite`).
- Docs not written: `miro-eventmodeling/src/app/documentation/page.tsx` has no agent-tracing section, and the `connect` skill's canonical curl header block (`shared/skills/connect/SKILL.md:30-36`) does not yet mention the new headers. Per the standing 3-part-update rule, both belong with this change.
- No UI. The report endpoint exists; nothing on the board shows a cost yet.
- `board_events` dead-index removal, if wanted (§6).
- `--exec` proxy, if `--exec` cost matters (§8.3).
