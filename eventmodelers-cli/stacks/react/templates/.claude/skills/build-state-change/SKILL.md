---
name: build-state-change
description: TODO — one-line description of how a write-side slice (command validated against replayed events, new events emitted) is implemented for your stack (see an existing stack's build-state-change/SKILL.md under stacks/<name>/templates/.claude/skills/ for the level of detail expected)
---

# Build State Change Slice

> **TODO — placeholder installed by `init --build-kit`.** Study an existing stack's
> build-state-change/SKILL.md (stacks/node, stacks/supabase, stacks/axon, or stacks/cratis-csharp,
> under `templates/.claude/skills/`) for the level of detail expected, then rewrite
> every section below for your stack's real conventions — file layout, naming, and
> the actual framework/language idioms. Delete this callout once done.

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`.
> This file is the **source of truth** for all fields, events, and metadata — never invent
> fields not defined there. Keep this line verbatim; it applies to every stack.

---

## What a State Change Slice is

TODO — describe a write-side slice (command validated against replayed events, new events emitted) in terms of your stack's own primitives.

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the slice title
- **context** — the bounded context
- **commands[]** — list of commands with their data fields
- **events[]** — list of events emitted by each command
- **specifications[]** — test scenarios (given/when/then)

> **Comments & description**: each element carries a `comments: string[]` array (board comments) and a `description` field — use them as implementation hints, and resolve consumed comments via `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

---

## Step 2 — TODO (your stack-specific implementation steps)

TODO — file layout, naming conventions, framework idioms, how the handler/projection/reactor is wired up.

## Quality gate

TODO — this stack's build command and how to run only this slice's tests (not the full suite).
