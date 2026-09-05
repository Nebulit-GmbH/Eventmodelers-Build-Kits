# Project Configuration

Read events in `src/main/java/<basePackage>/slices/{context}/events/` to understand the global
structure - one sealed event interface plus an `EventTags` class per context.

`<basePackage>` in this project's Java code (`src/main/java/<basePackage>/slices/...`) is this
project's own Java package prefix, not a fixed value - resolve it, in order: (1) the package of the
project's `@SpringBootApplication` class, (2) the package of any existing slice already under
`.../slices/{context}/{slicename}/`, (3) only if no code exists yet, Maven's `<groupId>` in
`pom.xml`. Never hardcode `io.umadb.quickstart` (the shipped quickstart scaffold's package) or any
other specific package.

## File Structure Constraints

- **Strict Path Limitation**: if not instructed otherwise, only check
  `src/main/java/<basePackage>/slices/{context}/{slicename}/*.java` and its test counterpart under
  `src/test/java/...`
- **Slice Organization**: each feature/domain is a separate slice, flat under its context - no
  `write`/`read`/`automation` folder layer in between (only the shared `slices/{context}/events/`
  folder sits alongside slice folders, and automations live under `slices/{context}/automation/{slicename}/`)

## Code Standards

- **Language**: Java 21
- **Module System**: standard Maven `src/main/java` / `src/test/java` layout
- **Framework**: Spring Boot (plain MVC, not WebFlux - UmaDB's client API is blocking)
- **Type Safety**: commands, events, and query/result types are records; decision models and
  projectors are plain classes

## Development Guidelines

1. Each slice should be self-contained and focused on a specific domain
2. Maintain clear separation of concerns within each slice
3. Reuse the shared `eventstore` package's infrastructure (`DecisionModelLoader`, `EventCodec`,
   `SliceEventListener`, `EventDispatcher`) rather than re-implementing the read/append or
   subscribe/dispatch loop per slice - see each build skill's own reference to that infrastructure

Ignore case for files and slices in prompts. "CartItems" slice is the same as "cartitems".

Do not change test files unless explicitly instructed.

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project learnings.

When starting to work on a slice, invoke the `update-slice-status` skill with `InProgress` status before doing anything else.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do NOT invent, assume, or guess any field or logic not present in the slice definition.**

**If, at any point below, the slice's requirements are genuinely ambiguous, contradictory, or missing
a decision you need in order to proceed — do not guess, and do not build anyway.** Invoke the
`request-feedback` skill with the specific question; it posts the question as a comment on the slice
and marks it `Blocked`, and you then stop work on this slice for this run. This is an escalation path,
not a routine step — read `slice.json` and the matching build skill's own instructions fully first;
most slices are fully specified and need none of this.

When asked to build a slice, always follow this flow:

1. Read the slice definition from `.build-kit/.slices/<context>/<slicename>/slice.json`.
2. Determine the slice type:
   - **Translation** — `sliceType === "TRANSLATION"` → read `description` and `notes` from slice.json for hints; default to `/build-automation` if nothing else is specified
   - **Automation** — `processors` array is non-empty → invoke `/build-automation`
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`
3. Invoke the matching skill and follow its instructions completely. Do not deviate.
4. **Verify against slice.json**: After the skill completes, check that every command field, event field, and specification in slice.json appears in the implementation. No invented fields — if it is not in slice.json, it must not be in the code.
5. Run quality checks (`./mvnw compile -q`, then the slice tests only).
6. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done`.

After you are done, automatically run the tests for the slice that was edited.

## Example Slice Structure

```
src/main/java/<basePackage>/slices/
├── {context}/
│   ├── events/
│   │   ├── {Context}Event.java          ← sealed interface every event in this context implements
│   │   └── EventTags.java               ← "key:value" tag-string constants for this context
│   ├── {slicename}/                     ← write slice (build-state-change)
│   │   ├── {SliceName}Command.java
│   │   ├── {SliceName}Decision.java     ← package-private, mutable
│   │   ├── {SliceName}CommandHandler.java
│   │   └── {SliceName}RestController.java   (only if a SCREEN depends on the command)
│   ├── {slicename}/                     ← read slice (build-state-view)
│   │   ├── Get{SliceName}.java          ← query record + nested Result
│   │   ├── {SliceName}Summary.java      ← read model shape
│   │   ├── {SliceName}Entity.java + {SliceName}Repository.java   ← JPA
│   │   ├── {SliceName}Projector.java    ← implements SliceEventListener
│   │   └── {SliceName}RestApi.java
│   └── automation/{slicename}/          ← automation slice (build-automation)
│       └── {AutomationName}Processor.java   ← implements SliceEventListener
```
