---
name: build-state-view
authors:
  - Martin Dilger
description: >
  Implement read slices (JPA-backed projections + query method + REST API + tests) that react to
  events off the shared EventDispatcher subscription, in this project's one established pattern:
  Query record → JPA entity/repository → @Component Projector implementing SliceEventListener →
  plain on(event)/handle(query) unit test (no client, no Spring context). Use when implementing a
  new read slice / projection from a slice.json event model in this project. There is exactly one
  supported style — do not offer alternatives.
---

# UmaDB — Read Slice

Grounded in the `AllCustomers` slice (test in `AllCustomersProjectorTest`) — verified, compiled and
passing under `mvn test`, including the one Testcontainers-based end-to-end test
(`UmaDbContainerIntegrationTest`) that proves a real `umadb/umadb:0.7.5` server, `EventDispatcher`'s
live subscription, and this JPA projection all wire together correctly for real.

UmaDB has no read-model/projection concept of its own (no `@EventHandler`, no query bus) — a read
slice here is entirely this project's own convention, built on the shared `eventstore` package:
`SliceEventListener` is the interface every projector implements, and `EventDispatcher` (already in
the root scaffold, already proven — see below) is the ONE shared subscription that fans events out
to every projector and automation processor in the app. **You do not need to write a new
subscription or a new Testcontainers test for each read slice** — just implement
`SliceEventListener` and `EventDispatcher` picks it up automatically as a Spring bean.

## Step 0: Discover Target Project Conventions

> **Comments & description**: each element carries a `comments: string[]` array (board comments)
> and a `description` field — use them as implementation hints, and resolve consumed comments via
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

Before writing any code, read the target project's `.build-kit/CLAUDE.md`.

**Determine `{basePackage}`** — every code example below is rooted at
`{basePackage}.slices.{context}.{slicename}`. Resolve `{basePackage}` as documented there.

## Step 1: Ensure Events Exist

Before implementing the read slice, verify that every event the projector reacts to already exists
in `src/main/java/.../{context}/events/`. If one doesn't, create it first following
`build-state-change` Step 2 (sealed interface + concrete record + `TYPE` constant + `EventTags`
entry) — a read slice never invents its own copy of an event another slice already owns.

## Step 2: Implement the Read Slice

If the slice details include `## Scenarios (GWTs)`, use them to derive test cases. GWT format for
read slices: `Given (events) → Then (information)` — no When. Events in Given tell you which events
the projector reacts to. The information element in Then describes the expected query result.

If the slice description or comments contain `## Implementation Guidelines`, **follow them**.

A read slice lives in a single package. **Do NOT add Domain/Application/Presentation section
comments** — those are only for write slices. Read slices are never feature-flagged (no
`@ConditionalOnProperty`) — unlike write and automation slices.

### Slice package structure

```
.../slices/{context}/{slicename}/      (i.e. {basePackage}.slices.{context}.{slicename} — see Step 0)
├── Get{SliceName}.java       ← query record + nested Result
├── {SliceName}Summary.java   ← read model (projection output shape)
├── {SliceName}Entity.java    ← JPA entity, package-private
├── {SliceName}Repository.java   ← package-private JpaRepository
├── {SliceName}Projector.java ← @Component, implements SliceEventListener
└── {SliceName}RestApi.java   ← @RestController (if REST chosen)
```

### Query record

```java
package {basePackage}.slices.{context}.{slicename};

import java.util.List;

public record Get{SliceName}({filterField type} {filterField}) {

    public record Result(List<{SliceName}Summary> items) {}
}
```

No `@Query` annotation exists in this project (UmaDB has nothing like Axon's query bus) — the
record is just this slice's own input/output shape, called directly (see Step 3's `RestApi`).

### Read model summary

```java
public record {SliceName}Summary(String field1, String field2) {}
```

### JPA entity + repository

Projections persist to a database via Spring Data JPA — this is the only supported style. Verified
against `AllCustomersEntity`/`AllCustomersRepository`:

```java
package {basePackage}.slices.{context}.{slicename};

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "{context}_{slicename}")
class {SliceName}Entity {

    @Id
    private String id;
    private String field1;

    protected {SliceName}Entity() {
    }

    {SliceName}Entity(String id, String field1) {
        this.id = id;
        this.field1 = field1;
    }

    {SliceName}Summary toSummary() {
        return new {SliceName}Summary(id, field1);
    }
}
```

```java
package {basePackage}.slices.{context}.{slicename};

import org.springframework.data.jpa.repository.JpaRepository;

interface {SliceName}Repository extends JpaRepository<{SliceName}Entity, String> {
}
```

For filtered queries, add an indexed column and a derived-query method instead of `findAll()` —
`@Table(indexes = {@Index(...)})` plus `List<{SliceName}Entity> findAllBy{FilterField}(String {filterField})`,
used from the `@QueryHandler`-equivalent method below. DB-level filtering, not client-side.

### Projector — implements `SliceEventListener`

```java
package {basePackage}.slices.{context}.{slicename};

import io.umadb.client.Event;
import {basePackage}.eventstore.EventCodec;
import {basePackage}.eventstore.SliceEventListener;
import {basePackage}.slices.{context}.events.{EventName};
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class {SliceName}Projector implements SliceEventListener {

    private final {SliceName}Repository repository;

    public {SliceName}Projector({SliceName}Repository repository) {
        this.repository = repository;
    }

    @Override
    public boolean supports(String eventType) {
        return {EventName}.TYPE.equals(eventType);
    }

    @Override
    public void onEvent(Event event) {
        on(EventCodec.fromEvent(event, {EventName}.class));
    }

    /** Called directly (no client, no dispatcher) by {SliceName}ProjectorTest - see Step 4. */
    public void on({EventName} event) {
        repository.save(new {SliceName}Entity(event.idField(), event.field1()));
    }

    public Get{SliceName}.Result handle(Get{SliceName} query) {
        List<{SliceName}Summary> items = repository.findAll().stream()
                .map({SliceName}Entity::toSummary)
                .toList();
        return new Get{SliceName}.Result(items);
    }
}
```

`supports`/`onEvent` are the only two methods `EventDispatcher` calls — everything else (`on`,
`handle`) is this projector's own API, called directly by tests and by the REST layer. Multiple
event types: repeat the `event.type().equals(...)` check in `supports`, and add one more public
`on(OtherEvent event)` overload.

### Result DTO rules

- If the read model matches the query result **1:1**, expose the summary record directly.
- If the read model contains fields the caller already knows from the query (e.g. the filter
  field), omit those from `Result` and map from the projector's internal model.

## Step 3: REST API Exposure (Optional)

Check the target project's convention first.

```java
package {basePackage}.slices.{context}.{slicename};

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class {SliceName}RestApi {

    private final {SliceName}Projector projector;

    public {SliceName}RestApi({SliceName}Projector projector) {
        this.projector = projector;
    }

    @GetMapping("/api/{context}/{resource}")
    public Get{SliceName}.Result query() {
        return projector.handle(new Get{SliceName}());
    }
}
```

Plain Spring MVC, not WebFlux — same reasoning as `build-state-change` Step 5.

## Step 4: Implement the Slice Test

Pure unit test — instantiate the projector directly with a `@DataJpaTest`-provided repository, no
`UmaDbClient` and no `EventDispatcher` involved. `@DataJpaTest` gives a real (embedded H2, not
Testcontainers) JPA repository without a full Spring Boot application context:

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.events.{EventName};
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
class {SliceName}ProjectorTest {

    @Autowired
    private {SliceName}Repository repository;

    private {SliceName}Projector projector;

    @BeforeEach
    void setUp() {
        projector = new {SliceName}Projector(repository);
    }

    @Test
    @DisplayName("given no events, when query, then empty result")
    void emptyState() {
        var result = projector.handle(new Get{SliceName}());

        assertThat(result.items()).isEmpty();
    }

    @Test
    @DisplayName("given a {EventName} event, then it appears in the result")
    void creationEvent() {
        projector.on(new {EventName}("id-1", "value1"));

        var result = projector.handle(new Get{SliceName}());

        assertThat(result.items()).containsExactly(new {SliceName}Summary("id-1", "value1"));
    }
}
```

Add a `com.h2database:h2` test-scope dependency once, project-wide, if it isn't already there
(already in the root scaffold's `pom.xml`).

### Mapping GWT Scenarios to Tests

| GWT Element | Test Code |
|---|---|
| `NOTHING` in Given | instantiate projector, call `handle(query)` directly |
| Event in Given | call `projector.on(event)` |
| Information in Then | `assertThat(result.items()).containsExactlyInAnyOrder(...)` |

## Step 4b: Storyline-Derived Tests (Optional)

`slice.json` may also carry a `storylines[]` array — narrated walkthroughs where the *same* read
model appears as multiple ordered "beats" across one flow. This is a secondary, supplementary
source: `specifications[]` (Step 4) remains the primary and default source of test cases. Most
slices have no `storylines[]` — skip this step silently when there's nothing relevant.

For each storyline, find beats whose `type` is `READMODEL`. Two such beats **adjacent with only
`EVENT` beat(s) between them** describe one clean, isolable projection test — events = the
cumulative ordered `EVENT` beats through the intervening event(s), expected result = the later
`READMODEL` beat's `fields`/`examples`/`expectEmptyList`. Keep these in a `@Nested` class named
after the storyline's title:

```java
@Nested
@DisplayName("Storyline: {storyline.title}")
class StorylineTests {
    @Test
    @DisplayName("after {EventName}, read model shows {expected state}")
    void beatTransition() {
        projector.on(new {EventName}(/* fields from the intervening beat(s) */));

        var result = projector.handle(new Get{SliceName}());

        assertThat(result.items()).containsExactly(/* expected shape from the later beat */);
    }
}
```

If a beat between two read-model states is a `COMMAND` rather than an `EVENT`, that half belongs to
`build-state-change` (its own command-handler test), not here.

## Reference: Proving `EventDispatcher` Itself (already done — don't repeat per slice)

`{basePackage}.eventstore.EventDispatcher` (root scaffold) is the ONE shared live subscription every
projector and automation reacts through — it's already proven end-to-end against a real
`umadb/umadb:0.7.5` server via Testcontainers (`UmaDbContainerIntegrationTest`, verified against
`AllCustomersProjector` + `AutoSubscribeToDefaultCourseProcessor`). A new read slice does not need
its own Testcontainers test — implementing `SliceEventListener` correctly (Step 2) and unit-testing
`on(event)`/`handle(query)` directly (Step 4) is sufficient; `EventDispatcher` will deliver real
events to it in production exactly as it does for the already-verified slices.

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] Every field in the read model / query result definition in slice.json has a field in `{SliceName}Summary` — no invented fields
- [ ] Every event type in `events[]` has a `type().equals(...)` check in `supports` and a matching `on(...)` overload — no events missed or assumed
- [ ] Every GWT scenario in `specifications[]` maps to a test case in `{SliceName}ProjectorTest`
- [ ] If `storylines[]` is present: every adjacent READMODEL↔READMODEL beat pair for this slice's read model (with only EVENT beats between) has a `@Nested` storyline test — or was deliberately skipped as untraceable
- [ ] No extra query parameters or filter logic were added beyond what slice.json defines
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
