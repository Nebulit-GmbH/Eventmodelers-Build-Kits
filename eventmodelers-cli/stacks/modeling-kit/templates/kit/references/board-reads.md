# Board reads

**One board read, shared by the whole turn.** Orientation first — `get_board_outline`, or `get_nodes` with
`projection: "line"` — to establish where the work actually is, and only for the chapter this turn is about.
In a `standalone=on` session the `SESSION_START` warm-up gave you the chapter list but no chapter's contents,
so the first turn to touch a chapter pays for its outline once and every later turn in the session reads it
from memory; refresh only when this turn's own changes (or a change you were notified of) have made your copy
stale. Then a single full-`meta` `get_nodes`, scoped by
`chapterId` or `nodeIds`, covering the nodes you concluded you will touch. Both tiers are once per turn: keep what
came back and answer later questions from it instead of re-fetching a chapter you already hold. `/connect` Step 5
carries the full discipline — the two tiers, the one-call `submit_node_events` rule for writes, and the per-turn
pool for the ids a `node:created` needs (one for the node, one for the event itself). Whatever you hand a subagent comes out of that same read,
never out of a second one it pays for itself (`CLAUDE-PROMPTS.md` step 2).
**Pick every read by what the step needs, cheapest first**: `get_nodes` `projection: "line"` for ids/titles/types/
attribute names, `get_node` `projection: "cells"` for a grid and `"edges"` for one node's wiring, and
`get_slice_data` `projection: "outline"` / `"fields"` / `"specs"` instead of the full graph unless the step needs
elements, specs and comments together. The decision table is in `learn-eventmodelers-api` → *Which read to use*.
