# Project Configuration

This project is built with plain Java, Spring Boot, and Maven, backed directly by
[KurrentDB](https://docs.kurrent.io) (formerly EventStoreDB) as the event store. **There is no CQRS
framework layer** — unlike this CLI's OpenCQRS or Axon kits, KurrentDB's Java client
(`kurrentdb-client`) is a plain SDK with no annotations, no command router, no auto-configuration of
its own. This project's own conventions (documented below, and in each `build-*` skill) are the entire
"framework". Plain Java — no Kotlin.

`{basePackage}` in this project's Java code (`src/main/java/<basePackage>/slices/...`) is this
project's own Java package prefix, not a fixed value — resolve it, in order: (1) the package of the
project's `@SpringBootApplication` class, (2) the package of any existing slice already under
`.../slices/{context}/{slicename}/`, (3) only if no code exists yet, Maven's `<groupId>` in `pom.xml`.
Never hardcode `com.example.quickstart` (the shipped quickstart scaffold's package) or any other
specific package.

## Structure

- Slices live under `src/main/java/{basePackage}/slices/{context}/{slicename}/` — flat, no
  `write`/`read`/`automation` folder layer in between, except the shared `slices/{context}/api/` folder
  (events + the context's sealed event-union interface, shared by every slice in that context) sitting
  alongside slice folders. Automations live under `slices/{context}/automation/{slicename}/`.
- **Streams**: one KurrentDB stream per aggregate instance, named `{context-lower}-{id}` (e.g.
  `library-4711`). A parent/child relationship between two slices is its own separate stream with its
  own name — there is no built-in hierarchical-subject mechanism like OpenCQRS's (KurrentDB stream
  names are just opaque strings); if a decision genuinely needs data from another stream, read it
  explicitly via `EventStore`/`KurrentDBClient`, don't try to encode a parent/child path convention.
- **Events**: plain Java records, implementing that context's sealed marker interface (e.g.
  `LibraryEvent`), living in `slices/{context}/api/`. Every event type has a short, stable string name
  (e.g. `"BookPurchased"`) — **never** the Java classname — registered in that context's
  `{Context}EventTypes` class (serialize/deserialize + the type-name mapping). This is the one registry
  new events must be added to; forgetting to costs nothing at compile time but means the event is
  silently invisible to every reader (`evolve`, a projection, an automation) that scans a stream — see
  `build-state-change` Step 2.
- **`EventStore`** (`{basePackage}.common.EventStore`) is the one shared low-level helper every write
  slice uses to read/append streams — see its Javadoc. It is intentionally thin; it does not know about
  `decide`/`evolve` or any slice's domain types.
- **decide/evolve**: every write slice defines its own `evolve(state, event) -> state` (pure, no I/O)
  and `decide(command, state) -> List<Event>` (pure, no I/O, throws on a business-rule violation) as
  static methods — see `build-state-change`. These are genuinely pure Java functions; their tests never
  touch KurrentDB, Spring, or a container.
- **Read models / automations**: use a [KurrentDB persistent subscription](https://docs.kurrent.io/clients/java/persistent-subscriptions.html)
  (its own named subscription group) — see `build-state-view`/`build-automation`. KurrentDB tracks each
  group's checkpoint durably server-side; there is no local progress-tracking table to maintain (unlike
  the OpenCQRS/Axon kits).

## Code Standards

- **Language**: plain Java only — no Kotlin, no Lombok.
- **Records** for commands, events, and immutable write-model state.
- Ensure all code is properly typed; avoid raw types.
- Serialize event payloads with `com.fasterxml.jackson.core:jackson-databind`'s `ObjectMapper` — this is
  declared explicitly in `pom.xml` (Spring Boot 4's own internal JSON handling moved to Jackson 3
  `tools.jackson.core`, which is not what `kurrentdb-client`'s own examples/API use).

## Development Guidelines

1. Each slice should be self-contained and focused on a specific domain.
2. Maintain clear separation of concerns within each slice.
3. Only check `src/main/java/{basePackage}/slices/{slicename}/*.java`, do not check subfolders unless
   explicitly tasked to.

Ignore case for files and slices in prompts. "CartItems" slice is the same as "cartitems".

Do not change test files unless explicitly instructed: `src/test/java/**/*Test.java`.

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project
learnings.

When starting to work on a slice, invoke the `update-slice-status` skill with `InProgress` status before
doing anything else.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do NOT
invent, assume, or guess any field or logic not present in the slice definition.**

**If, at any point below, the slice's requirements are genuinely ambiguous, contradictory, or missing a
decision you need in order to proceed — do not guess, and do not build anyway.** Invoke the
`request-feedback` skill with the specific question; it posts the question as a comment on the slice and
marks it `Blocked`, and you then stop work on this slice for this run. This is an escalation path, not a
routine step — read `slice.json` and the matching build skill's own instructions fully first; most slices
are fully specified and need none of this.

When asked to build a slice, always follow this flow:

1. Read the slice definition from `.build-kit/.slices/<context>/<slicename>/slice.json`.
2. Determine the slice type:
   - **Translation** — `sliceType === "TRANSLATION"` → read `description` and `notes` from slice.json for
     hints; default to `/build-automation` if nothing else is specified
   - **Automation** — `processors` array is non-empty → invoke `/build-automation`
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`
3. Invoke the matching skill and follow its instructions completely. Do not deviate.
4. **Verify against slice.json**: After the skill completes, check that every command field, event field,
   and specification in slice.json appears in the implementation. No invented fields — if it is not in
   slice.json, it must not be in the code.
5. Run quality checks (`./mvnw compile -q`, then the slice tests only).
6. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done`.

After you are done, automatically run the tests for the slice that was edited.

## Example Slice Structure

```
src/main/java/{basePackage}/slices/
├── {context}/
│   ├── api/                          ← {Context}Event sealed interface + records + {Context}EventTypes
│   ├── {slicename}/                  ← state-change slice
│   │   ├── {SliceName}.java          ← write-model record
│   │   ├── {SliceName}Command.java
│   │   └── {SliceName}Handling.java  ← evolve/decide/handle + Spring wiring
│   ├── {slicename}/                  ← state-view slice
│   │   ├── {SliceName}Entity.java
│   │   ├── {SliceName}Repository.java
│   │   ├── {SliceName}Summary.java
│   │   ├── {SliceName}Projector.java
│   │   └── {SliceName}RestApi.java
│   └── automation/{slicename}/       ← automation slice
│       └── {AutomationName}Handling.java
```
