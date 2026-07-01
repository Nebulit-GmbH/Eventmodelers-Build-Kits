---
name: learn-eventmodelers-api
description: Teaches an agent everything about the eventmodelers platform API — all endpoints, their purpose, request payloads, response shapes, authentication, and element types.
---

# Eventmodelers Platform API

**Before making any API calls, invoke the `connect` skill** to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`.

```bash
# Variables produced by the connect skill:
TOKEN=<api-token>   BASE_URL=https://api.eventmodelers.ai
ORG_ID=<orgId>   BOARD_ID=<boardId>   NODE=<nodeId>
```

**Auth headers** (required on every request):
```
x-token: $TOKEN
x-board-id: $BOARD_ID
x-user-id: <skill-name>
```

All board-scoped URLs: `$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/...`

---

## Boards

```bash
curl $BASE_URL/api/boards -H "x-token: $TOKEN"
curl -X DELETE $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID -H "x-token: $TOKEN"
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/events -H "x-token: $TOKEN"
curl "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/events/search?name=OrderPlaced" -H "x-token: $TOKEN"
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/bucket -H "x-token: $TOKEN"

# Post board events (nodes / comments / edges)
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/events \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '[{"eventType":"node:created","nodeId":"<uuid>","boardId":"'$BOARD_ID'","timestamp":1234567890}]'
```

---

## Comments

```bash
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE/comments -H "x-token: $TOKEN"

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE/comments \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Needs clarification","type":"TASK","author":"alice"}'
# type: COMMENT | TASK | QUESTION — returns 201 {"id":"<commentId>"}

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE/comments/$CID/resolve \
  -H "x-token: $TOKEN"

curl -X DELETE $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE/comments/$CID \
  -H "x-token: $TOKEN"
```

---

## Chapters & Timelines

> **Cell ID convention**: Cell IDs are always implicit — computed as `<rowId>-<columnId>` (the row UUID, a hyphen, then the column UUID). Never search `timelineData.cells` to find a cell ID; just concatenate: `cellId = rowId + "-" + columnId`. The `cells` array in `timelineData` is still useful for checking whether a cell is occupied (`nodeId` present), but never for deriving the cell's own ID.

```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/chapters \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" -d '{}'

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" -d '{"index":2}'

curl -X DELETE $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns/$COL \
  -H "x-token: $TOKEN"

# Move a column to a new 0-based index within the timeline
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns/$COL/move \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"toIndex":2}'
# → 200 on success · 400 same index or out of range · 404 timeline/column not found

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/lanes \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"swimlane","label":"Domain Events"}'
# type: actor | interaction | swimlane | spec | feedback

# Move a lane (row) to a new 0-based index within the timeline
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/lanes/$ROW/move \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"toIndex":1}'
# → 200 on success · 400 same index or out of range · 404 timeline/row not found

# $CELL = <rowId>-<columnId>  (computed, not looked up)
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/cells/$CELL/drop \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"nodeId":"<uuid>","nodeType":"EVENT"}'
# swimlane→EVENT  interaction→COMMAND/READMODEL  actor→SCREEN/AUTOMATION

# Update canvas position of a timeline node
curl -X PUT $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/position \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"x":100,"y":200}'
# → { timelineId, x, y }
# timeline:position-changed event is emitted
```

---

## Connections (Edges)

**Edge style** — always include this style when creating edges via `edge:added` events:
```json
{
  "style": {
    "stroke": "#000000",
    "strokeColor": "#000000",
    "strokeStyle": "normal",
    "strokeWidth": 4,
    "endStrokeCap": "arrow",
    "startStrokeCap": "none",
    "opacity": 1
  }
}
```
> The high-level `/connections` endpoint and MCP `connect_nodes` tool do not accept style — use `edge:added` events (via `/nodes/events` or MCP `post_board_events`) when style is needed.

```bash
# Connect two nodes — direction is auto-corrected to the valid orientation
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"<nodeUuid>","target":"<nodeUuid>"}'
# → 201 { edgeId, source, target, created: true }   (new edge)
# → 200 { edgeId, source, target, created: false }   (already existed)
# → 400 { error, hint }  if the connection type is not allowed
# Allowed: COMMAND→EVENT · SCREEN→COMMAND · EVENT→READMODEL · READMODEL→SCREEN · READMODEL→AUTOMATION · AUTOMATION→COMMAND
# Both nodes must belong to the same timeline.

# Remove an edge — direction is checked both ways
curl -X DELETE $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/connections \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"<nodeUuid>","target":"<nodeUuid>"}'
# → 200 { removed: true }  or  { removed: false }  (no edge existed — not an error)
```

---

## Nodes

```bash
curl "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=EVENT" -H "x-token: $TOKEN"
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$NODE -H "x-token: $TOKEN"

# Create/update node
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events \
  -H "x-token: $TOKEN" -H "x-user-id: $USER_ID" -H "Content-Type: application/json" \
  -d '[{"id":"<uuid>","eventType":"node:created","nodeId":"<uuid>","boardId":"'$BOARD_ID'","timestamp":1234567890,"meta":{"type":"EVENT","title":"OrderPlaced"},"chapterId":"<id>","cellName":"B2"}]'
# eventType: node:created | node:changed | node:deleted

# Valid meta.type values (required on node:created, validated on node:changed):
# MODEL_CONTEXT | CHAPTER | ACTOR | AUTOMATION | API | SCREEN
# COMMAND | EVENT | SPEC_ERROR | TABLE | READMODEL | SCENARIO | LANE | SLICE_BORDER
# Omitting or supplying an unknown type returns 400.
```

#### Field object format (`meta.fields`)

Each entry in `meta.fields` on a COMMAND/EVENT/READMODEL/SCREEN node:
```json
{
  "name": "customerId",
  "type": "String",
  "cardinality": "Single",
  "example": "cust-42",
  "mapping": "session:customerId",
  "generated": false,
  "optional": false,
  "query": false,
  "edited": false,
  "subfields": [],
  "idAttribute": false,
  "showAttributes": false,
  "technicalAttribute": false
}
```
`cardinality` is one of `"Single"` (default) or `"List"` — use `"List"` only when the field genuinely holds multiple values (an array, a repeated line item). When in doubt, use `"Single"`.

Only add the fields an element actually needs at creation time — its identity key plus the facts the business/consumer cares about right now. Do not front-load every conceivable field; add more later with the `/attributes` skill as the model matures.

---

## Slices

```bash
# type: state-change (SCREEN+COMMAND+EVENT) | state-view (SCREEN+READMODEL+EVENT) | automation (AUTOMATION+COMMAND+EVENT)
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slices \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"state-change","nodes":{"swimlane":{"title":"OrderPlaced"}}}'
```

---

## Specifications (GWT)

Specs are scoped to a **timeline** and placed in a column's `spec` row — no context or slice name needed.

```bash
# List valid given/when/then elements for a timeline (EVENT, COMMAND, READMODEL)
curl "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/spec-info" \
  -H "x-token: $TOKEN"
# → { timelineId, elements: [{ id, title, type }] }

# Append one or more GWT scenarios to a column's spec cell.
# The SCENARIO spec node is created automatically — no pre-creation step needed.
# Body: a single scenario object OR an array of scenario objects.
curl -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns/$COL/scenarios" \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '[
    {
      "id": "<uuid>",
      "title": "Happy path",
      "given": [{"id":"<eventNodeId>","title":"OrderPlaced","type":"EVENT"}],
      "when":  [{"id":"<commandNodeId>","title":"PlaceOrder","type":"COMMAND"}],
      "then":  [{"id":"<eventNodeId2>","title":"OrderConfirmed","type":"EVENT"}]
    },
    {
      "id": "<uuid>",
      "title": "Insufficient stock",
      "given": [{"id":"<eventNodeId>","title":"OrderPlaced","type":"EVENT"}],
      "when":  [{"id":"<commandNodeId>","title":"PlaceOrder","type":"COMMAND"}],
      "then":  [],
      "expectError": true,
      "errorDescription": "Stock below requested quantity"
    }
  ]'
# → 201 { specNodeId, scenarios (all), added (count), isNewNode }
```

**Step item format** — each item in `given`, `when`, `then`:
```json
{ "id": "<board-node-uuid>", "title": "OrderPlaced", "type": "EVENT", "fields": [], "specRow": 0 }
```
`id` is required (board node UUID). `title` and `type` are informational only.

**Rules enforced by the server:**
- `given`: EVENT nodes only, all from the same timeline as `$TL`
- `when`: at most one COMMAND; must be empty when `then` contains a READMODEL
- `then`: EVENTs only **or** exactly one READMODEL — never mixed
- Error-case scenarios: set `expectError: true` and leave `then: []`
- Scenario `title` must be unique within the spec node (checked across all new + existing)
- All referenced node IDs must exist on the board and belong to timeline `$TL`

**Errors:** `400` validation · `404` timeline, column, or referenced node not found · `409` duplicate scenario title

> **Multiple spec rows:** The `/scenarios` endpoint always targets the **first** spec row in a column. If the chapter has multiple spec rows and you need to target a different one, use `node:changed` directly on that spec node's `meta.givenWhenThenScenario` via `/nodes/events`.

#### Scenario object format

**Happy path:**
```json
{
  "id": "<uuid>", "title": "...", "vertical": false,
  "given": [...], "when": [...], "then": [...],
  "comments": []
}
```

**Error case** (business rule violation):
```json
{
  "id": "<uuid>", "title": "...", "vertical": false,
  "given": [...], "when": [...], "then": [],
  "expectError": true, "errorDescription": "<human-readable message>",
  "examples": [], "expectEmptyList": false, "comments": []
}
```

#### Step item format

Each item in `given`, `when`, `then` must use the **board node UUID**:
```json
{ "id": "<board-node-uuid>", "title": "OrderPlaced", "type": "EVENT", "fields": [{"name":"locale","type":"String","example":"nl_NL"}], "specRow": 0 }
```
`id` is required. `title`, `type`, `fields`, and `specRow` are informational.

| Step | Allowed `type` |
|------|----------------|
| `given` | `EVENT` |
| `when`  | `COMMAND` |
| `then` (happy path) | `EVENT` or `READMODEL` |
| `then` (error case) | leave empty — use `expectError: true` on the scenario |
| `then` (spec error item) | `SPEC_ERROR` with `title`, `description`, `fields: []` |

#### Mapping config IDs to board node IDs

If working from a slice config file where items use config-internal IDs, build a lookup first:
```
config_command_id → board COMMAND node ID  (from chapter cells for that column)
config_event_id   → board EVENT node ID    (from chapter cells for that column)
config_rm_id      → board READMODEL node ID
```
Type name mapping from config → board: `WHEN` → `COMMAND`, `GIVEN` → `EVENT`, `THEN` → `EVENT`.

---

## Images / Sketches

```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$IMG \
  -H "x-token: $TOKEN" -F "file=@image.png"

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/images/$IMG/sketch \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"Login form","elements":[{"type":"rectangle","x":1,"y":1,"w":10,"h":5}]}'

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/image-nodes/$NODE/sketch \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"chapterId":"<id>","cellName":"A1","description":{"elements":[]}}'
```

---

## Slice Data

```bash
curl "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=Ordering" -H "x-token: $TOKEN"
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices -H "x-token: $TOKEN"
```

---

## Snapshots  (max 3 · 30d · 50MB)

```bash
curl $BASE_URL/api/snapshots -H "x-token: $TOKEN"
curl -X POST $BASE_URL/api/snapshots -H "x-token: $TOKEN" \
  -F "payloadFile=@board.json" -F "name=my-snapshot" -F "retention=7"
curl -X PATCH $BASE_URL/api/snapshots/$SID/share -H "x-token: $TOKEN"
curl -X DELETE $BASE_URL/api/snapshots/$SID -H "x-token: $TOKEN"
```

---

## Prompts & Agent

```bash
# Submit prompt
curl -X POST $BASE_URL/api/org/$ORG_ID/prompts \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt":"Add OrderShipped event","board_id":"'$BOARD_ID'","timeline_id":"<id>","node_id":"<id>","comment_id":"<id>"}'

# Dequeue next prompt (agent)
curl $BASE_URL/api/org/$ORG_ID/prompts/next -H "x-token: $TOKEN"

# Delete processed prompt (agent)
curl -X DELETE $BASE_URL/api/org/$ORG_ID/prompts/$PID -H "x-token: $TOKEN"

# Cancel own prompt
curl -X DELETE $BASE_URL/api/org/$ORG_ID/prompts/$PID/user -H "x-token: $TOKEN"

# Realtime token (agent)
curl $BASE_URL/api/org/$ORG_ID/prompts/realtime-token -H "x-token: $TOKEN"

# Heartbeat
curl -X POST $BASE_URL/api/agent-alive \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"token":"'$TOKEN'"}'

# Check agent alive
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/agent-alive -H "x-token: $TOKEN"
```

---

## Extensions

```bash
curl $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/extensions -H "x-token: $TOKEN"
curl -X PUT $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/extensions/git \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" -d '{"enabled":true}'
```

---

## User Management

```bash
# Commands → {ok, next_expected_stream_version, last_event_global_position}
curl -X POST $BASE_URL/api/creategroup -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"groupId":"<uuid>","name":"My Team"}'
curl -X POST $BASE_URL/api/inviteuser -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"groupId":"<uuid>","email":"user@example.com","invitationId":"<uuid>"}'
curl -X POST $BASE_URL/api/acceptinvite -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"<uuid>","groupId":"<uuid>","invitationId":"<uuid>"}'
curl -X POST $BASE_URL/api/assignrole -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"<uuid>","groupId":"<uuid>","role":"admin"}'

# Read models (add ?_id= to filter)
curl $BASE_URL/api/query/group-details-lookup -H "x-token: $TOKEN"
curl $BASE_URL/api/query/open-invites -H "x-token: $TOKEN"
curl $BASE_URL/api/query/user-group-assignments -H "x-token: $TOKEN"
curl $BASE_URL/api/query/users-to-assign-to-groups -H "x-token: $TOKEN"
```

---

## Utility

```bash
curl $BASE_URL/api/user -H "x-token: $TOKEN"   # current user
curl $BASE_URL/swagger.json                      # OpenAPI spec
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/import-config \
  -H "x-token: $TOKEN" -F "file=@config.json"
```