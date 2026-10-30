# Step 5 — Read the board once

Connecting is also where the session's read discipline starts. Every skill that runs after this one shares the same board, so **fetch it once and index it in memory** instead of re-deriving it per step.

**Default to the cheapest read that answers the step. Full `meta` is the exception, not the working set.** Full `meta` (rendered HTML pages, descriptions, positions, field bodies) costs about 2 KB per node — ~1 MB on a 500-node board — and is only needed when the task is about screen HTML, descriptions or layout.

| You need | Read | Approx. cost |
|---|---|---|
| What is where, how it is wired, cell names, `sliceStatus` | `get_board_outline { boardId, chapterId }` | ~0.1 KB/node, one call per chapter |
| Names / types / attribute names; find or dedupe by title | `get_nodes { …, projection: "line" }` | ~0.1 KB/node |
| Field types, examples, idAttribute, field descriptions | `get_nodes { chapterId \| nodeIds, projection: "fields" }` | ~0.3 KB/node |
| A known, scattered subset | `get_nodes { nodeIds: [...] }` + the projection above — one call, not one per id | as above |
| A chapter's grid | `get_node { nodeId: <chapterId>, projection: "cells" }` | small |
| One node's wiring | `get_node { nodeId, projection: "edges" }` | tiny |
| Slices and their elements / attribute flow / scenarios | `get_slice_data` `projection: "outline"` / `"fields"` / `"specs"` (`outline`/`specs` only in `json`/`yaml`/`toon`) | per slice |
| **Screen HTML, node descriptions, positions/layout** (only then) | `get_nodes { chapterId \| nodeIds }` full `meta`, scoped — never unscoped | ~2 KB/node |

`line` carries no `cellName` (only the outline does), `sliceStatus`, `meta`, positions, field types or examples; `fields` adds types/examples/`parentId` but no HTML, description or positions. 

**Pick the cheapest read that answers the step, and name the reason next to the call** (e.g. "line — only need titles to dedupe"). The full decision table is in `learn-eventmodelers-api` → *Which read to use*.

**Orientation first, then only the narrow read you need.** "Where is the thing I was pointed at, and what sits around it" is answered by `get_board_outline` or `get_nodes` with `projection: "line"`. Decide from it which nodes you will touch, then read those with `projection: "fields"` (or full `meta` only if the task is about HTML, descriptions or layout) — scoped by `chapterId`, or by `nodeIds` for a scattered handful. Opening with an unscoped full-`meta` read drags every field body and every rendered HTML page across the wire to answer the cheapest question in the session.

**Each read is once per session, not once per step.** A chapter's outline and grid don't change unless you or a human changes them, so keep the indexed result and answer later questions from memory; re-read only after a structural write (a node created, moved or deleted), and then only the part that moved. Three `get_board_outline` calls inside one turn means the first two were fetched and thrown away.

### The slice status comes with the outline

The orientation read also gives each column's `sliceStatus` (`get_nodes` does **not** carry it) — a slice owns a column, so every element in that column shares its status. It is context, not a write lock: any slice may be changed, whatever its status.

`get_node` without a projection is for **one** node you did not already load — most often re-reading a node right after writing it. A step that issues it in a loop over nodes that were already in a list response is doing the same fetch N times; collapse it to the single chapter-scoped read above.

The same discipline applies to writes: `submit_node_events` takes `events[]`, so a multi-node edit is **one** call carrying every event, not one call per node. Pass `compact: true` when you don't need the per-node hash map back.

Where per-node calls genuinely can't be avoided, issue them together in one message so they run concurrently rather than in sequence.

### Ids

Elements you create carry client-side ids — one `nodeId` per new node — and **every event carries its own `id`**, a fresh uuid per event, never the node's. Mint them **once per turn, in a single call**, and take from that pool as you assemble the event array:

```bash
for i in $(seq 8); do uuidgen; done
```

Nothing in that depends on anything you're about to read, so splitting it across several shells is round trips bought for nothing.

The event `id` is **required** — an event without one is rejected as an invalid shape. It is what keys the returned `hashes` map, and what makes a resubmit idempotent: the same event sent twice under the same id writes one board event, not two. An event's `boardId` and `timestamp`, by contrast, are **not** yours to send — the server takes the board from the call and stamps the time itself, and ignores both if you send them.
