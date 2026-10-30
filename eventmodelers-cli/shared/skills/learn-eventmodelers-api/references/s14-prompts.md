## 14. Prompts

**File**: `src/slices/change/api-prompts/routes.ts`

Prompts are how a human submits work to a modeling agent from the board UI, and how that agent reports its lifecycle back onto the board. Every prompt row has a `status`: `ADDED` (submitted, default) → `CLAIMED` (an agent has picked it up) → `IN_PROGRESS` (an agent is actively working it) → `DONE` (finished) or `FAILED` (not resolved, whether nothing or only part of it could be done — the board keeps the agent task, red, instead of fading it out). See the `update-prompt-status` skill for the agent-side half of this lifecycle.

### POST `/api/org/:orgId/prompts`
Submit a prompt for a board timeline. Auth: Supabase JWT (`Authorization: Bearer`).

**Request body**:
```typescript
{
  prompt: string
  board_id: string
  timeline_id: string
  node_id?: string
  comment_id?: string
  priority?: boolean          // default false
  hidden?: boolean            // default false — agent-only task, never returned to a client
  context?: {                 // optional canvas-selection context for the agent to use
    selectedCell?: object | null
    selectedNodes?: string[]  // every element selected when the prompt was sent
    timelineId?: string | null
    focusArea?: {             // what was on screen at submit time — orientation, not a task
      nodes: { id: string, title?: string, type?: string }[]
      truncated: boolean      // more were visible than the list holds (cap: 15)
    }
  }
}
```

`context` is stored and handed back verbatim — the backend validates only the *shape* of
`selectedCell`/`selectedNodes`/`timelineId` and passes everything else (`focusArea` included)
through opaquely, so new context fields need no backend change.

`focusArea.nodes` is ordered by how much each element says about where the user is, not by
position alone: chapters first, then the model itself (`COMMAND`, `READMODEL`, `QUERY`,
`EVENT`), then specs (`SCENARIO`, `SPEC_*`), then everything else (screens, notes, drawings,
slice frames); within one of those tiers, nearest the centre of the view first. Every entry
carries its `type`, so a chapter is told from a command without a second lookup.

`hidden: true` marks an agent-only task: still claimed by `/prompts/next` like any other
prompt, but excluded from every client read (and from Supabase's `prompts_select` RLS policy),
so it never shows up in the user's prompt list.

**Response**: `201` — the created row, `status: "ADDED"`.
**Errors**: `400` missing required fields or malformed `context` · `403` no access to board · `404` board/timeline not found or no API token configured for the org

**A chat message can arrive with no chapter** (the person had none in view). Creating work from it then fails with `400 TIMELINE_ID_REQUIRED`. Do not guess a chapter and do not stop: if the board has chapters, ask which one is meant with `post_chat_message` (`replyTo` the message; a `poll` snippet listing the chapters works well), then continue with the chapter they pick. Only when the board has no chapter at all, create one first.

---

### GET `/api/org/:orgId/prompts/next`
Claim the next pending (`ADDED`) prompt for a board — atomically flips it to `CLAIMED` and returns it. This is what a running modeling agent's warm loop polls. Auth: `x-token` **and** a Supabase JWT (`Authorization: Bearer`) together.

Send `x-agent-id` here too: a prompt the user addressed to one preferred agent (`prompts.agent_id`) is only ever handed to the agent claiming with that id, and a caller without the header claims untargeted prompts only. Addressing one is `POST /api/org/:orgId/prompts` with `agent_id: "<uuid>"` — the board's prompts panel does it when someone stars an agent.

Note what this endpoint does *not* do: an agent that sends its id still gets every untargeted prompt on top of its own. A caller that wants only what was addressed to it has to hand the rest back itself (`POST /prompts/:id/status` with `status: 'ADDED'`), which is what `eventmodelers run --exclusive` does.

The claim records its holder: `claimed_by` is the caller's `x-agent-id` (`null` if it sent none) and `claimed_at` the time. That is what tells a prompt an agent is working from one a crashed agent left behind. Before claiming, this endpoint puts prompts whose known holder has **no live heartbeat** (and that were claimed more than 45 s ago) back to `ADDED`; a prompt with no recorded holder is never handed back, and an agent that is still pinging keeps its prompts however long a turn takes. An agent that restarts under the same id finds what it was holding with `GET /prompts?claimed_by=<its id>&status=CLAIMED,IN_PROGRESS` and hands it back itself.

**Query params**: `board_id` (required)
**Response**: `200` — the claimed row (now `status: "CLAIMED"`), including its parsed `context` and the `hidden` flag · `404` — no `ADDED` prompts available

---

### GET `/api/org/:orgId/prompts`
List a board's prompts **with their status** — the only way to read a prompt's status. Read-only: nothing is claimed. Auth: `x-token` **and** a Supabase JWT (`Authorization: Bearer`) together, like `/prompts/next` — an agent uses the realtime token it already holds. A status write is unconditional (`CLAIMED` → `ADDED` works on a `DONE` prompt too), so an agent that wants to hand back prompts a crash left it holding looks here first and releases only the ones still `CLAIMED` / `IN_PROGRESS`.

**Query params**: `board_id` (required) · `status` (optional, comma-separated subset of `ADDED`,`CLAIMED`,`IN_PROGRESS`,`DONE`) · `ids` (optional, comma-separated prompt ids, at most 200 — only these prompts of the board come back; an empty value asks about none, and the id of another board's prompt matches nothing) · `claimed_by` (optional, an agent id — only the prompts that agent holds) · `limit` (optional, default 200, max 500)
**Response**: `200` — `{ "prompts": [ … ] }`, each row with `id`, `status`, `agent_id` (who it is addressed to), `claimed_by` / `claimed_at` (who holds it and since when), `priority`, `creation_time`, `node_id`, `comment_id`, the progress `comment` and the parsed `context`. Ordered like the claim: priority first, then oldest first.
**Errors**: `400` missing `board_id`, unknown status (`PROMPT_STATUS_INVALID`), more than 200 ids or a bad `limit` · `403` the board is not in the token's organization

---

### POST `/api/org/:orgId/prompts/:id/status`
Set a prompt's status, optionally attaching a progress comment. Auth: `x-token` only (bot token — no user JWT needed, this is meant to be called directly by the agent working the prompt).

**Prefer MCP**: `mcp__eventmodelers__update_prompt_status { "promptId": "<id>", "newStatus": "IN_PROGRESS", "comment": "..." }` — no `orgId`/`x-token` needed, same validation and response shape. Fall back to the curl below only when MCP tools aren't connected.

**Request body**:
```typescript
{
  status: 'ADDED' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE'
  comment?: string   // shown alongside the prompt in the board UI
}
```

Setting `ADDED` hands the prompt back to the queue and clears `claimed_by` / `claimed_at`; the other statuses leave the holder as it was.

**Response**: `200` — the updated row
**Errors**: `400` invalid/missing `status` · `403` token not for this prompt's org · `404` prompt not found · `409` (`PROMPT_STATUS_ALREADY_SET`) the prompt already carries that status — another agent already made this transition, so don't retry it

---

### DELETE `/api/org/:orgId/prompts/:id`
Delete a prompt outright. Auth: `x-token` only. Manual/admin cleanup — not part of the normal agent lifecycle (use the status endpoint above instead).

**Response**: `204` · `404` prompt not found

---

### DELETE `/api/org/:orgId/prompts/:id/user`
Delete a prompt you submitted yourself. Auth: Supabase JWT — only deletes rows owned by the calling user.

**Response**: `204` · `404` prompt not found or not yours

---

### GET `/api/org/:orgId/prompts/realtime-token`
Exchange an `x-token` for a short-lived Supabase-compatible JWT, used to subscribe to the org's realtime channel for live prompt notifications. Auth: `x-token` only.

**Response**: `200` — `{ token: string }`

---

### POST `/api/agent-alive`
Record a heartbeat ping for a running modeling/build agent. Auth: Supabase JWT (`Authorization: Bearer`) — exchange the `x-token` for one first via `GET /api/org/:orgId/prompts/realtime-token` above; a raw `x-token` alone is not accepted here.

**Body**: `{ token: string, board_id?: string, agent_type: 'MODELING' | 'BUILD', agent_id: string, agent_name?: string, status?: 'idle' | 'modeling' | 'building' | 'shutting_down' }`
**Response**: `200` — `{ ok: true }`
**Errors**: `400` `agent_id`/`agent_type` missing · `404` token not found

`status` is what the agent is doing right now, rewritten on every ping: `idle` while it waits, `modeling` while it changes the model (a prompt, a chat reply), `building` while it builds a slice, `shutting_down` on its last ping before it exits. Missing or anything else reads as `idle`. The CLI pings every 15s and sends one at once when a turn starts or ends.

`agent_id` is the client's own stable id (the heartbeat is keyed on `token` + `agent_id` + `agent_type`); `agent_name` is an optional display name for it, so the board can show which agent is live instead of a bare uuid. Both are overridable per run via `eventmodelers run --id/--name`.

The same `agent_id` belongs in the `x-agent-id` header of every board call this agent makes: the heartbeat says the agent is alive, the header says which of the incoming calls are its. Without it a write is attributed to "some agent", every live agent shares one presence identity on the board, and prompts addressed to a preferred agent are never claimed.

---

### GET `/api/org/:orgId/boards/:boardId/agent-alive`
Check whether an agent has pinged for a board within the last 45s. Auth: Supabase JWT (`Authorization: Bearer`) — same as the heartbeat above; a raw `x-token` alone is not accepted here either.

**Response**: `200` — `{ alive: boolean, agentTypes: string[], agents: { agentId: string, agentType: string, agentName: string | null, status: 'idle' | 'modeling' | 'building' | 'shutting_down' }[] }` — one `agents` entry per live agent process, `agentTypes` the de-duplicated set of their types

---
