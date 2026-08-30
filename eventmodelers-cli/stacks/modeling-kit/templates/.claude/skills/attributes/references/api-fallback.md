# Attributes — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## 3a — Use Node Edges

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$EDGE_SOURCE_ID" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: attributes-skill"
```

## Step 4 — Apply the Change to Each Node in the Chain

Build the payload with Python to avoid JSON escaping issues, then POST it:

```bash
python3 - <<EOF > /tmp/attributes_payload.json
import json, time, uuid
payload = [{
  "id": str(uuid.uuid4()),
  "eventType": "node:changed",
  "nodeId": "<NODE_ID>",
  "boardId": "<BOARD_ID>",
  "timestamp": int(time.time() * 1000),
  "changedAttributes": ["meta.fields"],
  "meta": {
    "fields": <updated_fields_as_python_list>
  }
}]
print(json.dumps(payload))
EOF

curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "Content-Type: application/json" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: attributes-skill" \
  --data-binary @/tmp/attributes_payload.json
```
