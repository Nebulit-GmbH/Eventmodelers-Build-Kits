---
name: record-evidence
description: Writes the implementation evidence for a built slice onto the board — a markdown note in the slice's own column, in the chapter's "Implementation" feedback lane — listing the files, the board-element → code mapping, the specification → test mapping, the shared seams touched, assumptions and the commit. Run after the slice is committed, before it is set to Done. Also usable to document where an existing (legacy) Done slice lives in the code.
---

# Record Evidence

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Prefer `mcp__eventmodelers__*` tools when available (registered by the `connect` skill) — the curl blocks below are the fallback for sessions without MCP connected. Send `x-agent-id: $EVENTMODELERS_AGENT_ID` on every write when it is set.

The evidence note is how a human reviewing the board sees **where** a slice lives in the code and **how** each modeled element and scenario was realized, without opening the repository. It is proof, not prose: every line names a concrete file, class, method, endpoint, table or test that exists in the commit.

---

## Step 1 — Collect the evidence

From the slice you just built (or, for a legacy slice, from its row in the **Slice map** of `.build-kit/ARCHITECTURE.md` and the code it names):

| Item | Source |
|------|--------|
| `SLICE_ID`, slice title | `slice.json` → `id`, `title` |
| Commit | `git rev-parse --short HEAD` after the `feat: [Slice Name]` commit (`legacy` for a slice that pre-dates the kit) |
| Files created / modified | `git show --stat --format= HEAD` — repo-relative paths, split into *created* and *modified* |
| Element → code mapping | every COMMAND, EVENT, READMODEL, SCREEN and AUTOMATION in `slice.json` (with its `id`) and the code that realizes it |
| Field → code mapping | every command / event / read-model field and the parameter, property or column it maps to |
| Specification → test mapping | every entry in `specifications[]` (and storyline-derived tests) and the test class + method that covers it |
| Shared seams | the `Shared seams` column of the slice's Slice map row |
| Assumptions | the lines this slice added to `progress.txt` |
| Quality checks | the build and test commands from `ARCHITECTURE.md` you ran, and their result |

Only list what is really in the code. If an element has no counterpart (e.g. a modeled event the CRUD codebase has no equivalent for), say so explicitly — `— (persisted as the row insert, no event class)` — instead of leaving it out.

## Step 2 — Write the note

Reference board elements with `ref:<nodeId>` (the element ids from `slice.json`) so the note links back to them and keeps their current titles. Put code in backticks. Use this structure:

```markdown
# Implementation — <Slice Title>

**Commit** `<sha>` · **Type** <state-change|state-view|automation> · **Recorded** <YYYY-MM-DD> · **Checks** <build ✅ / tests ✅ (n passed)>

## Element → Code
| Element | Code | Where |
|---------|------|-------|
| ref:<commandId> | `RegisterMicrochipController#processCreationForm` — `POST /owners/{ownerId}/pets/{petId}/microchip/new` | `src/main/kotlin/.../microchip/RegisterMicrochipController.kt` |
| ref:<eventId> | insert into `microchips` via `MicrochipRepository#save` | `src/main/kotlin/.../microchip/MicrochipRepository.kt` |

## Fields
| Element | Field | Code |
|---------|-------|------|
| ref:<commandId> | `microchipNumber` | request param → `Microchip.microchipNumber` → column `microchips.microchip_number` |

## Specifications → Tests
| Specification | Test |
|---------------|------|
| <spec title> | `RegisterMicrochipControllerTest#<method>` |

## Files
**Created**
- `path/to/NewFile.kt`

**Modified (shared seams)**
- `path/to/schema.sql` — <what changed: new table / route / registration>

## Assumptions
- <one line each, or "none">
```

Keep it compact: one row per element, field and specification — no code excerpts, no narrative. Paths are repo-relative.

## Step 3 — Locate the slice's column

The slice border carries its chapter and column: `parentId` is the chapter (timeline) id, `data.colId` the column id.

Prefer MCP:

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<SLICE_ID>" }
```

**Fallback (no MCP):**

```bash
curl -s -H "x-token: <TOKEN>" -H "x-user-id: record-evidence-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<SLICE_ID>"
```

Save `parentId` as `CHAPTER_ID` and `data.colId` (or `meta.colId`) as `COLUMN_ID`.

## Step 4 — Find or add the "Implementation" lane

Read the chapter's grid:

```
mcp__eventmodelers__get_node { "boardId": "<BOARD_ID>", "nodeId": "<CHAPTER_ID>", "projection": "cells" }
```

```bash
curl -s -H "x-token: <TOKEN>" -H "x-user-id: record-evidence-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<CHAPTER_ID>?projection=cells"
```

In `rows`, look for a row with `type: "feedback"` and label `Implementation` (case-insensitive). Save its `id` as `ROW_ID`.

**Never write into any other feedback lane** — other lanes (e.g. `Decisions`) belong to the modeling kit or to people. If there is no `Implementation` lane, add one:

```
mcp__eventmodelers__add_lane { "boardId": "<BOARD_ID>", "timelineId": "<CHAPTER_ID>", "lanes": [{ "type": "feedback", "label": "Implementation" }] }
```

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/timelines/<CHAPTER_ID>/lanes" \
  -H "Content-Type: application/json" -H "x-token: <TOKEN>" -H "x-user-id: record-evidence-skill" \
  -d '{"type":"feedback","label":"Implementation"}'
```

and take `ROW_ID` from the response.

Then check `cells` for an entry with `rowId == ROW_ID` and `colId == COLUMN_ID`. If there is one, save its `nodeId` as `NOTE_ID` — this slice already has an evidence note (from an earlier build) and it gets **replaced**, not duplicated.

## Step 5 — Create or update the note

The note's content lives in `meta.description` (markdown source) — **not** `meta.content`, which is stored but never rendered.

**No note yet** — create it in the cell `<ROW_ID>-<COLUMN_ID>`:

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" -H "x-token: <TOKEN>" -H "x-user-id: record-evidence-skill" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:created",
    "nodeId": "<new-random-uuid>",
    "chapterId": "<CHAPTER_ID>",
    "cellId": "<ROW_ID>-<COLUMN_ID>",
    "meta": {
      "type": "MARKDOWN",
      "title": "Implementation — <Slice Title>",
      "description": "<markdown from step 2, JSON-escaped>"
    }
  }]'
```

**Note exists (`NOTE_ID`)** — replace its content:

```bash
curl -s -X POST "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events" \
  -H "Content-Type: application/json" -H "x-token: <TOKEN>" -H "x-user-id: record-evidence-skill" \
  -d '[{
    "id": "<new-random-uuid>",
    "eventType": "node:changed",
    "nodeId": "<NOTE_ID>",
    "changedAttributes": ["meta.title", "meta.description"],
    "meta": {
      "type": "MARKDOWN",
      "title": "Implementation — <Slice Title>",
      "description": "<markdown from step 2, JSON-escaped>"
    }
  }]'
```

With MCP, send the same event through `mcp__eventmodelers__submit_node_events { "boardId": "<BOARD_ID>", "events": [ ... ], "autoConnect": false }`.

Build the JSON body with a tool that escapes properly (e.g. `jq -n --arg d "$(cat note.md)" ...` or a short script) — never hand-escape newlines and quotes.

## Step 6 — Verify and report

Read the note back (`GET .../nodes/<noteId>`) and check that `meta.description` is non-empty and every `ref:` id is one from `slice.json`. Then report:

```
Recorded evidence for "<Slice Title>" (<SLICE_ID>)
Note: <noteId> in lane Implementation, column <COLUMN_ID> (created|updated)
Commit: <sha>
```

A failed write here never undoes the build: log it in `progress.txt` and continue with the status update — but do not skip this step silently.
