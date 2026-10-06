# Attributes — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## 3a — Use Node Edges

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$EDGE_SOURCE_ID?projection=edges" \
  -H "x-token: $TOKEN" -H "x-user-id: attributes-skill"
```

`projection=edges` returns `{nodeId, edges}` — the node's inbound/outbound connections only, no content (the full node record carries no edges). Fields for Step 4 come from the chapter-scoped `GET .../nodes?chapterId=` read.

## Step 4 — Apply the Change to Each Node in the Chain

Write the payload with the **Write tool** to `/tmp/attributes_payload.json` — a plain JSON file, so nothing needs shell escaping (the agent's Bash allowlist refuses `python3 -` scripts). Give the event a fresh id (`uuidgen`):

```json
[{
  "id": "<fresh uuid>",
  "eventType": "node:changed",
  "nodeId": "<NODE_ID>",
  "changedAttributes": ["meta.fields"],
  "meta": { "fields": <updated_fields> }
}]
```

Then POST it:

```bash
curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: $EVENTMODELERS_TOKEN" \
  -H "x-user-id: attributes-skill" \
  --data-binary @/tmp/attributes_payload.json
```
