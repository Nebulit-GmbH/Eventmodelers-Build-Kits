---
name: analyze-existing-model
description: Analyze the existing event model on a board — summarizes contexts, slices, element counts, status breakdown, spec coverage, and structural gaps. Read-only, no board modifications.
---

# Analyze Existing Model

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

Read the full event model from a board and produce a structured analysis: what contexts exist, how many slices are in each state, which slices have GWT specs, and where the visible gaps are. This skill is read-only — it never posts comments or modifies the board.

---

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `contextName` | bounded context to focus on, e.g. `Ordering` | all contexts |
| `boardId` | a board UUID | from `connect` skill (`BOARD_ID`) |

If `boardId` is explicitly passed it overrides `BOARD_ID` from `connect`.

---

## Step 2 — List all slices

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices"
```

Response: `{ "slices": [{ "id": "<uuid>", "title": "<name>", "status": "<status>" }] }`

Save the full slice list. Count total slices and group by status:

| Status values |
|---------------|
| `Created`, `Planned`, `InProgress`, `Review`, `Done`, `Blocked`, `Assigned`, `Informational` |

---

## Step 3 — Discover contexts

Fetch all `MODEL_CONTEXT` nodes to identify bounded contexts on the board:

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT"
```

- If a `contextName` argument was given, filter to that single context and skip others.
- If no `MODEL_CONTEXT` nodes exist, continue with a single unnamed context scope.
- Record each context's `id` and `title`.

---

## Step 4 — Fetch slice data per context

For each resolved context, fetch the full element graph:

```bash
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=<CONTEXT_NAME>"
```

Each response contains a `slices` array. Each slice entry includes:
- `id`, `title`, `status`
- `elements`: array of `{ type, id, title, fields[] }`  — element types: `EVENT`, `COMMAND`, `READMODEL`, `SCREEN`, `AUTOMATION`
- `specs`: array of GWT scenarios (may be empty)
- `edges`: relationships between elements

Fetch all contexts in parallel if there are multiple. Merge results, keyed by context name.

---

## Step 5 — Analyse the model

Work through the collected data and compute the following for each context:

### 5a — Element inventory

Count elements by type across all slices in the context:

| Element type | Count |
|-------------|-------|
| EVENT | |
| COMMAND | |
| READMODEL | |
| SCREEN | |
| AUTOMATION | |

### 5b — Slice status breakdown

Group slices by status. Report counts per status. Flag any status that suggests blocked or stalled work (`Blocked`, `Created` with no changes).

### 5c — Spec coverage

For each slice, check whether `specs` is non-empty. Calculate:
- Slices **with** at least one GWT scenario
- Slices **without** any scenarios (grouped by slice type if detectable)

### 5d — Structural gaps per slice

For every slice, determine its type from the elements present and check for common structural issues:

| Slice type | Expect | Flag if missing |
|-----------|--------|-----------------|
| Command slice | SCREEN + COMMAND + EVENT | Any of the three absent |
| State-view slice | SCREEN + READMODEL | Either absent |
| Automation slice | AUTOMATION + EVENT | Either absent |

Do not flag gaps that are clearly intentional (e.g. a slice named "Internal" with no SCREEN). Use judgement — only surface gaps that look unintentional given the slice title.

### 5e — Orphaned elements

Check whether any EVENT, COMMAND, or READMODEL appears in zero slices (present on the board but not wired into any slice boundary). If the slicedata API does not expose this directly, skip this check and note it.

---

## Step 6 — Report to the user

Output a structured report. Never post anything to the board.

### Report format

```
## Model Analysis — <BOARD_ID>
Analysed: <ISO timestamp>

### Contexts (<n> found)
- <ContextName>: <n> slices

---

### Slice Status
| Status     | Count |
|------------|-------|
| Done       | x     |
| InProgress | x     |
| Planned    | x     |
| Created    | x     |
| Blocked    | x     |
| ...        | ...   |
Total: <n> slices

---

### Element Inventory  [per context]
| Type        | Count |
|-------------|-------|
| EVENT       | x     |
| COMMAND     | x     |
| READMODEL   | x     |
| SCREEN      | x     |
| AUTOMATION  | x     |

---

### Spec Coverage
- <n> of <total> slices have at least one GWT scenario (<pct>%)
- Slices without specs: <list titles, max 10, then "and N more">

---

### Structural Gaps
<list only genuine gaps — slice title + what's missing>
(none) if everything looks complete

---

### Summary
<2–4 sentences: overall model maturity, the most important gap or risk, one concrete suggestion>
```

If a context was specified but not found, tell the user clearly and list the contexts that do exist.

---

## Example — full board analysis

```bash
# 1. List slices
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata/slices"

# 2. Fetch MODEL_CONTEXT nodes
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=MODEL_CONTEXT"

# 3. Fetch full slice data for a context
curl -s \
  -H "x-token: $TOKEN" \
  -H "x-board-id: $BOARD_ID" \
  -H "x-user-id: analyze-existing-model" \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/slicedata?contextName=Ordering"
```

Replace `$TOKEN`, `$ORG_ID`, `$BOARD_ID`, and the context name with real values resolved from the `connect` skill.
