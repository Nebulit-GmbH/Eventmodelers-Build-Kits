# Step 0.5 — Resolve AGENT_ID (agents only)

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
