---
name: connect
description: Resolve eventmodelers connection config (token, boardId, baseUrl) from inline params or .eventmodelers/config.json — ask the user for missing values, persist them, and add the file to .gitignore. All other skills invoke this first.
---

# Connect — Resolve Eventmodelers Config

**Every other skill invokes this skill first** before making any API calls. Do not proceed past this skill until all four values (`TOKEN`, `BOARD_ID`, `ORG_ID`, `BASE_URL`) are resolved.

**This should happen once per session, not once per skill.** If `TOKEN`/`BOARD_ID`/`ORG_ID`/`BASE_URL` are already resolved and verified from earlier in the current session — including earlier in the *same turn*, e.g. one skill internally invoking a second skill (`add-next-slice` → `html-screen`) — every subsequent "invoke `connect`" instruction is satisfied immediately by reusing those values. Do not re-run Steps 0–4 below. Only re-run this skill from scratch when a value actually needs to change: a fresh `401`/`403`/access-denied response from some other call, a different `board_id` on this turn, or a new inline param that overrides what's already resolved.

**Subagents are a fresh session — hand them the resolved values.** When you spawn a subagent to do board work, put the already-resolved credentials inline in its prompt (`token=… board=… org=… baseUrl=…`, plus `agent=…` when you have an `AGENT_ID` — a subagent's writes are still this agent's writes, and it cannot read your environment). Its `connect` then satisfies everything at Step 0 and skips Steps 1–4 entirely: no config-file walk, no MCP re-registration, no verify call. Spawning three subagents without passing them down means paying the whole resolve-and-verify round three more times for values you already have.

This skill also registers the **eventmodelers MCP server** for the project (Step 3.5) so other skills can call MCP tools (`mcp__eventmodelers__*`) instead of raw curl. MCP is the preferred transport; curl remains a fallback for hosts without MCP support, or for the one or two endpoints (documented in `learn-eventmodelers-api`) the MCP server doesn't expose.

---

## What this skill produces

After running, the following variables are available for the rest of the session:

| Variable | Header sent to API | Description |
|----------|--------------------|-------------|
| `TOKEN` | `x-token` | API token UUID |
| `BOARD_ID` | — | Target board UUID (used in all board-scoped URLs) |
| `ORG_ID` | — | Organization UUID (used in all board-scoped URLs) |
| `BASE_URL` | — | Base URL, e.g. `http://localhost:3000` |
| `AGENT_ID` | `x-agent-id` | This agent process's own id, when running as one (Step 0.5). Optional — skip the header when there is no value. |

Every curl-fallback call in every skill must include these headers:
```
x-token: <TOKEN>
x-user-id: <skill-name>   ← set by each skill individually
x-agent-id: <AGENT_ID>    ← only when AGENT_ID resolved; omit the line entirely otherwise
```

`x-agent-id` is what makes the board say *which* agent did something: the platform stamps it on
every change the call writes, so the canvas shows this agent by name (rather than one anonymous
robot standing in for every agent at once), and a prompt a user addressed to one preferred agent
is only handed to the agent that claims it with that id.

All board-scoped URLs follow the pattern: `<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/...`

When calling MCP tools instead, no `x-*` headers are needed per call — the MCP server resolves `ORG_ID` from `TOKEN` itself and every tool takes `boardId` as an explicit argument. (`x-agent-id` rides along with the registered server config from Step 3.5, so MCP writes are attributed too.) See `learn-eventmodelers-api` for the full tool catalog.

---

## Step 0 — Check for inline parameters

Before reading the config file, scan the prompt/arguments that invoked this skill for inline overrides. Supported formats:

| Pattern | Example |
|---------|---------|
| `board=<uuid>` | `board=05cda19d-d5b8-4b51-ae88-c72f2611548a` |
| `token=<uuid>` | `token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `org=<uuid>` | `org=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `baseUrl=<url>` | `baseUrl=http://localhost:3000` |
| `agent=<uuid>` | `agent=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (the agent id a parent agent hands a subagent, so the subagent's board writes are attributed to the same agent) |

If an inline `board=<uuid>` is found, use it as `BOARD_ID` — **it takes priority over the config file**. Same for `token`, `org`, `baseUrl`, and `agent` (as `AGENT_ID`, which then makes Step 0.5 a no-op). Record which values came from inline params so they are not overwritten in Step 3.

(`agent=<uuid>` is not one of the four required values — it is optional, and its absence never makes this skill ask anything.)

**All four inline means this skill is already finished — stop here.** `token=`, `board=`, `org=` and `baseUrl=` arriving together is the shape a parent agent hands a subagent, and it resolves every required value in this one step. Do not walk the config file (Step 1), do not ask anything (Step 2), do not persist (Step 3), and do not make the verify call (Step 4): the parent resolved these values against this board and verified them there, so a subagent verifying them again learns nothing it wasn't just told and pays a round trip for it. Step 3.5 is a no-op too whenever `.mcp.json` already carries an `eventmodelers` entry — read the file, don't rewrite it, and don't re-register a server the session is already connected to. Print `Connected — board <BOARD_ID>` and return to the skill that invoked you.

---

## Step 0.5 — Resolve `AGENT_ID` (agents only)

Optional, and only ever relevant when this session *is* an agent's session (`eventmodelers run`
spawned it). Resolve in this order and stop at the first hit:

1. `$EVENTMODELERS_AGENT_ID` — the CLI exports it for the agent it runs. This is the normal case.
2. `agentIds.MODELING` (or `agentIds.BUILD` for a build kit) in the project root's
   `.eventmodelers/config.json` — the id the CLI minted once for this project and reuses on every
   restart.

If neither exists, there is no `AGENT_ID`: this is a human's session, not an agent's. Leave it
unset and omit the `x-agent-id` header everywhere. Never invent one, and never reuse another
agent's id — the id is what the board attributes work to.

```bash
agent_id="${EVENTMODELERS_AGENT_ID:-}"
[ -z "$agent_id" ] && [ -n "$config_file" ] && agent_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("agentIds",{}).get("MODELING",""))' "$config_file" 2>/dev/null)"
echo "${agent_id:-<none>}"
```

---

## Step 1 — Read config file

Search for `.eventmodelers/config.json` starting from the current working directory and walking up through all parent directories. This is the same file every kit installed in this project reads and writes, so credentials only need to be entered once per project:

```bash
dir="$PWD"
config_file=""
while [ "$dir" != "/" ]; do
  if [ -f "$dir/.eventmodelers/config.json" ]; then
    config_file="$dir/.eventmodelers/config.json"
    break
  fi
  dir="$(dirname "$dir")"
done
[ -n "$config_file" ] && cat "$config_file"
```

If a file is found (at any level), note its path and extract any values **not already set by Step 0**:
- `token` → `TOKEN`
- `boardId` → `BOARD_ID`
- `organizationId` (or `orgId`) → `ORG_ID`
- `baseUrl` → `BASE_URL` (default: `https://api.eventmodelers.ai` if missing)

Resolution priority: **inline param > config file > ask user**

If all four are present (from any source), skip straight to **Step 4 — Verify** — do **not** run Step 3. Step 3 only runs after Step 2 collects a value interactively from the user; if nothing was collected interactively (values came from inline params and/or an existing config file), there is nothing new to persist.

---

## Step 2 — Ask for missing values

If after Steps 0 and 1 any required field is still missing, **ask the user one question first**:

> "Do you have a config from the eventmodelers accounts page? (yes / no)"

**If the user answers yes:**
Stop asking questions. Show this hint and wait for them to paste:

> "Great — please paste your config from https://app.eventmodelers.ai/account here."

The paste may be either a JSON object, or a single comma-separated line of `key=value` pairs (as copied out of a URL query string), in any order, e.g.:
```
token=xxxxxxxx-...,boardId=xxxxxxxx-...,organizationId=xxxxxxxx-...,baseUrl=https://api.eventmodelers.ai
```

Parse either form immediately — accept both `orgId` and `organizationId` as the organization field. For the comma-separated form, split on commas and match each piece by its `key=` prefix (`token`, `boardId`, `organizationId`/`orgId`, `baseUrl`) rather than by position — do **not** assume a fixed field order, since the order the value was copied in and the order it's pasted in are not guaranteed to match. If a value has no recognizable `key=` prefix, treat it as an error and re-ask rather than guessing which field it belongs to. Apply all values, and proceed directly to Step 3.

**If the user answers no** (or pastes only a partial config), ask for each still-missing field one at a time, in this order: `token`, then `boardId`, then `orgId`. Wait for the answer before asking the next.

| Field | What to ask                                                                          |
|-------|--------------------------------------------------------------------------------------|
| `token` | "Please provide your eventmodelers API token (a UUID from your workspace settings)." |
| `boardId` | "Please provide the board ID you want to work with (the UUID from the board URL)."   |
| `orgId` | "Please provide your organization ID (the UUID from your organization settings)."    |
| `baseUrl` | Do **not** ask — default to `https://api.eventmodelers.ai` silently.                 |

Where to find the token: users generate API tokens in their workspace settings at the eventmodelers platform. The token is shown only once at creation time. It is a UUID and must belong to the same organization as the board.

---

## Step 3 — Persist config

Only reached when Step 2 collected at least one value interactively from the user. Once all values are collected, write the config file. When writing, merge with any existing config — do **not** overwrite fields that were provided as inline params with values from a previous config (the inline param is the user's explicit intent for this session, but the persisted value should reflect the most recently user-supplied value):

```bash
mkdir -p .eventmodelers
cat > .eventmodelers/config.json << 'EOF'
{
  "token": "<TOKEN>",
  "boardId": "<BOARD_ID>",
  "organizationId": "<ORG_ID>",
  "baseUrl": "<BASE_URL>"
}
EOF
```

Then ensure `.eventmodelers/config.json` is in `.gitignore`. Check whether it is already present:

```bash
grep -q ".eventmodelers/config.json" .gitignore 2>/dev/null || echo "MISSING"
```

If `MISSING`, append it:

```bash
echo ".eventmodelers/config.json" >> .gitignore
```

Tell the user: `"Config saved to .eventmodelers/config.json and added to .gitignore."`

---

## Step 3.5 — Register the MCP server

Always run this step (not only when Step 3 ran) — it's idempotent and safe to repeat every time `connect` is invoked.

The eventmodelers backend exposes the same board capabilities as an MCP server at `<BASE_URL>/mcp`, authenticated with the same `TOKEN` via an `x-token` header. Register it in the project's `.mcp.json` so Claude Code (or any other MCP-aware host) can connect and expose tools as `mcp__eventmodelers__<tool_name>`.

**Do not put the raw token in `.mcp.json`** — that file is typically committed to share server config with the team. Instead reference an environment variable and set the actual secret in `.claude/settings.local.json`'s `env` block:

1. Read the existing `.mcp.json` at the project root if present (it may already list other MCP servers, e.g. a browser-automation server used by `discover-storyboard` — merge into `mcpServers`, never replace the whole file). If absent, start from `{"mcpServers": {}}`.
2. Add or update the `eventmodelers` entry:
   ```json
   {
     "mcpServers": {
       "eventmodelers": {
         "type": "http",
         "url": "<BASE_URL>/mcp",
         "headers": { "x-token": "${EVENTMODELERS_TOKEN}", "x-agent-id": "${EVENTMODELERS_AGENT_ID}" }
       }
     }
   }
   ```
   Keep the `x-agent-id` line in even when this session has no `AGENT_ID`: an unset variable
   reaches the server as the literal `${EVENTMODELERS_AGENT_ID}` text, which it ignores (it only
   accepts a uuid), so the entry is the same for a human session and an agent's. Writing one
   `.mcp.json` for both is what keeps a second agent from inheriting the first one's id.
3. Read the existing `.claude/settings.local.json` if present and merge in — never clobber `permissions`/`enabledMcpjsonServers` or anything else already there. Ensure it has `EVENTMODELERS_TOKEN` set under `env` (create the file with just this key if it doesn't exist yet):
   ```json
   {
     "env": { "EVENTMODELERS_TOKEN": "<TOKEN>" }
   }
   ```
   Do **not** write `EVENTMODELERS_AGENT_ID` into this file. It is per running agent process, not
   per project: the CLI exports it for the agent it spawns, and a value frozen into a shared
   settings file would hand every session — including a second agent and the user's own — the
   same agent identity.
   A plain `.env` file does **not** work here — Claude Code never sources one, so a `${EVENTMODELERS_TOKEN}` placeholder in `.mcp.json` would be left unexpanded (sent as the literal `${EVENTMODELERS_TOKEN}` text), which fails auth and pushes the client into an OAuth flow the eventmodelers server can't satisfy for this client. `.claude/settings.local.json`'s `env` block — alongside the inherited shell environment — is the only thing Claude Code actually resolves `.mcp.json` placeholders against.
4. Ensure `.claude/settings.local.json` is listed in `.gitignore` (same check-then-append pattern as Step 3 uses for `.eventmodelers/config.json`) — it now holds the same secret and must never be committed. (Gitignored by Claude Code's own convention already, but don't rely on that silently.)

MCP tools only become visible to the current agent session after the host (re)connects to the server — a brand-new `.mcp.json` entry written mid-session may need the user to approve the new server or reconnect (e.g. Claude Code's `/mcp` command) before `mcp__eventmodelers__*` tools appear in the tool list. That's expected and not an error: tell the user once, then let every other skill fall back to curl automatically until the tools show up.

---

## Step 4 — Verify

Prefer verifying through MCP if `mcp__eventmodelers__*` tools are already visible in this session (e.g. from a `.mcp.json` set up in an earlier turn or a previous session):

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER" }
```

A successful result (even an empty array) confirms the token and board are valid. An error mentioning "not found or access denied" means the token/board pairing is wrong — treat it like the `403`/`404` curl cases below.

If the MCP server itself shows as needing authentication (e.g. the host lists it as "needs authentication" rather than connected), ask the user once:

> "The eventmodelers MCP server needs to be re-authenticated — please run `/mcp` and authenticate the `eventmodelers` server, then let me know when that's done."

Wait for their reply. If they say it's done, retry the MCP verify call above. If they skip it, or it still isn't connected, or it's unreachable for some other reason entirely (not an auth prompt), don't keep blocking on it — fall back to the equivalent curl call for this and every subsequent skill in the session, same as if the tools were never visible.

Otherwise (no MCP tools visible yet this session), fall back to the equivalent curl call:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: connect-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes?type=CHAPTER"
```

| Response | Action |
|----------|--------|
| `200` | Config is valid. Print one line: `"Connected — board <BOARD_ID>"` (note if MCP tools aren't active yet, curl fallback is in use) and return. |
| `401` | Token is invalid or missing. Tell the user and re-run from Step 2, clearing `token`. |
| `403` | Token organization does not match board. Tell the user to check that the token was issued for the correct workspace. Re-run from Step 2 for both fields. |
| `404` | Board not found. Tell the user and re-run from Step 2, clearing `boardId`. |
| Any other | Print the status code and raw response. Ask the user how to proceed. |

---

## Step 5 — Read the board once

Connecting is also where the session's read discipline starts. Every skill that runs after this one shares the same board, so **fetch it once and index it in memory** instead of re-deriving it per step:

- **Orientation** (what is where, how is it wired) — `get_board_outline { boardId, chapterId }`. One compact call per chapter: per-column node lists plus a flat edge list, no HTML pages or field bodies.
- **Working set** (you need `meta.fields`, examples, descriptions) — `get_nodes { boardId, chapterId }`. One call returns every node in the chapter with full `meta`, plus `node.position` and `node.parentId`. A whole 70-node board is well under 100 KB unscoped; scoped to a chapter it is smaller still.
- **A known, scattered subset** — `get_nodes { boardId, nodeIds: [...] }`. One call, not one per id.
- **Just names/types** — add `projection: "line"` (carries `sliceStatus` too). **Just a chapter's grid** — `get_node { nodeId: <chapterId>, projection: "cells" }`. **Just one node's wiring** — `get_node { nodeId, projection: "edges" }`.

**Orientation first, working set second — the two tiers are a sequence, not a choice.** "Where is the thing I was pointed at, and what sits around it" is an orientation question, and it is answered by `get_board_outline` or by `get_nodes` with `projection: "line"`. Answer it there, decide from it which nodes you are actually going to touch, and only then spend a full-`meta` read — `get_nodes` scoped by `chapterId`, or by `nodeIds` for a scattered handful — on those. Opening instead with an unscoped full-`meta` read drags every field body and every rendered HTML page on the board across the wire to work out which column someone poked at: the most expensive possible way to ask the cheapest question in the session.

**Each tier is once per session, not once per step.** A chapter's outline and grid don't change unless you or a human changes them, so keep the indexed result and answer later questions from memory; re-read only after a structural write (a node created, moved or deleted), and then only the part that moved. Three `get_board_outline` calls inside one turn means the first two were fetched and thrown away.

### The slice status comes with it

That same read tells you what you may write to. `get_nodes` returns `sliceStatus` per node and `get_board_outline` returns it per column, so index it alongside everything else:

**Only a slice in `Created` may be written to.** Any other status — `Planned`, `Assigned`, `InProgress`, `Review`, `Blocked`, `Done`, `Informational` — means someone is working on that slice: read its elements for context, but never change, move, rename or delete them, and never add scenarios, fields or examples to them. An element with **no** `sliceStatus` is in no slice at all, which is not the same as locked — that one is writable.

Never spend a `list_slices`/`get_slice_data` call to answer this; the board read already did.

`get_node` without a projection is for **one** node you did not already load — most often re-reading a node right after writing it. A step that issues it in a loop over nodes that were already in a list response is doing the same fetch N times; collapse it to the single chapter-scoped read above.

The same discipline applies to writes: `submit_node_events` takes `events[]`, so a multi-node edit is **one** call carrying every event, not one call per node. Pass `compact: true` when you don't need the per-node hash map back.

Where per-node calls genuinely can't be avoided, issue them together in one message so they run concurrently rather than in sequence.

### Ids and timestamps

Elements you create carry client-side ids, and every `node:created` event carries a timestamp. Mint them **once per turn, in a single call**, and take from that pool as you assemble the event array:

```bash
for i in $(seq 5); do uuidgen; done; echo $(( $(date +%s) * 1000 ))
```

Nothing in that depends on anything you're about to read, so splitting it across three shells is three round trips bought for nothing. Never reach for GNU-only `date` specifiers (`%N`, `%3N`) here: BSD/macOS `date` prints them literally instead of failing, so the malformed timestamp survives until something downstream rejects it.

---

## Config file format

`.eventmodelers/config.json`:
```json
{
  "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "boardId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "organizationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "baseUrl": "http://localhost:3000"
}
```

The `token` field is a secret. It is never logged or shown after initial confirmation.

---

## Security notes

- The config file (`.eventmodelers/config.json`) and `.claude/settings.local.json` (holding `EVENTMODELERS_TOKEN` under `env`) are both workspace-local and gitignored — never commit either.
- `.mcp.json` itself is safe to commit — it only ever contains the `${EVENTMODELERS_TOKEN}` placeholder, never the literal token.
- The token grants write access to all boards in its organization — treat it like a password.
- If a skill receives a `401`/`403` (curl) or an access-denied tool error (MCP) mid-session, re-invoke this skill to refresh the config before retrying.
