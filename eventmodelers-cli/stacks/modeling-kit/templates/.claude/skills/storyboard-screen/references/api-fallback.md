# Storyboard Screen Designer — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — Load existing description

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$NODE_ID/description" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent"
```

- `200` — returns the previously stored `{ elements: [...] }`. Use this as the base and apply only the requested change (e.g. edit one element's `text`/`fill`, add/remove a specific element) — leave everything else untouched.
- `404` — no description stored yet (e.g. an older screen rendered before this endpoint existed, or a placeholder node). Fall back to designing from scratch in Step 3.

## Step 4 — Render the sketch

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$NODE_ID/sketch" \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '{"description": "<what this screen shows>", "elements": [...]}'
```

Expect `204 No Content` on success.

## Step 5 — Define field data lineage

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
  -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: agent" \
  -H "Content-Type: application/json" \
  -d '[{
    "id": "<event-uuid>", "eventType": "node:changed", "nodeId": "<NODE_ID>",
    "boardId": "<BOARD_ID>", "timestamp": <NOW_MS>,
    "changedAttributes": ["meta.fields"],
    "meta": { "type": "SCREEN", "fields": [
      {"name": "status", "type": "String", "example": "confirmed", "mapping": "ActiveReservationView.status", "cardinality": "Single"}
    ] }
  }]'
```
