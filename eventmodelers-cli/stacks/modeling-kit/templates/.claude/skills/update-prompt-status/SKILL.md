---
name: update-prompt-status
description: Update the lifecycle status (and optionally a progress comment) of a prompt on an eventmodelers board
---

# Update Prompt Status

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__update_prompt_status` when available (registered by the `connect` skill) — the curl block below is the fallback for sessions without MCP connected. This is the one prompt-queue operation MCP does expose (submission, claiming, and deletion remain curl-only — the MCP server otherwise doesn't own this lifecycle).

Every prompt drained from a board's queue (`/api/org/:orgId/prompts/next`) carries a `PROMPT_ID` — passed into this session as the `prompt_id` field of the current turn. This skill flips that prompt's status so the board UI reflects what the agent is doing with it in real time.

---

## Step 1 — Parse arguments

From `$ARGUMENTS` or the calling context, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `PROMPT_ID` | this turn's `prompt_id` field | **required** |
| `newStatus` | target status | **required** |
| `comment` | optional progress note to attach | none |

Valid `newStatus` values (case-sensitive):

| Value | Meaning |
|-------|---------|
| `ADDED` | Default — submitted, not yet claimed. You should never need to set this yourself. |
| `CLAIMED` | Already set automatically when `/api/org/:orgId/prompts/next` hands you the prompt — you should never need to set this yourself either. |
| `IN_PROGRESS` | You have started working on this prompt. |
| `DONE` | You have finished working on this prompt. |

If `newStatus` is not one of these exact values, stop and tell the user the valid options.

---

## Step 2 — Update the status

**Prefer MCP:**
```
mcp__eventmodelers__update_prompt_status { "promptId": "<PROMPT_ID>", "newStatus": "<newStatus>", "comment": "<comment>" }
```
Omit `comment` entirely when there isn't one — don't pass an empty string.

**Fallback (no MCP):**
```bash
curl -s -X POST "$BASE_URL/api/org/$ORG_ID/prompts/$PROMPT_ID/status" \
  -H "Content-Type: application/json" \
  -H "x-token: $TOKEN" \
  -d '{"status":"<newStatus>"<comment ? ,"comment":"<comment>" : "">}'
```

Response: `200` — the updated prompt row (includes `status`, `comment`).

### Error handling

| Response | Meaning | Action |
|----------|---------|--------|
| `400` | `status` missing or not a valid value | Fix the value and retry — do not retry with the same bad value. |
| `404` | Prompt not found | The prompt may have been deleted by its author while you were working. Report this and move on — do not treat it as a failure of your actual task work. |
| `401`/`403` | Token invalid or wrong organization | Re-run `connect` to refresh credentials, then retry once. |

---

## Step 3 — Report back

Tell the user (or, in an autonomous modeling session, just note it in the turn's progress line):

- **Prompt**: `PROMPT_ID`
- **New status**: `newStatus`
- **Comment**: the comment text, if any
- **Outcome**: `SUCCESS`, `NOT_FOUND`, or `ERROR`

Example:
```
Prompt a1b2c3d4-… → IN_PROGRESS
```
```
Prompt a1b2c3d4-… → DONE
Comment: Added the "Order Placed" event and wired it to the read model.
```
