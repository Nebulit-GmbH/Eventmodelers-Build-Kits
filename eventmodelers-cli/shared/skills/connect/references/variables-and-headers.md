# Variables and headers

After running, the following variables are available for the rest of the session:

| Variable | Header sent to API | Description |
|----------|--------------------|-------------|
| `TOKEN` | `x-token` | API token UUID |
| `BOARD_ID` | — | Target board UUID (used in all board-scoped URLs) |
| `ORG_ID` | — | Organization UUID (used in all board-scoped URLs) |
| `BASE_URL` | — | Base URL, e.g. `http://localhost:3000` |
| `AGENT_ID` | `x-agent-id` | This agent process's own id, when running as one (Step 0.5). Optional — skip the header when there is no value. |
| `CHAT_SESSION_ID` | `x-chat-session-id` | The chat session the current work was made for — a prompt turn's `origin_session_id`, or an inline `session=`. Optional and **per turn**: unlike the values above it changes from one prompt to the next, is never persisted, and is absent for work that did not come from a chat — skip the header then. |

Every curl-fallback call in every skill must include these headers:
```
x-token: <TOKEN>
x-user-id: <skill-name>   ← set by each skill individually
x-agent-id: <AGENT_ID>    ← only when AGENT_ID resolved; omit the line entirely otherwise
x-chat-session-id: <CHAT_SESSION_ID>    ← only on writes for work that came from a chat; omit otherwise
```

`x-agent-id` is what makes the board say *which* agent did something: the platform stamps it on
every change the call writes, so the canvas shows this agent by name (rather than one anonymous
robot standing in for every agent at once), and a prompt a user addressed to one preferred agent
is only handed to the agent that claims it with that id.

`x-chat-session-id` is what ties a change to the conversation that asked for it: the platform stores
it on every board event the call writes, so the board's history can show which chat led to each
change. Only an active session of the call's own board is stored — one that doesn't exist, was
deleted or belongs to another board is silently dropped and the write goes ahead without it, so
there is nothing to handle on your side.

All board-scoped URLs follow the pattern: `<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/...`

When calling MCP tools instead, no `x-*` headers are needed per call — the MCP server resolves `ORG_ID` from `TOKEN` itself and every tool takes `boardId` as an explicit argument. (`x-agent-id` rides along with the registered server config from Step 3.5, so MCP writes are attributed too.) The chat session can't ride along that way — the server config is fixed for the whole session while `CHAT_SESSION_ID` changes per prompt — so every MCP **write** tool takes an optional `sessionId` argument instead: pass `CHAT_SESSION_ID` there on every write call while you have one, same rules as the header. See `learn-eventmodelers-api` for the full tool catalog.
