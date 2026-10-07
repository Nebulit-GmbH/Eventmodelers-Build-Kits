---
name: learn-architecture
description: Analyzes the existing codebase once and writes .build-kit/ARCHITECTURE.md — layers, feature layout, persistence, how writes/reads/background work are built, test style, build/test commands, and the slice map — which code every existing (Done) slice on the board corresponds to, and the mapping pattern they share. Run before the first slice is built, when ARCHITECTURE.md is missing or stale, or with `slices` when Done slices are missing from the slice map.
---

# Learn Architecture

The classic build kit implements slices inside a codebase it did not create. Before any slice is built, the agent has to know how *this* codebase builds a feature — otherwise every slice drifts toward a generic pattern. This skill finds that out once and writes it down in `.build-kit/ARCHITECTURE.md`, which every `build-*` skill reads instead of re-exploring.

**The typical situation is a legacy system.** Someone ran a code base analysis (`analyze-code-base`), built the event model from the existing code, and now extends it. Most slices on the board therefore *already exist in the code* — usually in status `Done` — and their elements' `description`s carry code references (`path/to/File.java:57`, `Class#method`, tables, endpoints). Those slices are the most valuable input this skill has: each one is a worked example of how a COMMAND, EVENT, READMODEL or AUTOMATION from *this* board is realized in *this* code. The mapping is learned from them first, and from generic code reading only where no slice covers it.

**Arguments** (optional):
- `refresh` — re-analyze and rewrite `ARCHITECTURE.md` even if it exists.
- `slices` — keep everything else, only bring the **Slice map** up to date (Steps 2–3, then only the **Slice map** and *Code vs. board terms* sections in Step 6): add Done slices that are missing from it, re-check rows whose code moved.

If `.build-kit/ARCHITECTURE.md` exists and neither argument was passed: read it, then compare its **Slice map** against the `Done` slices in the local `index.json` files. If every Done slice has a row, return. Otherwise run as `slices`.

---

## Step 1 — Identify the stack

Read the build/dependency files at the project root and one level down (`package.json`, `pom.xml`, `build.gradle*`, `*.csproj`/`*.sln`, `pyproject.toml`, `go.mod`, `Gemfile`, `composer.json`, `Cargo.toml`, ...), plus `README*`, any existing `CLAUDE.md`/`AGENTS.md`/`CONTRIBUTING.md`, `docker-compose*`, and CI config (`.github/workflows/*`, `.gitlab-ci.yml`, ...).

Record: language + version, framework(s), persistence (database, ORM/query layer, migration tool), messaging if any, test framework(s), and the exact commands to build, run all tests, and run a **single** test file/class. Prefer what CI actually runs over what a README claims. Do not guess a command — if one can't be determined, say so in `ARCHITECTURE.md`.

## Step 2 — Collect the existing slices

Make sure the slice files are present (`/load-slice` without arguments refreshes all of them), then read every `.build-kit/.slices/*/index.json`. This is read-only reference work, so it covers **all** contexts, not only the current one.

Every slice with status `Done` is already implemented — treat it as a precedent. Slices in other statuses (`Created`, `Planned`, ...) may also carry code references from the analysis (the code exists, the slice was just never marked Done); include them when their descriptions point at code. Sort each slice by type the way `CLAUDE.md` *Building a Slice* does (state-change / state-view / automation / translation).

For each such slice, read its `slice.json` and collect the code references from:
- the `description` (and `comments`) of the slice and of every command, event, read model, screen and processor — paths with line numbers, `Class#method`, tables, endpoints, tests, templates;
- if the board is reachable and the chapter has them: the `Legacy Sources — <Chapter>` note (*Where this flow lives*) and the `Decisions — <column>` notes in the chapter's **Decisions** lane (`get_nodes { boardId, type: "MARKDOWN", projection: "line" }` for the ids, then read only the notes of chapters you need). They map elements to code with exact references and record code-vs-board term differences (`PetType` → *Species*).

A slice without any reference is located by search instead (Step 3).

## Step 3 — Map each existing slice onto its code

For every slice from Step 2, find the code that implements it. Open the referenced files (or search for the command/event/read model names, their fields, and the code terms from the Decisions notes) and record, per slice:

- **COMMAND** → entry point (endpoint/handler/action) + input DTO + service method
- **EVENT** → what it writes: entity/table + columns, status column + value, or the published event class
- **READMODEL** → query/repository method + response DTO + endpoint
- **AUTOMATION / processor** → listener/consumer/job + what it calls
- **Specifications** → the test class/method that covers them, if any

Verify, don't copy: a line number may be stale, a file may have moved. Fix the reference in the map; if a slice's code can't be found at all, record it as `not found` — never treat it as a feature to build, and never invent a location.

Then **look for the pattern across slices**. The same board construct is usually realized the same way every time — e.g. every `... Registered` event is an insert into the aggregate's table, every `... Approved/Cancelled` event is an update of a `status` column, every read model is a repository method + DTO in the same package, every automation is a `@Scheduled` job. That shared pattern *is* the Event Modeling mapping of this codebase (Step 5). Where slices are realized differently (two persistence styles, an old and a new module), record both and which slices use which, so a new slice can follow its nearest neighbour.

Do not read the whole codebase — follow the references.

## Step 4 — Fill the gaps with reference features

Only for what the existing slices don't cover (no Done slices at all, or e.g. no automation among them) pick **one or two existing features** that look like the slices the board will produce — something that accepts input and changes state, something that only reads/lists data. A recently changed, ordinary feature is a better reference than the oldest or the most special one (`git log --stat -20` helps). When existing slices cover a path, the best-mapped Done slice of that type *is* the reference implementation.

Trace each one end to end, reading only the files on that path:

- **Write path**: entry point (controller/route/handler/form action) → input DTO + validation → service/use case → domain object/entity → repository/DAO → schema/migration → response and error mapping.
- **Read path**: entry point → query/repository → response DTO → pagination/filtering conventions.
- **Background/reactive work**: anything that reacts to a state change — event listeners, after-commit hooks, message consumers, schedulers/cron jobs, outbox. Note if there is none.
- **Tests**: where they live, unit vs. integration, how state is set up (fixtures, builders, factories, test containers, in-memory DB, mocks), how assertions are written.

Do not read the whole codebase. Search (`grep`/glob) for a concept, then follow references.

## Step 5 — Decide the Event Modeling mapping

Decide how each board element is built **in this codebase**, based on what the existing slices show (Step 3) and, only where they say nothing, on the reference features (Step 4) — not on Event Modeling theory:

- **Is it event-based?** Only if the code already persists or publishes events (event store, domain events, outbox, audit log of facts). Otherwise it is state-based (typically CRUD) and board EVENTs become the state transitions a command persists, not new event classes.
- **COMMAND** → which entry point + DTO + service method shape, and where business-rule violations go (exception type, result type, validation error).
- **EVENT** → the persisted change (tables/columns written), or the existing event mechanism if there is one.
- **READMODEL** → query + response DTO; when a new table/view/materialized projection is justified versus querying existing tables.
- **AUTOMATION / processor** → the existing reactive mechanism (or, if none exists, the least invasive option consistent with the codebase — usually a direct call or a scheduled job; note that choice explicitly).
- **Specification (given/when/then)** → how `given` events become pre-existing state in a test, and what `then` asserts on.

Then decide **where a new slice goes so it stays isolated and deletable**. Existing slices show how the code *is* built; new slices follow those conventions but are placed as self-contained as the codebase allows — ideally, removing a slice means deleting its own files plus undoing a short, known list of registrations. Settle, from what the codebase tolerates:

- **Own unit per slice** — the most local place the layout allows: a package/folder per slice inside the context's module (best), otherwise own files (controller, DTOs, service/handler, query, test) next to the comparable ones — never new methods appended to an existing shared service, controller or repository when a separate class registered the same way works just as well.
- **Shared seams** — the unavoidable touch points (router/DI registration, a menu entry, a schema migration, an existing entity that must gain a column) and how to keep each one to a single, small, recognisable change.
- **Dependencies between slices** — a new slice reads shared state through the existing entity/repository (or the codebase's query style), never by calling another slice's internals; no other slice depends on the new one.
- **Data** — new state goes into a new table or new columns via a new migration; existing columns are not repurposed.

Where the codebase genuinely forces a shared file (one big controller per aggregate, a central route file), follow it — and record that the slice touches it.

## Step 6 — Write `.build-kit/ARCHITECTURE.md`

Keep it short and concrete — paths, class names and commands, not prose. Use this structure:

```markdown
# Architecture

## Stack
- Language/framework/persistence/test framework (with versions)
- Architecture style: e.g. layered CRUD (controller → service → JPA repository), or event-sourced, or ...

## Commands
- Build: `...`
- All tests: `...`
- Single test: `...` (with a concrete example)
- Other checks CI runs (lint, format, typecheck): `...`

## Where a feature lives
- Layout of one feature, with the reference feature as a concrete tree
- Naming conventions (classes, files, endpoints, tables, columns)

## Reference implementations
Prefer a mapped Done slice per type; a plain feature only where no slice covers the type.
- Write: slice *Register Owner* — `path/to/Controller` → `path/to/Service` → `path/to/Repository` (+ migration)
- Read: ...
- Background: ... (or "none")
- Tests: `path/to/ReferenceTest` — how state is set up and asserted

## Event Modeling mapping
Derived from the slices in the Slice map — cite the slices that show each row.
| Board element | Built as | Seen in |
|---|---|---|
| COMMAND | ... | *Register Owner*, *Book Visit* |
| EVENT (creation) | ... | ... |
| EVENT (status transition) | ... | ... |
| READMODEL | ... | ... |
| AUTOMATION | ... | ... |
| Specification | ... | ... |

## Code vs. board terms
| Code | Board |
|---|---|
| `PetType` | *Species* |

## Slice map
Every slice that exists in the code. One row per slice; paths relative to the repo root. `Shared seams` lists the shared files a slice changed — for slices built by the kit it is the deletion checklist.
| Slice | Context | Type | Status | Command / entry point | Persistence (events) | Read / query | Trigger | Tests | Shared seams |
|---|---|---|---|---|---|---|---|---|---|
| Register Owner | owners | state-change | Done | `OwnerController#processCreationForm` → `OwnerService#register` | `owners` insert | — | — | `OwnerControllerTests` | legacy |
| Owner Details | owners | state-view | Done | `GET /owners/{id}` | — | `OwnerRepository#findById` → `OwnerDto` | — | ... | legacy |
| Remind Visit | visits | automation | Done | `VisitService#remind` | `visits.reminded_at` | — | `VisitReminderJob` (`@Scheduled`) | ... | legacy |

## New slices — isolation
- Placement: e.g. `src/main/java/org/acme/<context>/<slicename>/` with `<Slice>Controller`, `<Slice>Request`, `<Slice>Handler`, `<Slice>Test`
- Shared seams (the only shared files a slice may touch): `RouteConfig.java` (one line), `db/migration/V<n>__<slice>.sql` (new file), ...
- Codebase constraints that force sharing, and what to do then

## Rules
- Conventions a new slice must follow (transactions, validation, error mapping, auth, migrations append-only, ...)
- Files a slice must not touch (app bootstrap, global config, lockfiles, ...)
```

## Step 7 — Verify the commands

Run the build command and the single-test command against one existing test. If either fails for reasons unrelated to the code (missing service, missing env var), record the prerequisite under **Commands**. Do not "fix" the project to make it pass.

Commit `ARCHITECTURE.md` on its own: `chore: document architecture for build kit` (with `slices`: `chore: update slice map`).

## Keeping the slice map current

The `build-*` skills add a row for every slice they build, so the map grows with the code. When a later code base analysis puts new Done slices on the board, the next build notices the missing rows and runs this skill with `slices` — only those slices are mapped, the rest of `ARCHITECTURE.md` stays as it is.
