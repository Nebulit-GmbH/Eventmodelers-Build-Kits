---
name: connect
description: Resolve eventmodelers connection config (token, boardId, baseUrl) from inline params or .eventmodelers/config.json — ask the user for missing values, persist them, and add the file to .gitignore. All other skills invoke this first.
---

# Connect — Resolve Eventmodelers Config

**Every other skill invokes this skill first** before any API call. Do not proceed until `TOKEN`, `BOARD_ID`, `ORG_ID`, `BASE_URL` are resolved.

MCP (`mcp__eventmodelers__*`, registered in step 3.5) is the preferred transport; curl is the fallback for hosts without MCP or for endpoints the MCP server doesn't expose (see `learn-eventmodelers-api`).

## Gate — already resolved this session? Stop here.

If the four values are already resolved and verified earlier in this session — including earlier in the *same turn* (one skill invoking another, e.g. `add-next-slice` → `html-screen`) — every further "invoke `connect`" is satisfied by reusing them. Do not re-run anything below. Re-run only when a value must change: a fresh `401`/`403`/access-denied, a different `board_id`, or a new inline param overriding what you hold.

**Subagents are a fresh session** — put the resolved values inline in their prompt (`token=… board=… org=… baseUrl=…`, plus `agent=…` / `session=…` when you have them). Four inline values finish this skill at once: no config walk, no questions, no persist, no verify; print `Connected — board <BOARD_ID>` and return.

## Resolution order

**inline param > `.eventmodelers/config.json` > ask the user.** `baseUrl` defaults to `https://api.eventmodelers.ai`, never asked.

0. **Inline** (`token=`, `board=`, `org=`, `baseUrl=`, optional `agent=`, `session=`; `token=$EVENTMODELERS_TOKEN` is an inline token — keep the reference, never the value). Load `references/inline-params.md` only when an inline param is present.
0.5. **`AGENT_ID`** (optional, agents only: `$EVENTMODELERS_AGENT_ID`, else `agentIds.*` in the config; none → human session, omit `x-agent-id`). Load `references/agent-id.md` only when running as an agent.
1. **Config file** — the first `.eventmodelers/config.json` found walking up from the cwd (keys `token`, `boardId`, `organizationId`/`orgId`, `baseUrl`). All four present → skip to step 4, do not persist. Load `references/config-file.md` for the walk script and file format.
2. **Ask** only for what is still missing. Load `references/ask-for-values.md` for the exact questions and the paste formats.
3. **Persist** (only after step 2 collected something interactively) — merge into `.eventmodelers/config.json`, ensure it is in `.gitignore`, tell the user. Script: `references/config-file.md`.
3.5. **MCP server** — idempotent, every time: ensure `.mcp.json` has an `eventmodelers` entry (`<BASE_URL>/mcp`, headers `x-token: ${EVENTMODELERS_TOKEN}`) and `.claude/settings.local.json` `env` holds `EVENTMODELERS_TOKEN`, gitignored. No `eventmodelers` entry yet → load `references/register-mcp.md`; entry present → nothing to do.
4. **Verify** — `get_nodes { type: "CHAPTER", projection: "line" }` (or the curl equivalent) once per session. Load `references/verify.md` when MCP is not visible, the call fails, or it needs re-authentication (status-code table, `401`/`403`/`404` handling).

## What to persist, and the security rule

- Persisted: `token`, `boardId`, `organizationId`, `baseUrl` in `.eventmodelers/config.json`; `EVENTMODELERS_TOKEN` in `.claude/settings.local.json` `env`. Never persist `session=` or `EVENTMODELERS_AGENT_ID`, and never write the literal text `$EVENTMODELERS_TOKEN` into a file.
- **The token is a secret and never appears in a committed file.** `.eventmodelers/config.json` and `.claude/settings.local.json` are gitignored (check, then append to `.gitignore`); `.mcp.json` carries only the `${EVENTMODELERS_TOKEN}` placeholder. Never log or echo the token. It grants write access to the whole organization — treat it like a password.
- A `401`/`403` (curl) or access-denied (MCP) mid-session → re-invoke this skill before retrying.

## Variables and headers

`TOKEN` (`x-token`), `BOARD_ID`, `ORG_ID`, `BASE_URL`; optional `AGENT_ID` (`x-agent-id`) and per-turn `CHAT_SESSION_ID` (`x-chat-session-id`, or `sessionId` on MCP writes). Board URLs: `<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/...`. Load `references/variables-and-headers.md` before writing curl calls.

## Reading the board (Step 5) — cheapest read first

Fetch once, index in memory. Default: `get_board_outline` for orientation; `get_nodes` with `projection: "line"` (names) or `"fields"` (field types/examples), scoped by `chapterId`/`nodeIds`. Full `meta` (HTML pages, descriptions, positions) only when the task is about screen HTML, descriptions or layout. A multi-node write is one `submit_node_events` call; mint ids once per turn. Load `references/read-discipline.md` for the decision table with costs, the slice-status note and id rules.
