# Designing Automation Chains — curl Fallback Calls

Only needed when MCP is not connected. Every call below has an MCP equivalent in the main SKILL.md — always prefer that.

## Placement — todo-list READMODEL, one column before its automation

1. Fetch the chapter to find the interaction row ID (`timelineData.rows`, `type === "interaction"`) and confirm the cell one column before the automation is free.
2. If that column doesn't exist yet or its interaction row is occupied, insert a new column immediately before the automation's column (`{"index": automationColumnIndex}`, shifting the automation right).
3. `cellId = interactionRow.id + "-" + columnId`
4. Create the node:
   ```bash
   curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \
     -H "x-token: $TOKEN" -H "x-board-id: $BOARD_ID" -H "x-user-id: designing-automation-chains" \
     -H "Content-Type: application/json" \
     -d '[{
       "id":"<event-uuid>","eventType":"node:created","nodeId":"<node-uuid>",
       "boardId":"<BOARD_ID>","timestamp":1234567890,
       "chapterId":"<CHAPTER_ID>","cellId":"<interactionRowId>-<columnId>",
       "meta":{"type":"READMODEL","title":"NotificationsToSend","fields":[...]}
     }]'
   ```
