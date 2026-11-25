---
name: summarize-scenarios
description: Summarize all Given/When/Then scenarios (and storylines) of one slice into a single consistent, readable narrative text — what the slice does, which rules it enforces, which cases are accepted or rejected, with the concrete example values woven in — and store it as the documentation (`meta.description`) of the slice's specification node. Rerunning replaces the previous text. Use for reviews, stakeholder read-outs, onboarding, or as a plain-language spec.
---

# Summarize Scenarios — a slice's scenarios as one narrative

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`.

Prefer `mcp__eventmodelers__*` tools when available. **The only thing this skill writes is the documentation text on the slice's specification node** — no scenarios, elements or statuses change. If the scenarios are wrong or thin, say so in the report; fixing them is `eventmodeling-elaborating-scenarios`.

Result: one coherent prose text per slice that a domain expert can read top to bottom — not a list of scenarios re-typed, but the *behaviour* the scenarios jointly specify.

## Step 1 — Arguments

From `$ARGUMENTS`: the **slice** (id or title) and optionally `chapter`, `audience` (`business` default | `developer`), `language` (default: the language of the slice's element names), `file` (path to also write the text to). No slice given → ask which one; several slices share the title → list them and ask. Several slices requested → run Steps 2–5 per slice, one text each.

## Step 2 — Read the slice once

```
mcp__eventmodelers__get_slice_data { "boardId": "$BOARD_ID", "contextName": "<CHAPTER>", "sliceId": "<SLICE_ID>", "projection": "specs", "format": "toon" }
mcp__eventmodelers__get_slice_data { "boardId": "$BOARD_ID", "contextName": "<CHAPTER>", "sliceId": "<SLICE_ID>", "projection": "fields", "format": "toon" }
```

`specs` gives the scenarios (`title`, `given`, `when`, `then`, `context`, `expectError`/`errorDescription`, `contextNote`, example `fields`/`examples`) and storylines (ordered `beats`); `fields` gives the slice's command / read model / events with their field names, so you can describe a value by its name. Resolve the chapter name via `list_slices` if only an id was given. Also find the slice's **specification node** (the SCENARIO / spec-lane node of its column) with `get_nodes` (`type: "SCENARIO"`, scoped by `chapterId`) — its id is where the text goes. A slice without one: report it and stop; don't create one. Locally persisted slices (`.slices/**/slice.json`) work the same way if the board is not reachable — their `specifications` are the same data.

A slice with no scenarios and no storylines: stop and report that there is nothing to summarize (suggest `eventmodeling-elaborating-scenarios`). Never invent behaviour the scenarios don't state.

## Step 3 — Understand before writing

Group, don't transcribe. Work out, from the scenarios and the slice's elements:

1. **Purpose** — what the command / read model / automation is for, in one sentence (the slice's title and its element names tell you).
2. **The normal case(s)** — scenarios that end in a success event or in the expected read-model state.
3. **The rules** — what each scenario's *given* establishes that changes the outcome: thresholds, duplicates, state preconditions, time limits. Merge scenarios that illustrate the same rule into one statement with its examples.
4. **The rejections** — scenarios with `expectError` or a rejecting outcome: what is refused, and why (`errorDescription`).
5. **Lifecycles** — storylines: tell them as one story in beat order (what the list shows first, what happens, what it shows next).
6. **Values** — only the example values that carry a rule (the dates, the wrong token, the amount on the wrong side of a limit, the linking id). Skip the rest; the scenarios left other fields empty on purpose.

## Step 4 — Write the narrative

One consistent text, in this shape (omit a section the slice has nothing for):

```
# <Slice title> — what it does

<Purpose: 1–2 sentences.>

## The normal flow
<Prose. Who does what, what happens as a result. Concrete example from the happy-path scenario.>

## Rules
<One short paragraph or bullet per rule, each grounded in a scenario's example:
"A second registration with the same e-mail (anna@example.com) is refused — the customer is already known.">

## What is refused
<Rejections and their reasons.>

## How it develops over time
<Storyline(s) as one story: first…, then…, finally…>

## Open points
<Only if real: scenarios that contradict each other, a rule hinted at but not specified, a case a reader would expect and none covers.>
```

Style rules — they make it read as *one* text rather than a scenario dump:

- **Consistent voice and tense**: present tense, third person, one vocabulary. Use the model's own names for things (the event `OrderPlaced` is "the order is placed" for business, `OrderPlaced` for developer audience) and the same word for the same thing throughout.
- **Business audience (default)**: no "Given/When/Then", no "scenario 3", no "event/command/projection" unless the slice is a developer topic. Say *what the business does and which rule applies*.
- **Developer audience**: name the command, the events it produces, the read model it feeds; still prose, not a table.
- **Order** by importance: normal flow → rules → rejections → lifecycle, not by scenario order on the board.
- **Examples inline** and short: *"an order of €120 qualifies for free shipping; one of €99.90 does not."* Never paste whole step field lists.
- **Every scenario is accounted for** by some sentence; none is quoted by title. If two scenarios say the same thing, one sentence covers both.
- No padding, no marketing language, no advice. Length follows the content: a slice with 3 scenarios gets a few paragraphs, not a page.

## Step 5 — Store it as documentation on the spec node

Read the spec node first (`get_node`) and keep its whole existing `meta`; set only `meta.description` to the markdown text (the node's documentation — rendered as markdown in the doc and slice views; **not** `meta.content`, which is never rendered). Whatever was in `description` before is replaced, so a rerun refreshes the text. Link elements with `ref:<nodeId>` where it helps a reader jump to them (see `learn-eventmodelers-api` → "Linking to elements in markdown"), but keep the prose readable without the links.

Send it as a `node:changed` event for the spec node (`changedAttributes: ["description"]`, `meta` = existing meta + `description`) with `mcp__eventmodelers__submit_node_events`, or via `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/events` with the same body. Several slices = one batched array of `node:changed` events.

If `file` was given, write the same text there too; otherwise create no files.

## Step 6 — Report

One line per slice: slice, spec node, number of scenarios and storylines summarized, open points found. Include the text itself in the reply only when no write was possible.
