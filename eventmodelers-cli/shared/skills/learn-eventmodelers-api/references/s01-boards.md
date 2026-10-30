## 1. Boards

**File**: `src/slices/change/api-boards/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/events`
Persist board/timeline row events as an array of mixed event types.

**Request body**: Array of node, comment, edge, or board events  
**Response**: `200` — processed results array

---

### GET `/api/boards`
List all boards.

**Response**: `200` — `Board[]`

---

### DELETE `/api/org/:orgId/boards/:boardId`
Delete a board.

**Response**: `204`

---

### GET `/api/org/:orgId/boards/:boardId/events`
Get a page of board events in sequence order — **at most 300 per call**, oldest first. One call is not the whole log: to read it all, pass the last event's `seq` as `since` and repeat while the `X-Has-More` response header is `true`. `X-Page-Size` carries the page size that applied.

**Query params**:
- `since` (integer, optional) — only events with a `seq` greater than this
- `skipSilent` (boolean, default `true`) — `false` also includes events marked silent
- `seq` (integer, optional) — only the event of exactly this seq (silent or not); `since` and `skipSilent` are ignored

**Response**: `200` — event array (at most 300; at most one with `seq`, empty if there is none — `X-Has-More` is then `false`)
**Errors**: `400` `EVENT_SEQ_INVALID` — `seq` is not a non-negative integer

```bash
since=0
while :; do
  more=$(curl -s -D - -o page.json "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/events?since=$since" -H "x-token: $TOKEN" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="x-has-more"{print $2}')
  # ...use page.json...
  [ "$more" = "true" ] || break
  since=$(jq '.[-1].seq' page.json)
done
```

---

### GET `/api/org/:orgId/boards/:boardId/nodes/:nodeId/comments`
Get all comments for a node.

**Response**: `200` — comment array

---

### POST `/api/org/:orgId/boards/:boardId/nodes/:nodeId/comments`
Add one comment to one node.

**Request body**: `{ text: string, type?: 'COMMENT' | 'TASK' | 'QUESTION', author?: string }`
**Response**: `201` — `{ id }`

---

### POST `/api/org/:orgId/boards/:boardId/comments`
Post several comments, on any nodes of one board, in a single request — the batch form. Use it for a review that raises a question per element (`/wdyt`) instead of one request per comment.

**Request body**: `Array<{ nodeId: string, text: string, type?: 'COMMENT' | 'TASK' | 'QUESTION', author?: string }>`
**Response**: `201` — `{ results: Array<{ nodeId, id } | { nodeId, error }> }`, in request order

Entries are independent: one naming a node that doesn't exist is reported in `results` while the rest are still posted.

---

### POST `/api/org/:orgId/boards/:boardId/bucket`
Create a Supabase storage bucket for the board.

**Response**: `200` — `{ ok: boolean, bucket: string, alreadyExisted: boolean }`

---
