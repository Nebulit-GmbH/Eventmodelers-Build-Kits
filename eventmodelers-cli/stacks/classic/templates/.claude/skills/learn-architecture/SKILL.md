---
name: learn-architecture
description: Analyzes the existing codebase once and writes .build-kit/ARCHITECTURE.md — layers, feature layout, persistence, how writes/reads/background work are built, test style, build/test commands, and how Event Modeling slices map onto it. Run before the first slice is built, or when ARCHITECTURE.md is missing or stale.
---

# Learn Architecture

The classic build kit implements slices inside a codebase it did not create. Before any slice is built, the agent has to know how *this* codebase builds a feature — otherwise every slice drifts toward a generic pattern. This skill finds that out once and writes it down in `.build-kit/ARCHITECTURE.md`, which every `build-*` skill reads instead of re-exploring.

**Arguments** (optional): `refresh` — re-analyze and rewrite `ARCHITECTURE.md` even if it exists.

If `.build-kit/ARCHITECTURE.md` exists and `refresh` was not passed, stop: read it and return.

---

## Step 1 — Identify the stack

Read the build/dependency files at the project root and one level down (`package.json`, `pom.xml`, `build.gradle*`, `*.csproj`/`*.sln`, `pyproject.toml`, `go.mod`, `Gemfile`, `composer.json`, `Cargo.toml`, ...), plus `README*`, any existing `CLAUDE.md`/`AGENTS.md`/`CONTRIBUTING.md`, `docker-compose*`, and CI config (`.github/workflows/*`, `.gitlab-ci.yml`, ...).

Record: language + version, framework(s), persistence (database, ORM/query layer, migration tool), messaging if any, test framework(s), and the exact commands to build, run all tests, and run a **single** test file/class. Prefer what CI actually runs over what a README claims. Do not guess a command — if one can't be determined, say so in `ARCHITECTURE.md`.

## Step 2 — Find reference features

Pick **one or two existing features** that look like the slices the board will produce — something that accepts input and changes state, and something that only reads/lists data. A recently changed, ordinary feature is a better reference than the oldest or the most special one (`git log --stat -20` helps).

Trace each one end to end, reading only the files on that path:

- **Write path**: entry point (controller/route/handler/form action) → input DTO + validation → service/use case → domain object/entity → repository/DAO → schema/migration → response and error mapping.
- **Read path**: entry point → query/repository → response DTO → pagination/filtering conventions.
- **Background/reactive work**: anything that reacts to a state change — event listeners, after-commit hooks, message consumers, schedulers/cron jobs, outbox. Note if there is none.
- **Tests**: where they live, unit vs. integration, how state is set up (fixtures, builders, factories, test containers, in-memory DB, mocks), how assertions are written.

Do not read the whole codebase. Search (`grep`/glob) for a concept, then follow references.

## Step 3 — Decide the Event Modeling mapping

Decide how each board element is built **in this codebase**, based on what you found — not on Event Modeling theory:

- **Is it event-based?** Only if the code already persists or publishes events (event store, domain events, outbox, audit log of facts). Otherwise it is state-based (typically CRUD) and board EVENTs become the state transitions a command persists, not new event classes.
- **COMMAND** → which entry point + DTO + service method shape, and where business-rule violations go (exception type, result type, validation error).
- **EVENT** → the persisted change (tables/columns written), or the existing event mechanism if there is one.
- **READMODEL** → query + response DTO; when a new table/view/materialized projection is justified versus querying existing tables.
- **AUTOMATION / processor** → the existing reactive mechanism (or, if none exists, the least invasive option consistent with the codebase — usually a direct call or a scheduled job; note that choice explicitly).
- **Specification (given/when/then)** → how `given` events become pre-existing state in a test, and what `then` asserts on.

## Step 4 — Write `.build-kit/ARCHITECTURE.md`

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
- Write: `path/to/Controller` → `path/to/Service` → `path/to/Repository` (+ migration)
- Read: ...
- Background: ... (or "none")
- Tests: `path/to/ReferenceTest` — how state is set up and asserted

## Event Modeling mapping
| Board element | Built as |
|---|---|
| COMMAND | ... |
| EVENT | ... |
| READMODEL | ... |
| AUTOMATION | ... |
| Specification | ... |

## Rules
- Conventions a new slice must follow (transactions, validation, error mapping, auth, migrations append-only, ...)
- Files a slice must not touch (app bootstrap, global config, lockfiles, ...)
```

## Step 5 — Verify the commands

Run the build command and the single-test command against one existing test. If either fails for reasons unrelated to the code (missing service, missing env var), record the prerequisite under **Commands**. Do not "fix" the project to make it pass.

Commit `ARCHITECTURE.md` on its own: `chore: document architecture for build kit`.
