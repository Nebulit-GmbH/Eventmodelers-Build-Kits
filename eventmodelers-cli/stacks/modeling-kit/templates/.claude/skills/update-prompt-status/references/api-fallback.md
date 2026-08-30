# Update Prompt Status — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Step 2 — Update the Status

```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/prompts/$PROMPT_ID/status" \
  -H "Content-Type: application/json" \
  -H "x-token: $TOKEN" \
  -d '{"status":"<newStatus>"<comment ? ,"comment":"<comment>" : "">}'
```

Response: `200` — the updated prompt row (includes `status`, `comment`).
