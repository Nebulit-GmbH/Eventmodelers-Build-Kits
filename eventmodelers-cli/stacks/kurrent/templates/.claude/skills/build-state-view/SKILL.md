---
name: build-state-view
authors:
  - Martin Dilger
description: >
  Implement read slices (JPA-backed projections + REST query endpoint + tests) directly against
  KurrentDB 1.2.x (Java client) in this project's one established pattern: a KurrentDB persistent
  subscription (filtered to this context's streams) feeds a projector method that updates a private
  JPA entity; a separate REST controller queries the repository directly. Use when implementing a new
  read slice / projection in this project. Plain Java only. There is exactly one supported style — do
  not offer alternatives.
---

# KurrentDB — Read Slice (Java)

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
`src/main/java/.../{context}/api/` (the context's sealed event interface + `{Context}EventTypes`). If
they don't, create them **first** — see `build-state-change` Step 2. Do not skip registering a new
event's type name even for a pure read slice — an unregistered event type is silently invisible to this
projector too.

## Step 2: Implement the read slice

If the slice details include `## Scenarios (GWTs)`, use them to derive test cases (Step 5). GWT format
for read slices: `Given (events) → Then (information)` — no When. Events in Given tell you which
events the projector handles. The information element in Then describes the expected query result.

If the slice description or comments contain `## Implementation Guidelines`, **follow them**.

### Slice package structure

```
.../slices/{context}/{slicename}/     (i.e. {basePackage}.slices.{context}.{slicename} — see Step 0)
├── {SliceName}Entity.java       ← @Entity, private to this slice
├── {SliceName}Repository.java  ← Spring Data repository, private to this slice
├── {SliceName}Summary.java     ← read model (query result shape)
├── {SliceName}Projector.java   ← persistent-subscription listener + projection logic
└── {SliceName}RestApi.java     ← @RestController (if REST chosen)
```

A read slice lives in a single package. **Never reuse another slice's entity/repository** — a read
model is private to the slice that owns it, even if another slice's projector happens to need
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

### Result DTO rules

- If the read model matches the entity **1:1**, expose the summary record directly (`toSummary()`
  above).
- If the read model contains fields the caller already knows from the query (e.g. the filter field
  itself), omit those from `{SliceName}Summary` and map only what's new.

### Projector — persistent subscription

A persistent subscription is KurrentDB's own durable, at-least-once, ack/nack-based consumer
mechanism — the server tracks this group's checkpoint, so there's no local progress table to maintain
(unlike the OpenCQRS/Axon kits' `ProgressTracker`).

**Subscription group name**: pick one stable name per read model (e.g. `"{context}-{slicename}"`) and
never rename it once deployed — KurrentDB persists the checkpoint under this exact group name.
Renaming it doesn't fail loudly; the "new" group just starts from `fromStart()` again (or from
wherever `CreatePersistentSubscriptionToAllOptions` says), reprocessing everything and likely
duplicating rows unless your upserts are idempotent by natural key (they are here, since `save(...)`
on a JPA entity with a fixed `@Id` upserts).

**Filter to this context's streams**: this read model spans every stream in the context (one stream per
aggregate instance, e.g. `library-4711`, `library-4712`, ...), so subscribe to `$all` with a
stream-name-prefix filter rather than to one specific stream.

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.{Context}EventTypes;
import io.kurrent.dbclient.*;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.concurrent.ExecutionException;

@Component
public class {SliceName}Projector {

    private static final String GROUP = "{context}-{slicename}";

    private final KurrentDBPersistentSubscriptionsClient subscriptionsClient;
    private final {SliceName}Repository repository;

    public {SliceName}Projector(KurrentDBPersistentSubscriptionsClient subscriptionsClient,
                                 {SliceName}Repository repository) {
        this.subscriptionsClient = subscriptionsClient;
        this.repository = repository;
    }

    @PostConstruct
    void start() throws ExecutionException, InterruptedException {
        SubscriptionFilter filter = SubscriptionFilter.newBuilder()
                .addStreamNamePrefix("{context-lower}-")
                .build();
        try {
            subscriptionsClient.createToAll(GROUP,
                    CreatePersistentSubscriptionToAllOptions.get().fromStart().filter(filter)).get();
        } catch (ExecutionException e) {
            if (!(e.getCause() instanceof io.grpc.StatusRuntimeException grpcException)
                    || grpcException.getStatus().getCode() != io.grpc.Status.Code.ALREADY_EXISTS) {
                throw e;
            }
            // group already created on a previous startup — expected, not an error
        }

        subscriptionsClient.subscribeToAll(GROUP, new PersistentSubscriptionListener() {
            @Override
            @Transactional
            public void onEvent(PersistentSubscription subscription, int retryCount, ResolvedEvent event) {
                try {
                    var domainEvent = {Context}EventTypes.deserialize(event.getOriginalEvent());
                    domainEvent.ifPresent({SliceName}Projector.this::project);
                    subscription.ack(event);
                } catch (Exception ex) {
                    subscription.nack(NackAction.Park, ex.getMessage(), event);
                }
            }

            @Override
            public void onCancelled(PersistentSubscription subscription, Throwable exception) {
                // logged by the framework's own subscription lifecycle; nothing project-specific needed
            }
        });
    }

    private void project(/* {Context}Event */ Object event) {
        switch (event) {
            case {EventName} e -> repository.save(new {SliceName}Entity(e.idField(), e.{filterField}()));
            default -> { /* not this projection's concern */ }
        }
    }
}
```

`domainEvent.ifPresent(...)` already filters out events this context doesn't recognize; `project`'s own
`switch` further narrows to just the event type(s) this specific read model cares about — every other
recognized-but-irrelevant event in the context falls through the `default` arm and is still acked
(acking is "I've seen this event", not "this event changed my data").

### Entity + repository template (for filtered queries)

Use `findAllBy{FilterField}(...)` in the query endpoint below — DB-level filtering, not client-side.

## Step 3: REST query endpoint

Separate class — plain constructor-injected Spring bean, unrelated to the persistent-subscription
listener above:

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

## Step 4: Design test cases

Implement the test cases provided in the slice definition. Do not design your own test cases unless
specifically instructed to do so.

### Mapping GWT scenarios to tests

| GWT Element | Test code |
|---|---|
| `NOTHING` in Given | call the repository query directly with no prior `.save(...)` |
| Event in Given | call the projector's `project(event)` method directly (package-private — see below) |
| Information in Then | assert the repository query result / mapped summaries |

## Step 5: Implement the test — `@DataJpaTest` + `@Import` + Testcontainers Postgres

There is no need to exercise the real persistent-subscription machinery to test a projection's
business logic — split `project(Object event)` out as its own package-private method (as shown above)
specifically so a test can call it directly, bypassing `@PostConstruct`/subscribe/ack entirely.

**This project is on Spring Boot 4** — `@DataJpaTest` moved to the `spring-boot-data-jpa-test` artifact
under package `org.springframework.boot.data.jpa.test.autoconfigure` (not the Boot 3
`org.springframework.boot.test.autoconfigure.orm.jpa` package).

**This project's read models target PostgreSQL, not H2** — `@DataJpaTest`'s default behavior tries to
replace the datasource with an embedded database, which fails outright with no H2/Derby/HSQL on the
classpath. Use Testcontainers' real Postgres instead:

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.{EventName};
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
    private {SliceName}Repository repository;

    // Constructing {SliceName}Projector directly (not @Autowired) avoids @PostConstruct trying to
    // reach a real KurrentDB from this test — pass null for the subscriptions client since project()
    // never uses it.
    private {SliceName}Projector projector;

    @org.junit.jupiter.api.BeforeEach
    void setUp() {
        projector = new {SliceName}Projector(null, repository);
    }

    @Test
    void givenNoEvents_thenEmptyResult() {
        assertThat(repository.findAllBy{FilterField}("filter-value")).isEmpty();
    }

    @Test
    void givenCreationEvent_thenItemAppears() {
        projector.project(new {EventName}("id-1", "filter-value" /*, other fields */));

        var result = repository.findAllBy{FilterField}("filter-value").stream()
                .map({SliceName}Entity::toSummary)
                .toList();

        assertThat(result).containsExactly(new {SliceName}Summary("id-1", "filter-value"));
    }

    @Test
    void itemsAreIsolatedByFilterField() {
        projector.project(new {EventName}("id-1", "group-A"));
        projector.project(new {EventName}("id-2", "group-B"));

        assertThat(repository.findAllBy{FilterField}("group-A")).hasSize(1);
        assertThat(repository.findAllBy{FilterField}("group-B")).hasSize(1);
    }
}
```

If `project`'s `switch` is package-private (as written above), this test class must live in the same
package — which it already does, following this stack's convention (`{SliceName}ProjectorTest` next to
`{SliceName}Projector`).

### Key rules

- Call `project(event)` directly — never go through `@PostConstruct`/the persistent-subscription
  listener in a test. `onEvent`'s job (deserialize, ack/nack) is KurrentDB-plumbing, already covered
  once, generically, by `{Context}EventTypes` — it's not this slice's business logic to re-test.
- **Assert with full objects**: `containsExactly(new Summary(...))` rather than field-by-field
  assertions — catches mapping mistakes a partial assertion would miss.
- **Requires Docker running locally/in CI** — the `PostgreSQLContainer` starts a real container per
  test class. There is no embedded-database fallback in this project.

## Step 5b: Storyline-Derived Tests (Optional)

`slice.json` may also carry a `storylines[]` array — narrated walkthroughs where the *same* read
model appears as multiple ordered "beats" across one flow (see `elements[]` on each storyline).
This is a secondary, supplementary source: `specifications[]` (Step 4) remains the primary and
default source of test cases. Most slices have no `storylines[]` — skip this step silently when
there's nothing relevant.

For each storyline, find beats whose `type` is `READMODEL`. Two such beats **adjacent with only
`EVENT` beat(s) between them** describe one clean, isolable projection test:

- events = the cumulative ordered `EVENT` beats from the start of the storyline through the
  intervening event(s) — call `projector.project(...)` once per event, in order
- expected result = the later `READMODEL` beat's `fields`/`examples`/`expectEmptyList`

Keep these in a clearly separate `@Nested` class named after the storyline's title:

```java
@Nested
class StorylineTests {
    @Test
    void afterEvent_readModelShowsExpectedState() {
        projector.project(new {EventName}(/* fields from the intervening beat(s) */));

        var result = repository.findAllBy{FilterField}("filter-value").stream()
                .map({SliceName}Entity::toSummary)
                .toList();

        assertThat(result).containsExactly(/* expected shape from the later beat */);
    }
}
```

If a beat between two read-model states is a `COMMAND` rather than an `EVENT`, that half belongs to
`build-state-change` (its own command-handler test), not here — only project the `EVENT`→`READMODEL`
half. If a storyline segment involves a `SCREEN`/other untraceable beat, don't force a test — leave it
undocumented rather than fabricating an assertion.

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] Every field in the read model / query result definition in slice.json has a field in `{SliceName}Summary` — no invented fields
- [ ] Every event type in `events[]` this projection reacts to is handled in `project`'s `switch` — no events missed or assumed
- [ ] Every new event's type name is registered in `{Context}EventTypes`
- [ ] The subscription's group name is stable and won't collide with another slice's
- [ ] Every GWT scenario in `specifications[]` maps to a test case calling `project(...)` directly
- [ ] If `storylines[]` is present: every adjacent READMODEL↔READMODEL beat pair for this slice's read model (with only EVENT beats between) has a `@Nested` storyline test — or was deliberately skipped as untraceable
- [ ] No extra query parameters or filter logic were added beyond what slice.json defines
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
