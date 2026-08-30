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
| 1 | Restructure skills: state the automation/todo-list rule upfront (in orchestrator's global rules, not buried in Step 5b) | Step 4→5 rework: ~35 calls of pure correction | **Done** | — |
| 2 | New dedicated sub-step: design automations + todo lists together (fold Step 5b into Step 4b) | Same as #1 — root cause is the Step 4/5 split itself | **Done** | — |
| 3 | Fix "payload too large" on full-board node loads (reliability bug, not cost) | Reported directly; consistent with this session's payload growth (13 HTML screens, 35-column chapter) | **Discarded** — see note | — |
| 4 | New composite tool `design_translation_chain` | ~25 calls per translation chain built by hand | **Discarded** | — |
| 5 | Batch `set_connection` → `set_connections` | ~90 individual calls this round | **Done** | — |
| 6 | Batch `create_slice_definition` → `create_slice_definitions` | 26 calls, purely mechanical | **Done** | — |
| 7 | Batch `auto_connect_node` → `auto_connect_nodes` | 13 calls in Step 4 alone | **Done** | — |
| 8 | `add_column`: `count` param + relative insertion (`beforeNodeId`/`afterNodeId`) | 2 miscounted-append incidents + 7 columns of manual right-to-left index math | **Done** | — |
| 9 | `get_nodes`/`get_node`: `chapterId` scope + `nodeIds` filter | Every one of ~280 calls this round was chapter-scoped; no way to fetch a known node subset | **Done** | — |
| 10 | Chapter fetch compact projections (`cells`/`edges`/`line`) | 2 full-chapter fetches against a 35-column `timelineData` payload | **Done** | — |
| 11 | `create_chapter`: `columns`/`eventTitles` params | First chapter needed 13 columns immediately, forcing an append burst | **Done** (`columns`) / **Discarded** (`eventTitles`) | — |
| 12 | `place_element`: auto-extend + compact response | Predicted failure mode (index-bookkeeping), not directly hit this round | **Done** | — |
| 13 | New composite tool `scaffold_chapter` | Would collapse much of Steps 1+4's mechanical placement | **Discarded** | — |
| 14 | Batch `create_screen` → `create_screens` + inline `fields` | 15 `create_screen` calls, each needing a follow-up fields call | **Done** | — |
| 15 | `get_spec_info`: type filter | Low urgency at this board's ~60-element size | **Done** | — |
| 16 | Batch `move_node_in_timeline` → `move_nodes` | 7 individual moves during the Step 5 rework | **Done** | — |
| 17 | Batch `delete_node`/`delete_column` | ~6 individual deletions this round | **Done** | — |

**Projected effect of items 1-8** (the highest-leverage subset): **~280 calls → ~130-150** for an equivalent model, plus items 1-2 removing a recurring correctness risk and item 3 fixing a hard failure mode — neither of which shows up as a call-count number but both matter more than the numbers that do.

---

## Full task detail

### 1. Restructure the skills: state the automation/todo-list rule where it can actually be seen
**Problem**: The rule that would have prevented this round's single most expensive event lives in the wrong file. Step 4 (`eventmodeling-identifying-inputs`) tells the modeler to place an AUTOMATION+COMMAND+EVENT triple for any externally-triggered command — with no mention that (a) every automation needs a todo-list READMODEL, and (b) an automation triggered by another system's event must translate it into an internal event first, never produce the external event directly. That constraint currently lives only in Step 5b, inside `eventmodeling-identifying-outputs` — a different skill file, not loaded until Step 5 runs. Step 4 was followed correctly and still produced a wrong model, because the rule that would have stopped it simply wasn't in context yet.
**Evidence**: This session's Step 4→5 correction — deleting/moving ~10 nodes, rewiring ~15 connections, more expensive than four other steps combined.
**Proposed change**: Move the rule up, not just cross-reference it. The orchestrating skill (`eventmodeling-orchestrating-event-modeling`) already has a global "Timeline Alignment Rules" section that is read and enforced at *every* step ("A COMMAND never stands alone," "No backward arrows," etc.) — add the two-stage translation requirement there, as a peer rule, not tucked inside one step's file. A rule stated only in the file for Step 5 is invisible at Step 4 by construction; a rule stated in the section every step already loads is not.
**Impact**: Zero-code, ships immediately, and directly prevents recurrence of the costliest failure mode observed — independent of and ahead of any tool change below.

**Implemented as**: rather than growing the orchestrator's already-large "Timeline Alignment Rules" section with the full translation-chain writeup, the rule was split in two — a short pointer stays in the orchestrator (states the core fact: an automation can only be triggered by an internal event, external triggers need a translation chain), while the full mechanics moved to a new dedicated skill, `eventmodeling-designing-automation-chains` (see item #2's implementation note — same change covers both items).

### 2. New dedicated sub-step: design automations and their todo lists together
**Problem**: Same root cause as #1, expressed as workflow sequencing rather than documentation placement. Today, *placing* an automation (Step 4) and *giving it a todo-list read model* (Step 5b) are two different steps, invoked at two different times, by two different skill files. An automation is never actually complete without its todo list — so splitting these guarantees every automation gets built once wrong (Step 4's partial view) and once fixed (Step 5's mandatory verification), for every run that has automations at all.
**Evidence**: Same as #1 — the rework was a direct consequence of this split, not just of the documentation gap.
**Proposed change**: Fold Step 5b's entire content into Step 4 as an explicit second pass, rather than inventing a new top-level numbered step (avoids renumbering Steps 5-11 for every existing reference to them): **Step 4a — UI-issued commands** (unchanged), **Step 4b — Automation-issued commands, designed complete**: for every processor/automation trigger, in one pass, (i) determine whether the trigger is external or internal, (ii) if external and something downstream needs to react further, build the full two-stage translation chain immediately (external EVENT → todo-list READMODEL → translation AUTOMATION+COMMAND+*internal* EVENT), (iii) create every automation's todo-list READMODEL in the same pass, wired with its opening/closing events, before moving to the next command. Step 5 (Identifying Outputs) then only ever has to design *screen*-facing read models — the automation-todo-list gap becomes structurally impossible to leave open, rather than something Step 5's verification has to catch after the fact. (If the skill maintainers prefer more granularity than a lettered sub-step, a genuinely new numbered step — "Step 4.5" — works just as well; the sequencing fix matters more than its exact label.)
**Impact**: Removes the entire class of error, not just its cost — makes Step 5's mandatory automation-verification pass redundant rather than load-bearing.

**Implemented as**: a genuinely new step, not a lettered sub-step inside an existing file — **Step 4b**, its own skill `eventmodeling-designing-automation-chains`, invoked immediately after Step 4 and before Step 5 in the orchestrator's Workflow. This was chosen over folding into `eventmodeling-identifying-inputs` because it keeps that file scoped to commands only (no output/read-model content bleeding in), and keeps the orchestrator's global rules section from growing — the new skill file carries the full todo-list pattern, the translation-chain worked example, placement mechanics, and its own verification checklist, all moved out of `eventmodeling-identifying-outputs` Step 5b (which now just points to Step 4b and keeps a defensive re-check in its own Step 5i). No renumbering of Steps 5–11 was needed.

### 3. Fix the "payload too large" hard failure when loading all nodes from a large board
**Problem**: This is a reliability bug, not a cost-optimization opportunity — it doesn't make modeling more expensive, it makes it *impossible*. Loading all nodes on a board (an unfiltered `get_nodes`, or any skill that does a full-board read on startup, e.g. an existing-model analysis pass) can fail outright with "payload too large" when the response JSON gets big enough to choke the parser.
**Evidence**: Reported directly ("we ran into some issues with this like 'payload too large' because it tried to parse a gigantic JSON"). Consistent with this session's own experience of payload growth: HTML_SCREEN nodes carry full embedded page markup (13 such nodes by the end of this round), and a CHAPTER node's `timelineData` grows with every column and cell (35 columns by the end) — both are exactly the kind of per-node bulk that turns a "list everything" call into a multi-megabyte response on a board bigger than this one.
**Proposed fix** (independent, complementary options — not mutually exclusive):
- Make compact/line projections (see #10) the *default* for any full-board or unfiltered listing, not an opt-in — screen `pages` HTML and full field arrays are the largest single contributors and are rarely needed for an initial scan; full detail becomes a targeted follow-up fetch per node.
- Add pagination (`limit`/`cursor`) to `get_nodes` and any other "list everything" endpoint, so a full-board load returns in bounded chunks instead of one unbounded response.
- Add a server-side size guard that degrades to summary mode (with a note that full detail needs a follow-up) instead of failing the whole request outright.
**Impact**: The only item on this list that's a correctness/reliability fix rather than a cost optimization — without it, sufficiently large boards can't be read at all, which is strictly worse than "costs more tokens." Should be treated as a bug-fix priority independent of where it lands on a token-cost ranking.

**Implemented as**: only partially — not a fix to the underlying failure. Two candidate mitigations were tried and explicitly rejected during implementation: (1) a hard byte-size guard/truncation fallback (`MAX_NODE_RESPONSE_CHARS` degrading to a summary) — rejected outright; (2) compacting `HTML_SCREEN` `meta.pages` down to a `pageCount` by default — also rejected, `get_nodes`/`get_node` must return full, untruncated content whenever asked. Neither `get_nodes` nor `get_node` shrinks or degrades any field. The only change that shipped is item #9's `chapterId`/`nodeIds` filters — these let a caller *avoid* triggering the failure by narrowing the request itself, but an unfiltered/board-wide `get_nodes` on a sufficiently large board (many/large HTML_SCREEN pages) can still fail outright.

**Discarded (2026-08-30)**: the remaining fix — pagination (`limit`/`cursor`) or a server-side guard that rejects with a clear "narrow your request" error before serializing an oversized response — is not being pursued further in this round. Both rejected mitigations above ruled out the two levers that would have made this a complete fix without a larger, separately-scoped API change (pagination semantics affect every list-style tool, not just `get_nodes`); item #9's filters remain the practical mitigation.

### 4. New composite tool: `design_translation_chain`
**Status: Discarded** — not implemented this round; the notes below are the original proposal, kept for reference if picked up later.
**Problem**: Even with #1 and #2 in place, the two-stage translation pattern is fiddly to execute by hand — three columns, one todo-list read model, one automation, one command, one internal event, and 5+ connections including the exempted backward "closing" edge.
**Evidence**: This session's manual construction of two translation chains took ~25 tool calls between node creation and wiring.
**Proposed shape**: `design_translation_chain({ boardId, timelineId, externalEventTitle, internalEventTitle, translationAutomationTitle, translationCommandTitle, todoListTitle, workerAutomationNodeId? })` — atomically creates the three columns, all nodes, and every connection (including wiring the internal event forward into `workerAutomationNodeId`'s own todo list, if given).
**Impact**: Makes the *correct* shape mechanically the only output possible, on top of #1/#2 making it the *expected* one.

### 5. Batch `set_connection` → `set_connections`
**Problem**: Every board edge is its own round trip; no array form exists.
**Evidence**: Step 5 alone needed ~50+ individual `set_connection` calls (translation-chain wiring: 13; dashboard/browse wiring: 26; lookup read models: 14) — the largest single contributor to that step's ~150-call cost.
**Proposed shape**: `set_connections({ boardId, connections: [{ source, target, action: "connect"|"remove" }, ...] })` → `{ results: [...] }`, one result per input pair, same validation rules as today.
**Impact**: ~90 calls (Steps 4/5/7-adjacent wiring) → ~6-8.

**Implemented as**: exactly the proposed shape, as a new `set_connections` MCP tool in `eventmodelers-plattform/backend/src/slices/mcp/routes.ts`, right after `set_connection`. Pure orchestration — no adapter/business-logic changes: it loops over the input array **in order**, calling the same `repo.connectNodes`/`repo.removeConnection` that back the single-pair `set_connection` tool, so every existing validation rule (type compatibility, same-timeline requirement, the backward-EVENT→READMODEL exemption, duplicate-edge skip) applies unchanged per entry. Sequential (not parallel) processing is deliberate: a later entry can depend on an earlier one already committed — e.g. wiring `READMODEL→AUTOMATION` before the backward `EVENT→READMODEL` closing edge that requires it, the exact translation-chain wiring order from `eventmodeling-designing-automation-chains`. A failing entry doesn't stop the batch — each result reports its own outcome or `{error, hint}` independently, matching `set_connection`'s existing per-call error shape. Not wrapped in a single DB transaction (matches `set_connection`'s existing non-atomic behavior; item #5 was never about atomicity, only call-count).

No new tests were added at the routes.ts/MCP-tool layer — this codebase doesn't unit-test that layer directly for any existing tool (`get_nodes`, `set_connection`, `auto_connect_node` included); only the underlying adapter functions are tested, and `connectNodes`/`removeConnection` are already covered by the existing `ConnectNodes.test.ts` suite (unchanged by this addition). Full backend `tsc --noEmit` and the 164-test supabase-extensions suite pass.

### 6. Batch `create_slice_definition` → `create_slice_definitions`
**Problem**: One call per slice, no array form.
**Evidence**: Step 10 needed exactly 26 individual calls, one per command/read-model/automation column — purely mechanical once the column list is known.
**Proposed shape**: `create_slice_definitions({ boardId, timelineId, slices: [{ columnId, title }, ...] })`.
**Impact**: 26 calls → 1.

**Implemented as**: exactly the proposed shape, as a new `create_slice_definitions` MCP tool in `routes.ts`, right after `create_slice_definition`. Same non-atomic, per-item pattern as item #5/#7 — loops over `slices` calling the existing `repo.createSliceDefinition` per entry, pushing either its result or `{columnId, title, error}` into `results` (order preserved, one failing entry doesn't stop the rest). No adapter changes.

### 7. Batch `auto_connect_node` → `auto_connect_nodes`
**Problem**: One node at a time, despite already being the most efficient wiring primitive available (resolves 2 edges per call when neighbors are already correctly placed).
**Evidence**: Step 4 needed 13 calls, one per command.
**Proposed shape**: `auto_connect_nodes({ boardId, nodeIds: [...] })` → array of per-node results.

**Implemented as**: exactly the proposed shape, as a new `auto_connect_nodes` MCP tool in `routes.ts`, right after `auto_connect_node`. Loops over `nodeIds` calling the existing `repo.autoConnectNode` per entry, pushing `{nodeId, connected, skipped}` or `{nodeId, error}` into `results` (order preserved, one failing node doesn't stop the rest). No adapter changes.

Both #6 and #7 (plus #5) share the same shape: thin orchestration in `routes.ts` reusing already-tested adapter functions, so no new tests were added at the routes.ts layer, consistent with every other existing MCP tool in this codebase (none of which are unit-tested at that layer). Full backend `tsc --noEmit` and the 164-test supabase-extensions suite pass after both changes.

**Soft-deprecation note (2026-08-30)**: considered removing the singular `set_connection`/`auto_connect_node`/`create_slice_definition` tools now that their batch forms exist (fewer registered MCP tools = less tool-schema context per session). Decided against it — not just a rename: the singular tools return a flat result object while the batch tools always wrap in `{results: [...]}`, so removal would break any caller (including any client outside this codebase, since this MCP server is exposed at `api.eventmodelers.ai`) still expecting the flat shape, with no way from here to confirm nothing does. Instead, all three singular tools' descriptions now steer callers toward the batch form ("Prefer set_connections (even for a single connection)...", and similarly for `auto_connect_nodes`/`create_slice_definitions`) — a zero-risk nudge, not a breaking change. Actual removal would need a real deprecation window plus usage visibility this session doesn't have.
**Impact**: 13 calls → 1 in Step 4; would also help re-verify connections after any bulk node move.

### 8. `add_column`: count param + relative insertion
**Problem, two ways**: (a) appending N columns takes N calls, and — demonstrated twice this session — a model hand-counting parallel tool-call blocks will occasionally miscount (over-created by exactly one column, twice: 11 vs. intended 10 in Step 1, 17 vs. intended 16 in Step 5), each requiring a corrective `delete_column`; (b) inserting several columns at specific positions (not append) requires exact numeric-index math, done in strict right-to-left order since each insertion shifts everything after it — pure bookkeeping with no modeling value.
**Evidence**: The two miscounting incidents above, plus 7 columns needing precise right-to-left index math in Step 5.
**Proposed shape**: `add_column({ ..., count: N })` → `{ columnIds: [...], totalColumns }`; `add_column({ ..., beforeNodeId | afterNodeId })` resolves the index itself.
**Impact**: Eliminates a self-inflicted failure class entirely and removes all manual index arithmetic for relative insertion.

**Implemented as (count)**: exactly the proposed shape, in `eventmodelers-plattform/backend/src/slices/extensions/supabase/chapters/AddColumn.ts` + `board-types.ts` + the `add_column` MCP tool in `routes.ts`. `AddColumnInput` gained `count?: number` (defaults to 1, unchanged behavior); `count` columns are inserted contiguously in one DB update + one chapter `node:changed` event, starting at `index` (or appended). `AddColumnResult` gained an optional `columnIds: string[]` (every created column id, left to right) — present only when `count > 1`, so the `count === 1`/omitted result shape (`columnId`/`index`/`totalColumns`) is unchanged for existing callers (`createSlice` included). Rejects `count < 1` or non-integer counts, and rejects combining an explicit `columnId` with `count > 1` (a single id can't name several new columns).

**Implemented as (`beforeNodeId`/`afterNodeId`)**: same files. Adds mutually-exclusive `beforeNodeId`/`afterNodeId` inputs (rejects giving more than one of `index`/`beforeNodeId`/`afterNodeId` at once) — each resolves the insertion index from the column of an already-placed node (found via the timeline's `cells` array), instead of the caller computing a numeric index by hand. A referenced node that isn't placed on this timeline, or whose column no longer exists, is a `NotFoundError`. Covered by 5 new tests in `AddColumn.test.ts` (append batch, positional batch with existing columns shifted right, unchanged single-column shape, invalid count, columnId+count conflict) plus additional tests for `beforeNodeId`/`afterNodeId` resolution and the conflicting-position guard; full backend `tsc --noEmit` and the full supabase-extensions suite pass (554 tests, 0 failures as of 2026-08-30).

**Branch note (2026-08-30)**: both halves were implemented and committed (`3aed709` for `count`, `0643106` for `beforeNodeId`/`afterNodeId`) on the `pocketbase` branch of `eventmodelers-plattform`, not `main` — a branch mixup from the session that did this work. `main` does not yet have either change. Reconciling the two branches (merge/rebase `pocketbase`'s improvement.md work onto `main`) is still open and independent of this item being functionally done.

### 9. `get_nodes` / `get_node`: `nodeIds` filter *and* `chapterId` scope — nearly every call in this round was chapter-scoped anyway
**Problem**: `get_nodes` filters by `type`/`name` only, across the *entire board*. On a multi-chapter board this pulls every chapter's events/commands/etc. together, when in practice a modeling session works within one chapter at a time — every single tool call in this round (~280 of them) targeted the one "Catalogue Management" chapter. A board-wide, unscoped fetch is the rare case, not the common one, but it's the only option offered today. There's also no way to fetch a known, scattered set of specific node IDs in one call — only a full `type` fetch or one node at a time.
**Evidence**: This session never had a second chapter to contend with, so the cost of board-wide-by-default wasn't visible here — but it's the direct mechanism behind #3's failure mode on any board with more than one chapter's worth of history, and the other session's evidence suggests multi-chapter boards are common in practice.
**Proposed shape**: `get_nodes({ boardId, chapterId, type?, name?, nodeIds? })` — add `chapterId` as a first-class scope alongside the existing filters (should combine with `type`, not replace it), plus `nodeIds: [...]` for fetching a known, scattered subset in one call (the natural complement to every batch-creation change above — after `set_connections`/`auto_connect_nodes` returns, re-verifying exactly the touched nodes needs this, not a full-type refetch).
**Impact**: Makes the common case (everything in *this* chapter) the cheap, default-shaped call instead of an unscoped board-wide one; removes over-fetching whenever only a specific known subset needs re-checking. Directly reduces the blast radius of #3 on any multi-chapter board.

**Implemented as**: exactly the proposed shape, in `eventmodelers-plattform/backend/src/slices/mcp/routes.ts` + `SupabaseBoardAdapter.getNodes`/`BoardAdapter` interface. `nodeIds` on the tool maps straight onto the adapter's pre-existing `ids` parameter, which the tool schema had never exposed. `chapterId` is new plumbing: `BoardAdapter.getNodes` gained a fourth `chapterId?` argument that filters by `node.parentId` (dialect-branched — `json_extract(node, '$.parentId')` on sqlite, `node->>'parentId'` on postgres — matching the existing pattern in `DeleteColumn.ts`/`DeleteNodeCascade.ts`). Both filters combine with `type` rather than replacing it, and omitting `chapterId` reproduces the old board-wide behavior exactly (covered by a characterization test). New dual-dialect test suite: `SupabaseBoardAdapter.getNodes.test.ts` (+ `.postgres.test.ts`/`.sqlite.test.ts` runners), 3 tests × 2 dialects, all passing; full backend `tsc --noEmit` and existing 150-test supabase-extensions suite also verified clean after the change.

### 10. Chapter fetch: compact projections (`projection: "cells" | "edges" | "line"`)
**Problem**: `get_node` on a CHAPTER returns the entire `timelineData` — every row, every column, every cell's node payload — even when only the row/column ID map or one cell's occupancy is needed.
**Evidence**: Two full-chapter fetches this session, purely to read `rows`/`columns`/`cells` for index bookkeeping; the chapter had grown to 35 columns by the second fetch, so the full payload's size scales with exactly the information that *isn't* needed for that lookup. Also the primary lever for fixing #3's default response size.
**Proposed shape**: `projection: "cells"` → `{ rows, columns, cells }` only, no per-node `meta`; `projection: "edges"` → inbound/outbound connections for one node; `projection: "line"` → one compact summary row per node across `get_nodes`.
**Impact**: Shrinks the two largest reads of this session and every future one as boards grow.

**Implemented as**: exactly the proposed three variants, all **opt-in** — the default (unfiltered) response of `get_node`/`get_nodes` is completely unchanged when `projection` is omitted, unlike item #3's HTML compaction (rejected as a default) or its size-guard (rejected outright). `get_node` gained `projection: "cells" | "edges"`: `"cells"` requires the node be type `CHAPTER` (errors otherwise) and returns just `{rows, columns, cells}` via the existing `extractTimelineData` helper — no new adapter code; `"edges"` works on any node and calls the adapter's pre-existing `getEdges(boardId, [nodeId])` instead of `findNodeById`. `get_nodes` gained `projection: "line"`, mapping each matched node to `{id, type, title}`. All three are thin routing-layer additions in `routes.ts`, reusing already-tested adapter functions (`getEdges`, `extractTimelineData`) — no adapter or database changes. No new tests at the routes.ts layer (consistent with items #5-7 — that layer isn't unit-tested anywhere in this codebase); full backend `tsc --noEmit` and the 164-test supabase-extensions suite pass.

### 11. `create_chapter`: `columns` / `eventTitles` params
**Problem**: Always creates exactly 3 columns regardless of known need.
**Evidence**: This session's first chapter needed 13 columns immediately, forcing a follow-up append burst (source of the Step 1 miscounting incident in #8). The other session saw the same pattern at larger scale (9× `create_chapter` + 17× `add_column`).
**Proposed shape**: `create_chapter({ ..., columns: N })`, or `create_chapter({ ..., eventTitles: [...] })` where `len(eventTitles)` sets the column count.
**Impact**: Removes the append-burst pattern at its most common trigger point — starting a new chapter with a known event count.

**Implemented as**: `columns: N` only — `eventTitles` was deliberately dropped mid-implementation (scope call, not an oversight): accepting titles that only set a count but place nothing would be a confusing API, and actually placing EVENT nodes from `create_chapter` would blur it into `place_element`'s job. In `eventmodelers-plattform/backend/src/slices/extensions/supabase/chapters/CreateChapter.ts` + `board-types.ts` + the `create_chapter` MCP tool: `createChapter` gained a `shape?: {columns?: number}` parameter (defaults to 3, unchanged), and `CreateChapterResult` gained an always-present `columnIds: string[]` (every created column's id, left to right) — a small added bonus, since callers previously had to re-fetch the chapter just to learn its column ids. Rejects a non-positive-integer `columns`. Covered by 3 new tests in `CreateChapter.test.ts`; full backend `tsc --noEmit` and the 167-test supabase-extensions suite pass.

### 12. `place_element`: auto-extend + compact response
**Problem**: Placing at an out-of-range `columnIndex` fails outright rather than extending to fit.
**Evidence**: Not hit directly this session (cells were always resolved manually via chapter fetch + math first), but the reported failure (`Cell "D3" does not correspond to a valid row and column` → corrective `add_column` + retry) is a predictable consequence of the same index-bookkeeping burden as #8/#10, so the fix generalizes.
**Proposed shape**: auto-extend columns to reach an out-of-range index before placing; `compact: boolean` → `{nodeId, cellName, columnIndex}` (+ `connectedCount`).

**Implemented as**: exactly the proposed shape, in the `place_element` MCP tool (`eventmodelers-plattform/backend/src/slices/mcp/routes.ts`). When an explicit `columnIndex` is at or past the timeline's current column count, `place_element` now calls `repo.addColumn` with `count` set to exactly the shortfall (reusing item #8's batch param) before placing — no separate corrective `add_column` + retry needed. `compact: boolean` (default `false`, unchanged response otherwise) shrinks the response to `{nodeId, cellName, columnIndex}`, adding `connectedCount` only when auto-connect actually wired at least one edge. No adapter changes; typechecked clean and the existing 167-test supabase-extensions suite still passes (no new tests — this tool's logic lives entirely in the routes.ts layer, which this codebase doesn't unit-test anywhere, consistent with items #5-7/#10/#11).

### 13. New composite tool: `scaffold_chapter`
**Status: Discarded** — not implemented this round; the notes below are the original proposal, kept for reference if picked up later.
**Problem**: No single call creates a chapter and places a full set of structural elements at once.
**Proposed shape**: creates/reuses a chapter (`existingChapterId`) and places every element from an `elements[]` list (EVENT/COMMAND/READMODEL/AUTOMATION/SCREEN placement + connections). **Scope deliberately excludes SCENARIO/storyline authoring** — those need per-element judgment (GWT vs. storyline, which scenario types apply) that doesn't reduce to a data list the way structural placement does.
**Impact**: Collapses much of Steps 1 and 4's mechanical placement+wiring into one call.

### 14. Batch `create_screen` → `create_screens`, plus inline `fields`
**Problem**: `create_screen` is unavoidably one-call-per-screen for content (bespoke HTML per screen), but still (a) repeats `boardId`/`chapterId` per call, and (b) doesn't accept `fields` — every screen needs a *second* `submit_node_events` call just for field mappings.
**Evidence**: 15 `create_screen` calls this round, each needing a follow-up fields-setting step (only avoided by manually batching that follow-up across screens, not the default flow).
**Proposed shape**: `create_screen({ ..., fields: [...] })` inline; `create_screens({ boardId, screens: [{chapterId, cellId, pages, description, fields}, ...] })` for the metadata/placement/fields part (content still authored per-screen).
**Impact**: Removes the two-step create+fields dance as the default; collapses per-call `boardId`/`chapterId` repetition.

**Implemented as**: exactly the proposed shape, in the `create_screen`/new `create_screens` MCP tools in `eventmodelers-plattform/backend/src/slices/mcp/routes.ts` (commit `5cfc6d9`). `create_screen` gained an inline `fields?: z.array(z.record(...))` param — when given, a `node:changed` event setting `meta.fields` is persisted in the same call, right after the content-specific creation path (image/sketch/html), no follow-up `submit_node_events` needed. `create_screens` is HTML-only (image/sketch content is still authored per-screen, so it doesn't batch the same way): it loops over a `screens[]` array, resolving each entry's cell, creating its `HTML_SCREEN` node, and applying its `fields` if given — same non-atomic, per-entry error-isolated pattern as every other batch tool in this codebase (`set_connections`, `move_nodes`, etc.), reporting each entry's `{nodeId, created, error?}` in `results` regardless of earlier failures. Both accept `autoConnect: false` to skip neighbor wiring.

**Branch note (2026-08-30)**: committed on the `pocketbase` branch of `eventmodelers-plattform`, not `main` — see item #8's branch note; the same reconciliation is needed here.

### 15. `get_spec_info`: type filter
**Proposed shape**: `elementTypes: ["COMMAND","READMODEL"]` to avoid pulling the full element list when only one or two types are needed (e.g. Step 10 only needs COMMAND/READMODEL/AUTOMATION). Low urgency at this board's ~60-element size, but the list is unbounded as boards grow.

**Implemented as**: exactly the proposed shape, in `eventmodelers-plattform/backend/src/slices/extensions/supabase/specs/GetSpecInfo.ts` + `BoardAdapter.ts` + the `get_spec_info` MCP tool in `routes.ts`. `elementTypes` (any subset of `EVENT`/`COMMAND`/`READMODEL`) is pushed into the SQL query itself (`whereIn('type', ...)`), not just filtered client-side after a full fetch, so a narrowed request is genuinely cheaper, not just smaller in transit. The existing `VALID_STEP_TYPES` filter still applies afterward as a safety net. Along the way, fixed a real (pre-existing, unrelated to this item) bug in `eventmodeling-slicing-event-models`'s Step 2: it instructed filtering `get_spec_info`'s result to `COMMAND`/`READMODEL`/`AUTOMATION`, but `get_spec_info` can never return `AUTOMATION` (not in `VALID_STEP_TYPES`) — that skill now calls `get_spec_info` with `elementTypes: ["COMMAND", "READMODEL"]` and separately enumerates `AUTOMATION` via `get_nodes`. Covered by 3 new dual-dialect tests in `GetSpecInfo.test.ts`; full backend `tsc --noEmit` and the 178-test supabase-extensions suite pass.

### 16. Batch `move_node_in_timeline` → `move_nodes`
**Evidence**: The Step 4→5 rework needed 7 individual node moves. `move_nodes({ moves: [{movedNodeId, toCellId}, ...] })` would apply equally there and to any future large-scale re-layout.

**Implemented as**: exactly the proposed shape, as a new `move_nodes` MCP tool in `routes.ts` (same non-atomic, per-item, order-preserving pattern as items #5-7 — loops over `moves` calling the existing `repo.moveNode` per entry, one failing move doesn't stop the rest). **Also added the REST equivalent**, at the user's request: `POST .../timelines/:timelineId/nodes/move` now accepts either the existing single-move body (`{movedNodeId, toCellId}`, unchanged) or a batch body (`{moves: [...]}`) returning `{results: [...]}` — this is the first item in this list where the batch form was extended to REST, not just MCP (items #5-7/#14 are MCP-only). No adapter changes; no new tests (routes.ts/REST-route layer isn't unit-tested anywhere in this codebase, consistent with prior items). Typecheck clean on both `eventmodelers-plattform` and `miro-eventmodeling`; the 178-test supabase-extensions suite passes.

### 17. Batch `delete_node` / `delete_column`
Minor — only ~6 individual deletions this round (4 wrong nodes from the Step 5 correction, 2 stray columns from the #8 miscounting incidents). Worth bundling into the same batch-API pass as the above rather than standalone priority.

**Implemented as**: new `delete_nodes`/`delete_columns` MCP tools in `routes.ts`, same non-atomic per-item pattern as items #5-7/#16 — `delete_nodes` loops `persistNodeEvents` per nodeId, `delete_columns` loops `repo.deleteColumn` per columnId, applied strictly in order (so `deleteColumn`'s "cannot delete the last column" check sees the timeline's current state after each prior deletion, not a stale count taken before the batch started) with per-entry error isolation. MCP-only — no REST batch form this time (unlike #16, not explicitly requested). No adapter changes; no new tests (routes.ts layer isn't unit-tested anywhere in this codebase). Typecheck clean on both repos; the 178-test supabase-extensions suite passes.

---

**All 17 items now resolved** (done, partially done, or explicitly discarded — see status column above) as of 2026-08-30.
