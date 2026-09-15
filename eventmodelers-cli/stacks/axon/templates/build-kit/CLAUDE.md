# Axon Framework 5 application — agent conventions

This is a **Java** application built on **Axon Framework 5 / Axoniq** (event sourcing via Axon Server)
with **Spring Boot WebFlux** on top, using **Vertical Slice Architecture**: one package per slice, no
shared `service`/`repository`/`controller` layers cutting across slices.

Build slices exclusively with the kit's skills — `/build-state-change`, `/build-state-view`,
`/build-automation`, `/build-automation-workflow` — each documents **one** supported implementation
style per slice type. Do not offer or invent alternative styles.

The build tool is either **Maven** or **Gradle** — detect which by checking for `pom.xml` (Maven) vs
`build.gradle`/`build.gradle.kts` (Gradle) at the project root before running any build/test command.
Always support both; never assume Maven just because it happens to be more common in examples.

## Structure

```
src/main/java/<basePackage>/slices/
├── {context}/
│   ├── events/                    ← shared per-context: sealed/marker event interface + EventTags
│   ├── {slicename}/                ← one slice = one behavior, flat — no write/read/automation folder layer
│   │   ├── {SliceName}Command.java        (write slices)
│   │   ├── {SliceName}DecisionModel.java  (write slices — @EventSourced entity)
│   │   ├── {SliceName}CommandHandler.java (write slices)
│   │   ├── Get{SliceName}.java            (read slices — @Query record)
│   │   ├── {SliceName}Projector.java      (read slices — @EventHandler + @QueryHandler)
│   │   ├── {AutomationName}Processor.java (automation slices — @EventHandler dispatching commands)
│   │   └── {SliceName}RestApi.java        (optional — only if slice.json shows an inbound SCREEN)
```

- Slice folders sit **directly under their context** — `slices/{context}/{slicename}/` — there is no
  intermediate `write`/`read`/`automation` layer.
- Events for a context are shared and live once in `slices/{context}/events/`; check that folder before
  adding a new event record so slices never duplicate one.
- Once the first slice in a context exists, treat it as the concrete pattern to copy for the next one in
  the same context — matching structure matters more than matching this file's prose exactly.
- `<basePackage>` above is this project's own Java package prefix, not a fixed value — resolve it, in
  order: (1) the package of the project's `@SpringBootApplication` class, (2) the package of any existing
  slice already under `.../slices/{context}/{slicename}/`, (3) only if no code exists yet, Maven's
  `<groupId>` in `pom.xml` or Gradle's `group` property in `build.gradle`/`build.gradle.kts`. Never
  hardcode `io.axoniq.quickstart` (the shipped quickstart scaffold's package) or any other specific
  package.

## Non-negotiables (full detail lives in each skill)

- **Write slices**: Command record (`@TargetEntityId` on the one `idAttribute: true` field, or a
  compound id record if there are several) → mutable, package-private decision-model entity
  (`@EventSourced` + an explicit `@EventCriteriaBuilder` — never bare `@EventSourced(tagKey = "...")`,
  it fails silently) → `@Component` `CommandHandler` that checks entity state inline and appends via
  `EventAppender`. See `/build-state-change`.
- **Read slices**: events projected via `@EventHandler` into a JPA-backed entity, queried via
  `@QueryHandler` + `QueryGateway`. This is the only supported read-model persistence style. See
  `/build-state-view`.
- **Automation slices**: `@EventHandler` reacting to an event by dispatching a command via
  `CommandDispatcher` — injected as a **method parameter**, never constructor-injected (that's
  `CommandGateway`, reserved for external callers like REST controllers). See `/build-automation`.
- **Workflow slices**: multi-step, waits-for-approval, compensating, or timer-driven automations use the
  AF5 Workflow engine instead of a plain `@EventHandler` — decide via `/build-automation-workflow`'s
  decision table before defaulting to a plain automation. Preview API — flag this to the user if reached
  for.
- Every slice component (handler, controller, processor) is gated by
  `@ConditionalOnProperty(prefix = "slices.{context}.<write|read|automation>", name =
  "{slicename}.enabled")`, wired into `application.properties` (main: `true`, test: `false`) and
  `META-INF/additional-spring-configuration-metadata.json`.
- REST endpoints use WebFlux (`Mono<ResponseEntity<...>>`), matching `spring-boot-starter-webflux` — not
  plain blocking `ResponseEntity`.
- Tests use `AxonTestFixture` with zero Spring context (`EventSourcedEntityModule.autodetected(...)` /
  `autodetectedCommandHandlingComponent(...)` work directly off the annotated classes via reflection) —
  do not reach for `@SpringBootTest` unless a skill's reference doc explicitly calls for it (e.g. an
  integration test for a Workflow).

## Build, run, test

Detect the build tool first (`pom.xml` → Maven, `build.gradle`/`build.gradle.kts` → Gradle):

```bash
docker-compose up -d                                    # Axon Server

./mvnw compile -q                                        # Maven — compile
./gradlew compileJava -q                                 # Gradle — compile

./mvnw test -Dtest="<SliceName>*" -q                      # Maven — slice tests only
./gradlew test --tests "*<SliceName>*" -q                 # Gradle — slice tests only

./mvnw spring-boot:run                                    # Maven — run
./gradlew bootRun                                          # Gradle — run
```

Only run the full test suite (`./mvnw test -q` / `./gradlew test -q`) if the slice's tests aren't yet
named predictably enough to filter.

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project
learnings.

When starting to work on a slice, invoke the `update-slice-status` skill with `InProgress` status before
doing anything else.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do
NOT invent, assume, or guess any field or logic not present in the slice definition.**

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
   - **Automation** — `processors` array is non-empty → apply `/build-automation-workflow`'s decision table first to check whether it needs a Workflow instead of a plain automation, then invoke `/build-automation-workflow` or `/build-automation` accordingly
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`
3. Invoke the matching skill and follow its instructions completely. Do not deviate.
4. **Verify against slice.json**: After the skill completes, check that every command field, event field, and specification in slice.json appears in the implementation. No invented fields — if it is not in slice.json, it must not be in the code. This applies even when the slice was previously `Done` and reappears as `Planned` — never dismiss a mismatch as "already implemented" or harmless drift; diff slice.json against the code field by field and update the code to match every change.
5. Run quality checks — compile (`./mvnw compile -q` or `./gradlew compileJava -q`), then the slice tests only.
6. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done`.

After you are done, automatically run the tests for the slice that was edited.

## File Structure Constraints

- **Strict Path Limitation**: if not instructed otherwise, only check `src/main/java/**/slices/{context}/{slicename}/*.java` and its matching `src/test/java/**/slices/{context}/{slicename}/*.java`
- Ignore case for files and slices in prompts — "CartItems" slice is the same as "cartitems"
- Do not change test files unless explicitly instructed to
