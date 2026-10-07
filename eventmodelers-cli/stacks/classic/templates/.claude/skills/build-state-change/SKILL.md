---
name: build-state-change
description: Implements a state-change slice (command → validated state transition) inside an existing codebase, following the architecture recorded in .build-kit/ARCHITECTURE.md — typically a CRUD service method + endpoint + persistence, not necessarily event-sourced
---

# Build State Change Slice

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for all fields, events, and metadata — never invent fields not defined there.

> Then read `.build-kit/ARCHITECTURE.md` (run `/learn-architecture` if it is missing). It decides **how** the slice is built: which layers, which reference feature to copy, how events map onto persistence, how tests look, and which commands to run.

---

## What a State Change Slice is

A state-change slice accepts a command, checks it against the current state and the business rules in its specifications, and — if it is allowed — records the resulting state transition (the slice's event(s)).

In this codebase that usually means: an entry point (endpoint/handler/action) receives the command's fields, a service method validates them against the current persisted state, and the change is written through the existing persistence layer. Only if `ARCHITECTURE.md` says the codebase is event-based are the events materialized as event objects.

---

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the slice title (names the command/use case)
- **context** — the bounded context (maps to the module/package/feature area named in `ARCHITECTURE.md`)
- **commands[]** — list of commands with their data fields
- **events[]** — list of events emitted by each command — their fields are the state the command must persist
- **specifications[]** — test scenarios (given/when/then)
- **storylines[]** (optional) — present only when the board author built an explicit walkthrough for this flow; most slices have none. See "Storyline-derived tests" under Step 5.

> **Comments & description**: each element carries a `comments: string[]` array (board comments) and a `description` field — use them as implementation hints, and resolve consumed comments via `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

---

## Step 2 — Check what already exists

Search the codebase for the command name, event names, the entity they act on, and the key fields. A slice that reappears as `Planned` may be partly or fully implemented already — then this skill is a **diff**: update the existing code to match slice.json field by field, add missing specifications, remove fields slice.json no longer has. Never dismiss a mismatch as harmless drift.

Also find the entity/table the events write to. If it exists, extend it; if not, create it the way the reference implementation creates one (entity + migration, schema file, ...).

## Step 3 — Map the slice onto the reference write path

Open the **write** reference implementation from `ARCHITECTURE.md` and build the same shape for this slice, file by file, in the same locations and with the same naming:

| From slice.json | Becomes (per `ARCHITECTURE.md`) |
|---|---|
| command + its fields | input DTO/request type and the entry point that receives it, with the same validation style as the reference |
| business rules (from specifications whose `then` is an error, plus `description`/`comments`) | checks in the service/use case, failing the way the codebase fails (exception type, result type, error response) |
| event(s) + their fields | the persisted state change: entity fields/columns set, rows inserted/updated/deleted. In an event-based codebase: the event types, appended/published the existing way |
| event that represents a status transition (`...Approved`, `...Cancelled`) | the field/status column update the codebase uses for such transitions |

Rules:
- Every command field, every event field ends up somewhere concrete — persisted, validated or returned. A field with no destination is a gap: record your assumption.
- No fields that are not in slice.json. Technical columns the codebase always adds (ids, timestamps, version, audit) are fine if every comparable entity has them.
- Schema changes go through the codebase's migration mechanism — add a new migration, never edit an existing one.
- Follow the codebase's transaction, auth and error-mapping conventions exactly as the reference does.

## Step 4 — Expose it

Expose the command the way comparable writes are exposed (REST endpoint, RPC method, message handler, UI/server action, ...), including whatever registration, routing, API documentation or permission config the reference has. If comparable writes are not exposed externally (pure domain service), don't add an entry point.

## Step 5 — Write the tests

Write one executable test per entry in `specifications[]`, in the test style and location of the reference test:

- **given** — each given event becomes pre-existing state: insert the equivalent rows via the codebase's fixtures/builders/repositories, or execute the earlier commands that produce that state if that is how the reference tests set up data. An empty `given` means a clean state.
- **when** — invoke the command through the same layer the reference tests use (service call, HTTP request, handler).
- **then** — for events: assert the persisted state (or the published events, in an event-based codebase) carries exactly the event fields and example values; for an error: assert the codebase's failure (exception, error result, status code).

Name each test after the specification title so it can be traced back to the board.

### Storyline-derived tests (optional)

`storylines[]` in slice.json (optional — only present when the board author built an explicit walkthrough) can supply additional tests. A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need to match beats against `commands[]` by id/title. Scan each storyline's ordered `elements` for a `type: COMMAND` beat followed by its EVENT beat(s):

- `given` — the cumulative ordered events from the start of the storyline up to (not including) the command beat, set up as state as above
- `when` — the command, built from that beat's `fields`
- `then` — the following EVENT beat(s)' data, asserted on the resulting state

Group these separately (own test class/`describe`/region, named after the storyline), on top of — never instead of — the specification tests.

## Step 6 — Quality gate

Run the build command and the single-test command from `ARCHITECTURE.md` for the tests this slice added or changed. Do not run the full suite.

---

## Final Verification: Does the Implementation Match slice.json?

- [ ] Every command field is received and used (validated, persisted or passed on)
- [ ] Every event field is persisted (or published) with the expected value
- [ ] Every specification has exactly one corresponding, passing test
- [ ] If `storylines[]` is present, a storyline-derived test was added for every COMMAND beat
- [ ] No business rules, defaults, or constraints were added that do not appear in slice.json `description`, `comments` or specifications
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
- [ ] The new code mirrors the reference implementation's layout, naming and conventions; no new framework, library or architectural style was introduced
- [ ] Assumptions are recorded in `progress.txt` and as code comments
