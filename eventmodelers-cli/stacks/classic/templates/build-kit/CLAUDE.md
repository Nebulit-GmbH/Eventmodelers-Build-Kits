# Project Configuration

This build kit was installed into an **existing codebase** — it ships no scaffold, no framework and no fixed file layout. Slices are implemented the way this codebase already builds features.

The codebase is typically a classic application (layered, CRUD, a relational database behind services/repositories) — but not necessarily: it may already use domain events, messaging, or event sourcing. Never assume; look.

## Architecture First

`.build-kit/ARCHITECTURE.md` describes how this codebase works: language, layers, where a feature's files go, persistence and migrations, how state changes are exposed (REST, RPC, UI actions), how reads are served, how background/reactive work is wired, the test style, and the exact build/test commands.

- If `.build-kit/ARCHITECTURE.md` does not exist, run `/learn-architecture` before building anything.
- Treat it as the authority for *how* to build. Treat `slice.json` as the authority for *what* to build.
- If the code contradicts `ARCHITECTURE.md` (a moved folder, a renamed base class, a wrong command), fix `ARCHITECTURE.md` in the same iteration rather than working around it.

## Code Standards

- **Match the codebase**: language, module system, naming, layering, error handling, validation, DI, logging and test style all come from the existing code — copy the closest existing feature, not a textbook pattern.
- **No new architecture**: never introduce a new framework, library, persistence technology or architectural style (event store, CQRS bus, mediator, ...) to build a slice. If the codebase is CRUD, the slice is CRUD.
- **No dependency changes**: do not add or upgrade dependencies unless slice.json or a slice prompt explicitly asks for it.
- **Minimal footprint**: touch only the files the slice needs. Do not refactor, reformat or "clean up" unrelated code.

Ignore case for files and slices in prompts. "CartItems" slice is the same as "cartitems".

Do not change existing tests unless explicitly instructed, or the change brings the test in line with slice.json (e.g. step 4's field/spec diff).

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project learnings.

When starting to work on a slice, invoke the `update-slice-status` skill with `InProgress` status before doing anything else.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do NOT invent, assume, or guess any field or logic not present in the slice definition.**

**Default: make a reasonable assumption and build the slice.** If a detail is unclear or missing (an example value, a field type, a status mapping, a referenced event that isn't modeled yet, where a file should live, ...), pick the most sensible interpretation from `slice.json`, its specifications, the surrounding model and the existing code, build it, and record each assumption in one line in `progress.txt` and as a code comment. Ambiguity alone is never a reason to stop. **Only if the slice literally cannot be built** — nothing runnable can be produced even with sensible assumptions — invoke `/request-feedback` with the specific question; it posts the question as a comment on the slice and marks it `Blocked`. That must be the absolute exception; a `Blocked` slice should mean "impossible without a human", never "the agent preferred to ask".

When asked to build a slice, always follow this flow:

1. Read the slice definition from `.build-kit/.slices/<context>/<slicename>/slice.json`.
2. Make sure `.build-kit/ARCHITECTURE.md` exists — run `/learn-architecture` if it does not.
3. Determine the slice type:
   - **Translation** — `sliceType === "TRANSLATION"` → read `description` and `notes` from slice.json for hints; default to `/build-automation` if nothing else is specified
   - **Automation** — `processors` array is non-empty → invoke `/build-automation`
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`
4. Invoke the matching skill and follow its instructions completely. Do not deviate.
5. **Verify against slice.json**: After the skill completes, check that every command field, event field, read model field and specification in slice.json has its counterpart in the implementation. No invented fields — if it is not in slice.json, it must not be in the code. This applies even when the slice was previously `Done` and reappears as `Planned` — never dismiss a mismatch as "already implemented" or harmless drift; diff slice.json against the code field by field and update the code to match every change.
6. Run the quality checks from `.build-kit/ARCHITECTURE.md` (build/compile, then only the tests this slice touched).
7. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done`.

After you are done, automatically run the tests for the slice that was edited.

## How Event Modeling maps onto this codebase

The board speaks Event Modeling; the codebase may not. `/learn-architecture` records the concrete mapping in `ARCHITECTURE.md` — the default for a CRUD codebase is:

| Board element | Typical CRUD counterpart |
|---|---|
| COMMAND | An input DTO/request + the service/use-case method that validates and applies it, exposed the way the codebase exposes writes (endpoint, RPC, form action, ...) |
| EVENT | The state transition the command persists — the rows/columns written. A real domain/integration event only if the codebase already publishes them |
| READMODEL | A query + response DTO (and endpoint) answering from the tables those events were persisted to; a dedicated table/view only if the read can't be served from existing data |
| AUTOMATION / processor | Whatever already reacts to state changes here: an in-process event listener, after-commit hook, message consumer or scheduled job |
| Specification (given/when/then) | A test in the codebase's own style: `given` events → pre-existing data (fixtures, repositories, or earlier commands), `when` → the command/query, `then` → resulting state, returned data or the expected error |
