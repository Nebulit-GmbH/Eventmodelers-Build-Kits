# Eventmodelers Improvement Plan — Baseline Stats + Action Plan

Single reference document: baseline numbers from the Library Catalogue System modeling round, and the ranked improvement plan to work through one item at a time, re-measuring after each. Detailed step-by-step findings live in `report.md`; per-step modeling narrative lives in `.trogonai/interviews/library-catalogue-system/EVENTMODELING.md`.

---

## Baseline stats (this run — before any fix)

**Model produced**: 1 chapter, 13 events, 11 commands, 3 automations, 15 read models, 13 screens, 55 scenarios/storylines, 26 slices. Validation verdict: PASS.

**Total tool calls: ~280**

| Step | Skill | Tool calls | Cost verdict |
|---|---|---|---|
| Orchestration/connect | connect, orchestrating | ~5 | Cheap — one-time setup |
| 1 | brainstorming-events | ~20 | Cheap-moderate — batched well |
| 2 | plotting-events | 0 | Free — pure verification |
| 3 | storyboarding-events | ~25 | Expensive — unbatchable HTML rendering |
| 4 | identifying-inputs | ~15 | Cheap — batched node creation + auto_connect_node |
| 5 | identifying-outputs | ~150+ | **Most expensive by far** — cascading rework + no batch connections |
| 6 | applying-conways-law | 0 | Free — pure analysis |
| 7 | elaborating-scenarios | ~27 | Moderate — per-column batching absorbs many items |
| 8 | checking-completeness | 2 | Cheap — reasoning against 2 re-fetches |
| 9 | validating-event-models | 0 | Free — pure reasoning |
| 10 | slicing-event-models | 26 | Moderate — one call per slice, no batch endpoint |
| 11 | document reasoning | 2 | Cheap — one lane + one batched markdown node |
| **Total** | | **~280** | |

**Headline findings** (full detail in `report.md`):
1. Batched node creation (`submit_node_events` arrays) is the cheapest pattern available — used well in Steps 1 and 4.
2. `create_screen` cannot be batched — the #1 driver of Step 3's cost (15 large-HTML calls total across the round).
3. `set_connection` has no batch form — the quiet tax across every step; ~90 individual calls this round.
4. Index-based column insertion requires exact position tracking; caused two miscounted-append incidents.
5. **A single upfront design error (Step 4→5 rework) was more expensive than four other steps combined** — architecture correctness beats any tool-batching optimization.
6. Stricter architectural rules (>3-events heuristic, one-RM-per-component) directly multiply node/column count — this is real modeling cost, not tool waste.
7. Steps that are pure judgment/verification (2, 6, 9) cost nothing.

---

## Action plan — tackle one at a time, re-measure after each

Ordered by relevance and impact, highest first. Work through in order; after each item ships, re-run an equivalent modeling round and fill in the "After" column below with the new total-call count and step breakdown, so the effect of each individual change is visible rather than a single before/after blend.

| # | Item | Baseline evidence | Status | Calls before → after |
|---|---|---|---|---|
| 1 | Restructure skills: state the automation/todo-list rule upfront (in orchestrator's global rules, not buried in Step 5b) | Step 4→5 rework: ~35 calls of pure correction | Not started | — |
| 2 | New dedicated sub-step: design automations + todo lists together (fold Step 5b into Step 4b) | Same as #1 — root cause is the Step 4/5 split itself | Not started | — |
| 3 | Fix "payload too large" on full-board node loads (reliability bug, not cost) | Reported directly; consistent with this session's payload growth (13 HTML screens, 35-column chapter) | Not started | — |
| 4 | New composite tool `design_translation_chain` | ~25 calls per translation chain built by hand | Not started | — |
| 5 | Batch `set_connection` → `set_connections` | ~90 individual calls this round | Not started | — |
| 6 | Batch `create_slice_definition` → `create_slice_definitions` | 26 calls, purely mechanical | Not started | — |
| 7 | Batch `auto_connect_node` → `auto_connect_nodes` | 13 calls in Step 4 alone | Not started | — |
| 8 | `add_column`: `count` param + relative insertion (`beforeNodeId`/`afterNodeId`) | 2 miscounted-append incidents + 7 columns of manual right-to-left index math | Not started | — |
| 9 | `get_nodes`/`get_node`: `chapterId` scope + `nodeIds` filter | Every one of ~280 calls this round was chapter-scoped; no way to fetch a known node subset | Not started | — |
| 10 | Chapter fetch compact projections (`cells`/`edges`/`line`) | 2 full-chapter fetches against a 35-column `timelineData` payload | Not started | — |
| 11 | `create_chapter`: `columns`/`eventTitles` params | First chapter needed 13 columns immediately, forcing an append burst | Not started | — |
| 12 | `place_element`: auto-extend + compact response | Predicted failure mode (index-bookkeeping), not directly hit this round | Not started | — |
| 13 | New composite tool `scaffold_chapter` | Would collapse much of Steps 1+4's mechanical placement | Not started | — |
| 14 | Batch `create_screen` → `create_screens` + inline `fields` | 15 `create_screen` calls, each needing a follow-up fields call | Not started | — |
| 15 | `get_spec_info`: type filter | Low urgency at this board's ~60-element size | Not started | — |
| 16 | Batch `move_node_in_timeline` → `move_nodes` | 7 individual moves during the Step 5 rework | Not started | — |
| 17 | Batch `delete_node`/`delete_column` | ~6 individual deletions this round | Not started | — |

**Projected effect of items 1-8** (the highest-leverage subset): **~280 calls → ~130-150** for an equivalent model, plus items 1-2 removing a recurring correctness risk and item 3 fixing a hard failure mode — neither of which shows up as a call-count number but both matter more than the numbers that do.

---

## Full task detail

### 1. Restructure the skills: state the automation/todo-list rule where it can actually be seen
**Problem**: The rule that would have prevented this round's single most expensive event lives in the wrong file. Step 4 (`eventmodeling-identifying-inputs`) tells the modeler to place an AUTOMATION+COMMAND+EVENT triple for any externally-triggered command — with no mention that (a) every automation needs a todo-list READMODEL, and (b) an automation triggered by another system's event must translate it into an internal event first, never produce the external event directly. That constraint currently lives only in Step 5b, inside `eventmodeling-identifying-outputs` — a different skill file, not loaded until Step 5 runs. Step 4 was followed correctly and still produced a wrong model, because the rule that would have stopped it simply wasn't in context yet.
**Evidence**: This session's Step 4→5 correction — deleting/moving ~10 nodes, rewiring ~15 connections, more expensive than four other steps combined.
**Proposed change**: Move the rule up, not just cross-reference it. The orchestrating skill (`eventmodeling-orchestrating-event-modeling`) already has a global "Timeline Alignment Rules" section that is read and enforced at *every* step ("A COMMAND never stands alone," "No backward arrows," etc.) — add the two-stage translation requirement there, as a peer rule, not tucked inside one step's file. A rule stated only in the file for Step 5 is invisible at Step 4 by construction; a rule stated in the section every step already loads is not.
**Impact**: Zero-code, ships immediately, and directly prevents recurrence of the costliest failure mode observed — independent of and ahead of any tool change below.

### 2. New dedicated sub-step: design automations and their todo lists together
**Problem**: Same root cause as #1, expressed as workflow sequencing rather than documentation placement. Today, *placing* an automation (Step 4) and *giving it a todo-list read model* (Step 5b) are two different steps, invoked at two different times, by two different skill files. An automation is never actually complete without its todo list — so splitting these guarantees every automation gets built once wrong (Step 4's partial view) and once fixed (Step 5's mandatory verification), for every run that has automations at all.
**Evidence**: Same as #1 — the rework was a direct consequence of this split, not just of the documentation gap.
**Proposed change**: Fold Step 5b's entire content into Step 4 as an explicit second pass, rather than inventing a new top-level numbered step (avoids renumbering Steps 5-11 for every existing reference to them): **Step 4a — UI-issued commands** (unchanged), **Step 4b — Automation-issued commands, designed complete**: for every processor/automation trigger, in one pass, (i) determine whether the trigger is external or internal, (ii) if external and something downstream needs to react further, build the full two-stage translation chain immediately (external EVENT → todo-list READMODEL → translation AUTOMATION+COMMAND+*internal* EVENT), (iii) create every automation's todo-list READMODEL in the same pass, wired with its opening/closing events, before moving to the next command. Step 5 (Identifying Outputs) then only ever has to design *screen*-facing read models — the automation-todo-list gap becomes structurally impossible to leave open, rather than something Step 5's verification has to catch after the fact. (If the skill maintainers prefer more granularity than a lettered sub-step, a genuinely new numbered step — "Step 4.5" — works just as well; the sequencing fix matters more than its exact label.)
**Impact**: Removes the entire class of error, not just its cost — makes Step 5's mandatory automation-verification pass redundant rather than load-bearing.

### 3. Fix the "payload too large" hard failure when loading all nodes from a large board
**Problem**: This is a reliability bug, not a cost-optimization opportunity — it doesn't make modeling more expensive, it makes it *impossible*. Loading all nodes on a board (an unfiltered `get_nodes`, or any skill that does a full-board read on startup, e.g. an existing-model analysis pass) can fail outright with "payload too large" when the response JSON gets big enough to choke the parser.
**Evidence**: Reported directly ("we ran into some issues with this like 'payload too large' because it tried to parse a gigantic JSON"). Consistent with this session's own experience of payload growth: HTML_SCREEN nodes carry full embedded page markup (13 such nodes by the end of this round), and a CHAPTER node's `timelineData` grows with every column and cell (35 columns by the end) — both are exactly the kind of per-node bulk that turns a "list everything" call into a multi-megabyte response on a board bigger than this one.
**Proposed fix** (independent, complementary options — not mutually exclusive):
- Make compact/line projections (see #10) the *default* for any full-board or unfiltered listing, not an opt-in — screen `pages` HTML and full field arrays are the largest single contributors and are rarely needed for an initial scan; full detail becomes a targeted follow-up fetch per node.
- Add pagination (`limit`/`cursor`) to `get_nodes` and any other "list everything" endpoint, so a full-board load returns in bounded chunks instead of one unbounded response.
- Add a server-side size guard that degrades to summary mode (with a note that full detail needs a follow-up) instead of failing the whole request outright.
**Impact**: The only item on this list that's a correctness/reliability fix rather than a cost optimization — without it, sufficiently large boards can't be read at all, which is strictly worse than "costs more tokens." Should be treated as a bug-fix priority independent of where it lands on a token-cost ranking.

### 4. New composite tool: `design_translation_chain`
**Problem**: Even with #1 and #2 in place, the two-stage translation pattern is fiddly to execute by hand — three columns, one todo-list read model, one automation, one command, one internal event, and 5+ connections including the exempted backward "closing" edge.
**Evidence**: This session's manual construction of two translation chains took ~25 tool calls between node creation and wiring.
**Proposed shape**: `design_translation_chain({ boardId, timelineId, externalEventTitle, internalEventTitle, translationAutomationTitle, translationCommandTitle, todoListTitle, workerAutomationNodeId? })` — atomically creates the three columns, all nodes, and every connection (including wiring the internal event forward into `workerAutomationNodeId`'s own todo list, if given).
**Impact**: Makes the *correct* shape mechanically the only output possible, on top of #1/#2 making it the *expected* one.

### 5. Batch `set_connection` → `set_connections`
**Problem**: Every board edge is its own round trip; no array form exists.
**Evidence**: Step 5 alone needed ~50+ individual `set_connection` calls (translation-chain wiring: 13; dashboard/browse wiring: 26; lookup read models: 14) — the largest single contributor to that step's ~150-call cost.
**Proposed shape**: `set_connections({ boardId, connections: [{ source, target, action: "connect"|"remove" }, ...] })` → `{ results: [...] }`, one result per input pair, same validation rules as today.
**Impact**: ~90 calls (Steps 4/5/7-adjacent wiring) → ~6-8.

### 6. Batch `create_slice_definition` → `create_slice_definitions`
**Problem**: One call per slice, no array form.
**Evidence**: Step 10 needed exactly 26 individual calls, one per command/read-model/automation column — purely mechanical once the column list is known.
**Proposed shape**: `create_slice_definitions({ boardId, timelineId, slices: [{ columnId, title }, ...] })`.
**Impact**: 26 calls → 1.

### 7. Batch `auto_connect_node` → `auto_connect_nodes`
**Problem**: One node at a time, despite already being the most efficient wiring primitive available (resolves 2 edges per call when neighbors are already correctly placed).
**Evidence**: Step 4 needed 13 calls, one per command.
**Proposed shape**: `auto_connect_nodes({ boardId, nodeIds: [...] })` → array of per-node results.
**Impact**: 13 calls → 1 in Step 4; would also help re-verify connections after any bulk node move.

### 8. `add_column`: count param + relative insertion
**Problem, two ways**: (a) appending N columns takes N calls, and — demonstrated twice this session — a model hand-counting parallel tool-call blocks will occasionally miscount (over-created by exactly one column, twice: 11 vs. intended 10 in Step 1, 17 vs. intended 16 in Step 5), each requiring a corrective `delete_column`; (b) inserting several columns at specific positions (not append) requires exact numeric-index math, done in strict right-to-left order since each insertion shifts everything after it — pure bookkeeping with no modeling value.
**Evidence**: The two miscounting incidents above, plus 7 columns needing precise right-to-left index math in Step 5.
**Proposed shape**: `add_column({ ..., count: N })` → `{ columnIds: [...], totalColumns }`; `add_column({ ..., beforeNodeId | afterNodeId })` resolves the index itself.
**Impact**: Eliminates a self-inflicted failure class entirely and removes all manual index arithmetic for relative insertion.

### 9. `get_nodes` / `get_node`: `nodeIds` filter *and* `chapterId` scope — nearly every call in this round was chapter-scoped anyway
**Problem**: `get_nodes` filters by `type`/`name` only, across the *entire board*. On a multi-chapter board this pulls every chapter's events/commands/etc. together, when in practice a modeling session works within one chapter at a time — every single tool call in this round (~280 of them) targeted the one "Catalogue Management" chapter. A board-wide, unscoped fetch is the rare case, not the common one, but it's the only option offered today. There's also no way to fetch a known, scattered set of specific node IDs in one call — only a full `type` fetch or one node at a time.
**Evidence**: This session never had a second chapter to contend with, so the cost of board-wide-by-default wasn't visible here — but it's the direct mechanism behind #3's failure mode on any board with more than one chapter's worth of history, and the other session's evidence suggests multi-chapter boards are common in practice.
**Proposed shape**: `get_nodes({ boardId, chapterId, type?, name?, nodeIds? })` — add `chapterId` as a first-class scope alongside the existing filters (should combine with `type`, not replace it), plus `nodeIds: [...]` for fetching a known, scattered subset in one call (the natural complement to every batch-creation change above — after `set_connections`/`auto_connect_nodes` returns, re-verifying exactly the touched nodes needs this, not a full-type refetch).
**Impact**: Makes the common case (everything in *this* chapter) the cheap, default-shaped call instead of an unscoped board-wide one; removes over-fetching whenever only a specific known subset needs re-checking. Directly reduces the blast radius of #3 on any multi-chapter board.

### 10. Chapter fetch: compact projections (`projection: "cells" | "edges" | "line"`)
**Problem**: `get_node` on a CHAPTER returns the entire `timelineData` — every row, every column, every cell's node payload — even when only the row/column ID map or one cell's occupancy is needed.
**Evidence**: Two full-chapter fetches this session, purely to read `rows`/`columns`/`cells` for index bookkeeping; the chapter had grown to 35 columns by the second fetch, so the full payload's size scales with exactly the information that *isn't* needed for that lookup. Also the primary lever for fixing #3's default response size.
**Proposed shape**: `projection: "cells"` → `{ rows, columns, cells }` only, no per-node `meta`; `projection: "edges"` → inbound/outbound connections for one node; `projection: "line"` → one compact summary row per node across `get_nodes`.
**Impact**: Shrinks the two largest reads of this session and every future one as boards grow.

### 11. `create_chapter`: `columns` / `eventTitles` params
**Problem**: Always creates exactly 3 columns regardless of known need.
**Evidence**: This session's first chapter needed 13 columns immediately, forcing a follow-up append burst (source of the Step 1 miscounting incident in #8). The other session saw the same pattern at larger scale (9× `create_chapter` + 17× `add_column`).
**Proposed shape**: `create_chapter({ ..., columns: N })`, or `create_chapter({ ..., eventTitles: [...] })` where `len(eventTitles)` sets the column count.
**Impact**: Removes the append-burst pattern at its most common trigger point — starting a new chapter with a known event count.

### 12. `place_element`: auto-extend + compact response
**Problem**: Placing at an out-of-range `columnIndex` fails outright rather than extending to fit.
**Evidence**: Not hit directly this session (cells were always resolved manually via chapter fetch + math first), but the reported failure (`Cell "D3" does not correspond to a valid row and column` → corrective `add_column` + retry) is a predictable consequence of the same index-bookkeeping burden as #8/#10, so the fix generalizes.
**Proposed shape**: auto-extend columns to reach an out-of-range index before placing; `compact: boolean` → `{nodeId, cellName, columnIndex}` (+ `connectedCount`).

### 13. New composite tool: `scaffold_chapter`
**Problem**: No single call creates a chapter and places a full set of structural elements at once.
**Proposed shape**: creates/reuses a chapter (`existingChapterId`) and places every element from an `elements[]` list (EVENT/COMMAND/READMODEL/AUTOMATION/SCREEN placement + connections). **Scope deliberately excludes SCENARIO/storyline authoring** — those need per-element judgment (GWT vs. storyline, which scenario types apply) that doesn't reduce to a data list the way structural placement does.
**Impact**: Collapses much of Steps 1 and 4's mechanical placement+wiring into one call.

### 14. Batch `create_screen` → `create_screens`, plus inline `fields`
**Problem**: `create_screen` is unavoidably one-call-per-screen for content (bespoke HTML per screen), but still (a) repeats `boardId`/`chapterId` per call, and (b) doesn't accept `fields` — every screen needs a *second* `submit_node_events` call just for field mappings.
**Evidence**: 15 `create_screen` calls this round, each needing a follow-up fields-setting step (only avoided by manually batching that follow-up across screens, not the default flow).
**Proposed shape**: `create_screen({ ..., fields: [...] })` inline; `create_screens({ boardId, screens: [{chapterId, cellId, pages, description, fields}, ...] })` for the metadata/placement/fields part (content still authored per-screen).
**Impact**: Removes the two-step create+fields dance as the default; collapses per-call `boardId`/`chapterId` repetition.

### 15. `get_spec_info`: type filter
**Proposed shape**: `elementTypes: ["COMMAND","READMODEL"]` to avoid pulling the full element list when only one or two types are needed (e.g. Step 10 only needs COMMAND/READMODEL/AUTOMATION). Low urgency at this board's ~60-element size, but the list is unbounded as boards grow.

### 16. Batch `move_node_in_timeline` → `move_nodes`
**Evidence**: The Step 4→5 rework needed 7 individual node moves. `move_nodes({ moves: [{movedNodeId, toCellId}, ...] })` would apply equally there and to any future large-scale re-layout.

### 17. Batch `delete_node` / `delete_column`
Minor — only ~6 individual deletions this round (4 wrong nodes from the Step 5 correction, 2 stray columns from the #8 miscounting incidents). Worth bundling into the same batch-API pass as the above rather than standalone priority.
