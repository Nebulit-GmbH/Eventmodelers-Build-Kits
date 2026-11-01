---
name: scenario-coverage
description: Calculate how much of each slice's business logic its Given/When/Then scenarios cover, for one chapter (or all), and store it on the slice's specification node as `meta.data.coverage` — percentage plus the meaningful scenarios still missing. The canvas shows the percentage on the spec lane (red < 50, orange < 70, green otherwise).
---

# Scenario Coverage

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`.

Prefer `mcp__eventmodelers__*` tools when available. Only the coverage value is written; scenarios, elements and slice status are never changed.

## Step 1 — Arguments

From `$ARGUMENTS`: the **chapter** (timeline title) to work on; none given = every chapter. If a name matches several, ask.

## Step 2 — Read the chapter

```
mcp__eventmodelers__get_slice_data { "boardId": "$BOARD_ID", "contextName": "<CHAPTER>", "projection": "fields", "format": "toon" }
mcp__eventmodelers__get_slice_data { "boardId": "$BOARD_ID", "contextName": "<CHAPTER>", "projection": "specs", "format": "toon" }
```

`fields` gives each slice's elements, fields and dependencies; `specs` gives its scenarios. Find each slice's specification node (the SCENARIO / spec-lane node of its column) with `get_nodes` (`type: "SCENARIO"`) — its id is where the result is written. A slice without one: skip it and say so.

## Step 3 — Derive the real use cases, per slice

Work out what the slice's business logic actually has to do, from its command / read model / automation, fields, dependencies and the events involved:

- the happy path(s) and meaningful variants of them,
- each business rule and **every way the business would reject or alter the outcome** (validation of a field with a rule behind it, duplicates, state preconditions, limits, authorisation that the model shows),
- every distinct event outcome of a command; for a read model, each distinct projection behaviour (what appears, changes, disappears).

**Only meaningful scenarios count — both for what exists and for what is missing.** A scenario that is technically possible but means nothing to the business is not a use case: don't invent it, don't list it as missing, and an existing scenario that only restates another one, tests a framework/technical behaviour (null checks, type errors, malformed JSON, "field is empty" with no rule behind it) or can never occur in the process adds nothing to the coverage. Ask of each candidate: *would a domain expert care that this case behaves as specified?* If not, drop it.

## Step 4 — Calculate

`percentage = round(100 × covered meaningful use cases ÷ all meaningful use cases)`. A use case is covered when an existing, meaningful scenario specifies exactly its given / when / then outcome. A slice with no business logic to speak of (a pure pass-through) with one scenario is 100; with no use cases derivable, don't write a value. Be honest — don't round up to look good; the number guides what to model next.

For every uncovered meaningful use case add an entry to `missing`: a short `title` and, where the model lets you say it, `given`, `when`, `then` (one short plain sentence each, in the model's own vocabulary and with concrete values only if the model has them). Leave a part out rather than guess. Max 10 entries, most important first.

## Step 5 — Store it

Read the spec node first (`get_node`) and keep its whole existing `meta`; add only `data.coverage`, preserving anything else already in `data`:

```
"data": { "coverage": { "percentage": 78, "missing": [ { "title": "Reject a rental of an already rented bike", "given": "bike B-1 is rented", "when": "a customer rents B-1", "then": "the rental is rejected" } ] } }
```

Send it as a `node:changed` event for the spec node (`changedAttributes: ["data"]`, `meta` = existing meta + `data`) with `mcp__eventmodelers__submit_node_events`, or via `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events` with the same body. Write coverage again on a rerun — it replaces the old value.

## Step 6 — Report

Post a `table` snippet (columns Slice · Coverage · Missing; slice as a link to its node), plus a one-line summary: slices rated, average, the lowest three. Always include a plain `text`.
