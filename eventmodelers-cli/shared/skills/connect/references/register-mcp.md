# Step 3.5 — Register the MCP server

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
