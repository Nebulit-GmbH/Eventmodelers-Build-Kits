# Project Configuration

This project is built with [OpenCQRS](https://docs.opencqrs.com), Spring Boot, and Maven, backed by
[EventSourcingDB](https://www.eventsourcingdb.io) for events. **Plain Java — no Kotlin.**

`{basePackage}` in this project's Java code (`src/main/java/<basePackage>/slices/...`) is this project's
own Java package prefix, not a fixed value — resolve it, in order: (1) the package of the project's
`@SpringBootApplication` class, (2) the package of any existing slice already under
`.../slices/{context}/{slicename}/`, (3) only if no code exists yet, Maven's `<groupId>` in `pom.xml`.
Never hardcode `com.example.quickstart` (the shipped quickstart scaffold's package) or any other specific
package.

## Structure

- Slices live under `src/main/java/{basePackage}/slices/{context}/{slicename}/` — flat, no
  `write`/`read`/`automation` folder layer in between, except the shared `slices/{context}/api/` folder
  (commands + events for that context) sitting alongside slice folders.
- Every event type used anywhere in the project must be registered in
  `src/main/java/{basePackage}/config/CqrsConfiguration.java`'s `eventTypeResolver()` bean — this is a
  single project-wide map, not per-slice. Forgetting to add a new event here doesn't fail at compile time;
  it fails at runtime the first time that event is read back (`EventTypeResolutionException`, or silently
  falls back to a classname-based type that breaks across renames). Whenever `build-state-change` or
  `build-automation` introduces a new event, add its line to this map as part of that slice — never skip
  it.
- Subjects are hierarchical, path-like strings (`Command.getSubject()`), e.g. `/book/{isbn}`,
  `/book/{isbn}/page/{page}`. A child slice's subject nested under a parent's is how OpenCQRS models
  parent/child aggregate relationships — see `build-state-change`'s Step 1 for how this replaces
  compound-identifier/tagging schemes other frameworks need.

## Code Standards

- **Language**: plain Java only — no Kotlin, no Lombok.
- **Records** for commands, events, and immutable write-model state.
- Ensure all code is properly typed; avoid raw types.

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
│   ├── api/                      ← shared Command/Event records for this context
│   ├── {slicename}/              ← state-change slice
│   │   ├── {SliceName}Command.java
│   │   ├── {SliceName}.java      ← write-model record
│   │   └── {SliceName}Handling.java
│   └── automation/{slicename}/   ← automation slice
```
