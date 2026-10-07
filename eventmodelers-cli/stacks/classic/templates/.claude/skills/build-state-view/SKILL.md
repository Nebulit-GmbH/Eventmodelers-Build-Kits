---
name: build-state-view
description: Implements a state-view slice (read model served from previously recorded state) inside an existing codebase, following the architecture recorded in .build-kit/ARCHITECTURE.md — typically a query + response DTO + read endpoint over existing tables, not necessarily a projection
---

# Build State View Slice

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for all fields, events, and metadata — never invent fields not defined there.

> Then read `.build-kit/ARCHITECTURE.md` (run `/learn-architecture` if it is missing). It decides **how** the slice is built: which layers, which reference feature to copy, where reads come from, how tests look, and which commands to run.

---

## What a State View Slice is

A state-view slice answers a question with data that earlier state changes recorded: the read model's fields are derived from the events that feed it.

In a CRUD codebase there is usually no projection to maintain — the events were persisted as rows by their state-change slices, so the read model is a **query** over those tables plus a response DTO and a read entry point. A dedicated table, view or projection is only justified when `ARCHITECTURE.md` says the codebase uses them, or the read genuinely can't be answered from existing data.

---

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the slice title (names the query/read model)
- **context** — the bounded context (maps to the module/package/feature area named in `ARCHITECTURE.md`)
- **readmodels[]** / **projections[]** / **queries[]** — the read model(s) this slice serves, with their fields
- the **events** feeding each read model — they tell you which persisted state the fields come from
- **specifications[]** — test scenarios (given events → expected read model)
- **storylines[]** (optional) — present only when the board author built an explicit walkthrough for this flow; most slices have none. See "Storyline-derived tests" under Step 5.

> **Comments & description**: each element carries a `comments: string[]` array (board comments) and a `description` field — use them as implementation hints, and resolve consumed comments via `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

---

## Step 2 — Locate the source data

For every read model field, find where the feeding event's data is persisted (the entity/table/column written by that event's state-change slice). Search by event name, entity and field names.

- **Found** → the field is read from there.
- **Not persisted anywhere** (the state-change slice isn't built yet, or never stored that field) → do not invent a parallel store. Add the missing column/entity the way the reference does (new migration) only if it clearly belongs to this read; otherwise record the gap as an assumption in `progress.txt` and as a code comment.

If the slice reappears as `Planned` and a query for it already exists, treat this skill as a **diff** against slice.json: add missing fields, remove fields slice.json no longer has, add missing specifications.

## Step 3 — Map the slice onto the reference read path

Open the **read** reference implementation from `ARCHITECTURE.md` and build the same shape, in the same locations and with the same naming:

| From slice.json | Becomes (per `ARCHITECTURE.md`) |
|---|---|
| read model + its fields | response DTO with exactly these fields |
| how events shape the read model (list vs. single item, filters, status mapping, latest-wins) | the query: joins, filters, ordering, status derivation — in the codebase's query style (repository method, ORM query, SQL, ...) |
| key/id fields and how the read is addressed | query parameters / path variables, matching how comparable reads are addressed |
| list-shaped read models | pagination/sorting the way comparable list endpoints do it — only if they do |

In an event-based codebase (per `ARCHITECTURE.md`), build the projection/read-model updater the existing way instead and register it like the reference does.

## Step 4 — Expose it

Expose the read the way comparable reads are exposed (REST endpoint, RPC, UI loader, ...), including registration, routing, API documentation and permission config, mirroring the reference. If the read is only consumed internally (e.g. by an automation's todo list), a service/repository method is enough.

## Step 5 — Write the tests

Write one executable test per entry in `specifications[]`, in the test style and location of the reference test:

- **given** — the given events become pre-existing state: insert the equivalent rows via the codebase's fixtures/builders/repositories, or run the commands that produce them if that's how the reference tests set up data.
- **when** — run the query through the same layer the reference tests use.
- **then** — assert the returned read model matches the expected fields and example values exactly (including an empty result where the spec expects one).

Name each test after the specification title.

### Storyline-derived tests (optional)

`storylines[]` in slice.json is optional — present only when the board author explicitly built a walkthrough for this flow. When present, mine it for **additional** tests, on top of (never instead of) the specification tests.

A storyline is `{ id, title, elements: [...] }`, where `elements` is an ordered list of beats — the same element can repeat to show its state at different points in the flow. A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need to match beats against `readmodels[]` by id/title. Scan for a pair of adjacent beats that are both `type: READMODEL`, with only EVENT beat(s) between them and no COMMAND beat in that run. That pair is one self-contained test:

- `given` — the cumulative ordered events from the start of the storyline through the intervening event beat(s), set up as state
- `then` — the second READMODEL beat's fields

Group these separately, named after the storyline. Skip a beat pair when a COMMAND beat sits in between (that half belongs to build-state-change) or when the run includes a SCREEN/AUTOMATION beat with no traceable event — a one-line comment noting the storyline segment exists is enough.

## Step 6 — Quality gate

Run the build command and the single-test command from `ARCHITECTURE.md` for the tests this slice added or changed. Do not run the full suite.

---

## Checklist

- [ ] Every read model field is returned, sourced from where its feeding event's data is persisted
- [ ] No extra fields in the response that are not in slice.json
- [ ] No parallel data store was invented for data that already exists
- [ ] Every specification has exactly one corresponding, passing test
- [ ] If `storylines[]` is present, a storyline-derived test was added for every isolable read-model transition (adjacent READMODEL beats with only EVENT beats between them)
- [ ] The new code mirrors the reference implementation's layout, naming and conventions; no new framework, library or architectural style was introduced
- [ ] Assumptions and data gaps are recorded in `progress.txt` and as code comments
