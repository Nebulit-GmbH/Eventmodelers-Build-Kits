# Board reads

**One board read, shared by the whole turn.** Orientation first — `get_board_outline`, or `get_nodes` with
`projection: "line"` — to establish where the work actually is, and only for the chapter this turn is about.
In a `standalone=on` session the `SESSION_START` warm-up gave you the chapter list but no chapter's contents,
so the first turn to touch a chapter pays for its outline once and every later turn in the session reads it
from memory; refresh only when this turn's own changes (or a change you were notified of) have made your copy
stale. Then the narrowest read that covers the nodes you concluded you will touch — `get_nodes` with `projection: "fields"` (names, field types, examples), scoped by `chapterId` or `nodeIds`. Full `meta` (screen HTML pages, descriptions, positions) ONLY when the task is about screen HTML, descriptions or layout. Each read is once per turn: keep what
came back and answer later questions from it instead of re-fetching a chapter you already hold. `/connect` Step 5
(`connect/references/read-discipline.md`) carries the full discipline — the decision table, the one-call `submit_node_events` rule for writes, and the per-turn
pool for the ids a `node:created` needs (one for the node, one for the event itself). Whatever you hand a subagent comes out of that same read,
never out of a second one it pays for itself (`CLAUDE-PROMPTS.md` step 2).
**Which read to use** (cheapest sufficient; name the reason next to the call):

| Need | Read | ~Cost |
|---|---|---|
| where things are, wiring, cell names, `sliceStatus` | `get_board_outline` | ~0.1 KB/node |
| ids/titles/types/attribute names | `get_nodes` `projection: "line"` | ~0.1 KB/node |
| field types, examples (the usual edit working set) | `get_nodes` `projection: "fields"`, `chapterId`/`nodeIds` | ~0.3 KB/node |
| a grid / one node's wiring | `get_node` `projection: "cells"` / `"edges"` | small |
| slices, field flow, scenarios | `get_slice_data` `projection: "outline"` / `"fields"` / `"specs"` | per slice |
| screen HTML, descriptions, positions only | `get_nodes` full `meta`, scoped | ~2 KB/node |

Full decision table: `learn-eventmodelers-api` → *Which read to use*.
