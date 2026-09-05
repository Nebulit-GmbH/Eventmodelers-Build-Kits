---
name: build-state-view
authors:
  - Martin Dilger
description: >
  Implement read slices (JPA-backed projections + REST query endpoint + tests) using OpenCQRS 2.0.0
  (Spring Boot, EventSourcingDB) in this project's one established pattern: Event(s) → @EventHandling
  projector method(s) updating a private JPA entity → a separate REST controller querying the
  repository directly. Use when implementing a new read slice / projection in this project. Plain Java
  only. There is exactly one supported style — do not offer alternatives.
---

# OpenCQRS — Read Slice (Java)

## Step 0: Discover target project conventions

> **Comments & description**: Each element in the slice carries a `comments: string[]` array and a
> `description` field. Use these as implementation hints. When done, resolve each used comment:
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get
> IDs first via GET on same path).

Before writing any code, read the target project's `.build-kit/CLAUDE.md`.

**Determine `{basePackage}`** — every code example below is rooted at
`{basePackage}.slices.{context}.{slicename}`. Resolve `{basePackage}` as documented in
`.build-kit/CLAUDE.md`'s Structure section.

## Step 1: Ensure events exist

Before implementing the read slice, verify that all events the projector handles exist in
`src/main/java/.../{context}/api/`. If they don't, create them **first** (plain records — see
`build-state-change` Step 2), and register each new one's type string in `CqrsConfiguration`'s
`eventTypeResolver()` bean. Do not skip this even for a pure read slice — an unregistered event type
fails at runtime the first time it's read back.

## Step 2: Implement the read slice

If the slice details include `## Scenarios (GWTs)`, use them to derive test cases (Step 5). GWT format
for read slices: `Given (events) → Then (information)` — no When. Events in Given tell you which events
the projector handles. The information element in Then describes the expected query result.

If the slice description or comments contain `## Implementation Guidelines`, **follow them**.

### Slice package structure

```
.../slices/{context}/{slicename}/     (i.e. {basePackage}.slices.{context}.{slicename} — see Step 0)
├── {SliceName}Entity.java       ← @Entity, private to this slice
├── {SliceName}Repository.java  ← Spring Data repository, private to this slice
├── {SliceName}Summary.java     ← read model (query result shape)
├── {SliceName}Projector.java   ← @Service with @EventHandling method(s)
└── {SliceName}RestApi.java     ← @RestController (if REST chosen)
```

A read slice lives in a single package. **Do NOT add Domain/Application/Presentation section
comments** — those are only for write slices. **Never reuse another slice's entity/repository** — a
read model is private to the slice that owns it, even if another slice's projector happens to need
similar-looking data.

### Entity + repository

```java
package {basePackage}.slices.{context}.{slicename};

import jakarta.persistence.*;

@Entity
@Table(name = "{context}_{slicename}", indexes = {
    @Index(name = "idx_{context}_{slicename}_{col}", columnList = "{filterField}")
})
class {SliceName}Entity {

    @Id
    private String id;
    private String {filterField};
    // ... other fields

    protected {SliceName}Entity() {}

    {SliceName}Entity(String id, String {filterField}) {
        this.id = id;
        this.{filterField} = {filterField};
    }

    {SliceName}Summary toSummary() {
        return new {SliceName}Summary(id, {filterField});
    }
}
```

```java
package {basePackage}.slices.{context}.{slicename};

import org.springframework.data.repository.CrudRepository;
import java.util.List;

interface {SliceName}Repository extends CrudRepository<{SliceName}Entity, String> {
    List<{SliceName}Entity> findAllBy{FilterField}(String {filterField});
}
```

Add a derived-query method (`findAllBy{FilterField}`) for filtered queries instead of `findAll()` +
client-side filtering — DB-level filtering, not in-memory.

### Result DTO rules

- If the read model matches the entity **1:1**, expose the summary record directly (`toSummary()`
  above).
- If the read model contains fields the caller already knows from the query (e.g. the filter field
  itself), omit those from `{SliceName}Summary` and map only what's new.

### Projector

`@EventHandling`-annotated methods receive their collaborators as **method parameters** annotated
`@Autowired` (resolved from the `ApplicationContext` at dispatch time) — not via the class's
constructor. This is the framework's actual injection mechanism for these methods; a constructor field
would be wrong here.

**Processing-group name**: pick one stable name per read model (e.g. `"{context}-{slicename}"`) and
never rename it once deployed — it's the literal key `JdbcProgressTracker` persists this projection's
checkpoint under (`EVENTHANDLER_PROGRESS.GROUP_KEY`). Renaming it doesn't fail loudly; it just orphans
the old checkpoint and makes this projection silently replay from the beginning on next start. If the
slice has two or more `@EventHandling` methods, define a small private meta-annotation instead of
repeating the group-name string on every method:

```java
package {basePackage}.slices.{context}.{slicename};

import com.opencqrs.framework.eventhandler.EventHandling;
import java.lang.annotation.*;

@Target({ElementType.METHOD, ElementType.ANNOTATION_TYPE})
@Retention(RetentionPolicy.RUNTIME)
@EventHandling("{context}-{slicename}")
@interface {SliceName}Handling {}
```

(If the slice has exactly one handler method, use `@EventHandling("{context}-{slicename}")` directly
instead — no meta-annotation needed.)

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class {SliceName}Projector {

    @{SliceName}Handling
    public void on({EventName} event, @Autowired {SliceName}Repository repository) {
        repository.save(new {SliceName}Entity(event.idField(), event.{filterField}()));
    }
}
```

`@Transactional` on the class (or per-method) wraps each single event-handling call in its own
transaction — this is a Spring convention layered on top, not something `@EventHandling` provides for
free. Omitting it does **not** mean no transaction runs at all: since this project's
`JdbcProgressTracker` has `setProceedTransactionally(true)` (see `CqrsConfiguration`), the handler
already participates in the same transaction as the checkpoint update, making the projection write and
the checkpoint advance atomic together — but only add an explicit `@Transactional` if this projector's
own logic needs a transaction boundary beyond that (e.g. multiple repository calls that must commit
together).

### REST query endpoint

Separate class — this is plain Spring wiring (constructor-injected field), not an `@EventHandling`
method, so no per-method `@Autowired` is needed here:

```java
package {basePackage}.slices.{context}.{slicename};

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
public class {SliceName}RestApi {

    private final {SliceName}Repository repository;

    public {SliceName}RestApi({SliceName}Repository repository) {
        this.repository = repository;
    }

    @GetMapping("/api/{context}/{filterField}")
    public List<{SliceName}Summary> query(@PathVariable String {filterField}) {
        return repository.findAllBy{FilterField}({filterField}).stream()
                .map({SliceName}Entity::toSummary)
                .toList();
    }
}
```

This project uses plain Spring **WebMVC** — a blocking return value, not `Mono<...>`.

## Step 3: Design test cases

Implement the test cases provided in the slice definition. Do not design your own test cases unless
specifically instructed to do so.

### Mapping GWT scenarios to tests

| GWT Element | Test code |
|---|---|
| `NOTHING` in Given | call the repository query directly with no prior `.save(...)` |
| Event in Given | call `projector.on(event, repository)` directly |
| Information in Then | assert the repository query result / mapped summaries |

## Step 4: Implement the test — `@DataJpaTest` + `@Import`

There is no built-in test fixture for `@EventHandling` methods (unlike `build-state-change`'s
`CommandHandlingTestFixture`) — write a plain JPA test slice instead. `@DataJpaTest` boots only JPA
infrastructure (no EventSourcingDB, no HTTP, no full application context); `@Import` pulls the plain
`@Service` projector class into that same narrow context so its `@Autowired` repository parameter
resolves correctly when you call it directly.

**This project is on Spring Boot 4** — `@DataJpaTest` moved to the `spring-boot-data-jpa-test` artifact
under package `org.springframework.boot.data.jpa.test.autoconfigure` (not the Boot 3
`org.springframework.boot.test.autoconfigure.orm.jpa` package). Verified by compiling and running
against the real dependency — don't "correct" this import back to the Boot 3 package.

**This project's read models target PostgreSQL, not H2** — `@DataJpaTest`'s default behavior tries to
replace the datasource with an embedded database, which fails outright with no H2/Derby/HSQL on the
classpath (`Failed to replace DataSource with an embedded database for tests`, verified). Use
Testcontainers' real Postgres instead, exactly like the project's other Postgres-backed tests
(`spring-boot-testcontainers` + `testcontainers-postgresql` are already on the test classpath):

```java
package {basePackage}.slices.{context}.{slicename};

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@Testcontainers
@Import({SliceName}Projector.class)
class {SliceName}ProjectorTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    @Autowired
    private {SliceName}Projector projector;

    @Autowired
    private {SliceName}Repository repository;

    @Test
    void givenNoEvents_thenEmptyResult() {
        assertThat(repository.findAllBy{FilterField}("filter-value")).isEmpty();
    }

    @Test
    void givenCreationEvent_thenItemAppears() {
        projector.on(new {CreationEvent}("id-1", "filter-value" /*, other fields */), repository);

        var result = repository.findAllBy{FilterField}("filter-value").stream()
                .map({SliceName}Entity::toSummary)
                .toList();

        assertThat(result).containsExactly(new {SliceName}Summary("id-1", "filter-value"));
    }

    @Test
    void itemsAreIsolatedByFilterField() {
        projector.on(new {CreationEvent}("id-1", "group-A"), repository);
        projector.on(new {CreationEvent}("id-2", "group-B"), repository);

        assertThat(repository.findAllBy{FilterField}("group-A")).hasSize(1);
        assertThat(repository.findAllBy{FilterField}("group-B")).hasSize(1);
    }
}
```

### Key rules

- Call the `@EventHandling` method directly (`projector.on(event, repository)`) — you're calling a
  plain public Java method, not going through the framework's dispatch machinery. The same method also
  works standalone in production; `@DataJpaTest` just gives you a real repository to pass it.
- **Assert with full objects**: `containsExactly(new Summary(...))` rather than field-by-field
  assertions — catches mapping mistakes a partial assertion would miss.
- If the projector method also declares a `Map<String, ?> metadata` parameter, pass `Map.of()` (or the
  relevant test values) directly — no need to route it through any dispatch machinery.
- **Requires Docker running locally/in CI** — the `PostgreSQLContainer` starts a real container per test
  class. This is slower than a mocked unit test, but exercises the exact same schema/dialect production
  uses; there is no embedded-database fallback in this project (see above).

## Step 4b: Storyline-Derived Tests (Optional)

`slice.json` may also carry a `storylines[]` array — narrated walkthroughs where the *same* read
model appears as multiple ordered "beats" across one flow (see `elements[]` on each storyline).
This is a secondary, supplementary source: `specifications[]` (Step 3) remains the primary and
default source of test cases. Most slices have no `storylines[]` — skip this step silently when
there's nothing relevant.

A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need
to match beats against `readmodels[]` by id/title. For each storyline, find beats whose `type` is
`READMODEL`. Two such beats **adjacent with only `EVENT` beat(s) between them** describe one clean,
isolable projection test:

- events = the cumulative ordered `EVENT` beats from the start of the storyline through the
  intervening event(s)
- expected result = the later `READMODEL` beat's `fields`/`examples`/`expectEmptyList`

Write these as ordinary `@Test` methods (the same `projector.on(event, repository)` pattern applies
unchanged), but keep them in a clearly separate `@Nested` class named after the storyline's title, so
they never get confused with the exhaustive `specifications[]` suite:

```java
@Nested
class StorylineTests {
    @Test
    void afterEvent_readModelShowsExpectedState() {
        projector.on(new {EventName}(/* fields from the intervening beat(s) */), repository);

        var result = repository.findAllBy{FilterField}("filter-value").stream()
                .map({SliceName}Entity::toSummary)
                .toList();

        assertThat(result).containsExactly(/* expected shape from the later beat */);
    }
}
```

If a beat between two read-model states is a `COMMAND` rather than an `EVENT`, that half belongs
to `build-state-change` (its own command-handler test), not here — only project the `EVENT`→
`READMODEL` half. If a storyline segment involves a `SCREEN`/other untraceable beat, don't force a
test — leave it undocumented in code rather than fabricating an assertion.

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] Every field in the read model / query result definition in slice.json has a field in `{SliceName}Summary` — no invented fields
- [ ] Every event type in `events[]` has an `@EventHandling` method in the projector — no events missed or assumed
- [ ] Every new event's type string is registered in `CqrsConfiguration`'s `eventTypeResolver()`
- [ ] The projector's processing-group name is stable and won't collide with another slice's
- [ ] Every GWT scenario in `specifications[]` maps to a test case in `{SliceName}ProjectorTest`
- [ ] If `storylines[]` is present: every adjacent READMODEL↔READMODEL beat pair for this slice's read model (with only EVENT beats between) has a `@Nested` storyline test — or was deliberately skipped as untraceable
- [ ] No extra query parameters or filter logic were added beyond what slice.json defines
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
