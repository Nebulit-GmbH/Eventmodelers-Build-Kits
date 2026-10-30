# Step 4 — Verify

Prefer verifying through MCP if `mcp__eventmodelers__*` tools are already visible in this session (e.g. from a `.mcp.json` set up in an earlier turn or a previous session):

```
mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER", "projection": "line" }
```

(`projection: "line"` because this is only an access check — without it every chapter's full grid comes back.)

A successful result (even an empty array) confirms the token and board are valid. An error mentioning "not found or access denied" means the token/board pairing is wrong — treat it like the `403`/`404` curl cases below.

If the MCP server itself shows as needing authentication (e.g. the host lists it as "needs authentication" rather than connected), ask the user once:

> "The eventmodelers MCP server needs to be re-authenticated — please run `/mcp` and authenticate the `eventmodelers` server, then let me know when that's done."

Wait for their reply. If they say it's done, retry the MCP verify call above. If they skip it, or it still isn't connected, or it's unreachable for some other reason entirely (not an auth prompt), don't keep blocking on it — fall back to the equivalent curl call for this and every subsequent skill in the session, same as if the tools were never visible.

Otherwise (no MCP tools visible yet this session), fall back to the equivalent curl call:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: connect-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes?type=CHAPTER&projection=line"
```

| Response | Action |
|----------|--------|
| `200` | Config is valid. Print one line: `"Connected — board <BOARD_ID>"` (note if MCP tools aren't active yet, curl fallback is in use) and return. |
| `401` | Token is invalid or missing. Tell the user and re-run from Step 2, clearing `token`. |
| `403` | Token organization does not match board. Tell the user to check that the token was issued for the correct workspace. Re-run from Step 2 for both fields. |
| `404` | Board not found. Tell the user and re-run from Step 2, clearing `boardId`. |
| Any other | Print the status code and raw response. Ask the user how to proceed. |
