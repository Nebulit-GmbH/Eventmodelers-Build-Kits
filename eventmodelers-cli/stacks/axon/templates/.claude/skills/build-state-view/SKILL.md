---
name: build-state-view
authors:
  - Mateusz Nowak
  - Martin Dilger
description: >
  Implement read slices (projections + query handlers + REST API + tests) using Axon Framework 5
  with Spring Boot. A read slice is: Events projected into a Read Model, queried via QueryGateway.
  Use when: (1) implementing a new read slice / projection in an AF5 Java project,
  (2) migrating/porting a read slice from Axon Framework 4 (Java or Kotlin) to AF5,
  (3) user provides a read slice specification or Event Modeling artifact and asks to implement it,
  (4) user says "implement", "create", "add" a read slice, projection, query handler,
  or read model in an Axon Framework 5 / Vertical Slice Architecture project.
---

# Axon Framework 5 — Read Slice (Java)

## Step 0: Discover Target Project Conventions

> **Comments & description**: Each element in the slice carries a `comments: string[]` array and a `description` field. Use these as implementation hints. When done, resolve each used comment: `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get IDs first via GET on same path).

Before writing any code, read the target project's `CLAUDE.md`

## Step 1: Ensure Events Exist

Before implementing the read slice, verify that all events the projector handles exist in the
codebase. If they don't, create them **first**.

### Concrete event records

```java
@Event(namespace = "{Context}", name = "{EventName}", version = "1.0.0")
public record {EventName}(
    @EventTag
    String {tagProperty},
    String field1
){}
```

Key rules:
- Import `@Event` from `org.axonframework.messaging.eventhandling.annotation.Event`
- `namespace` = context name, `name` = record name, `version` = `"1.0.0"` for new events
- When an event participates in a DCB, add extra `@EventTag` on cross-stream fields

## Step 2: Implement the Read Slice

If the Event Modeling artifact includes slice details with `## Scenarios (GWTs)`, use them to
derive test cases. GWT format for read slices: `Given (events) → Then (information)` — no When.
Events in Given tell you which events the projector handles. The information element in Then
describes the expected query result.

If the slice description or comments contain `## Implementation Guidelines`, **follow them**.

### Query annotation

Every query record must have `@Query(namespace, name, version)`:

```java
@Query(namespace = "{Context}", name = "Get{SliceName}", version = "1.0.0")
public record Get{SliceName}(String {filterField}) {
    public record Result(List<{SliceName}Summary> items) {}
}
```

- Import `@Query` from `org.axonframework.messaging.queryhandling.annotation.Query`

A read slice lives in a single package. **Do NOT add Domain/Application/Presentation section
comments** — those are only for write slices.

### Slice package structure

```
de/<package>/{context}/slices/{slicename}/
├── Get{SliceName}.java       ← query record + nested Result
├── {SliceName}Summary.java   ← read model (projection output shape)
├── {SliceName}Projector.java ← @Component with @EventHandler + @QueryHandler
└── {SliceName}RestApi.java   ← @RestController (if REST chosen)
```

### Projector + query handler (JPA-backed)

Projections persist to a database via Spring Data JPA — this is the only supported style.

```java
public record AllCustomersSummary(String name, String email) {}

@Query(namespace = "CustomerManagement", name = "GetAllCustomers", version = "1.0.0")
public record GetAllCustomers() {
    public record Result(List<AllCustomersSummary> items) {}
}

@Entity
@Table(name = "customer_management_allcustomers")
class AllCustomersEntity {

    @Id
    private String email;
    private String name;

    protected AllCustomersEntity() {
    }

    AllCustomersEntity(String email, String name) {
        this.email = email;
        this.name = name;
    }

    AllCustomersSummary toSummary() {
        return new AllCustomersSummary(name, email);
    }
}

@Component
public class AllCustomersProjector {

    private final AllCustomersRepository repository;

    public AllCustomersProjector(AllCustomersRepository repository) {
        this.repository = repository;
    }

    @EventHandler
    public void on(CustomerRegistered event) {
        repository.save(new AllCustomersEntity(event.email(), event.name()));
    }

    @QueryHandler
    public GetAllCustomers.Result handle(GetAllCustomers query) {
        List<AllCustomersSummary> items = repository.findAll().stream()
                .map(AllCustomersEntity::toSummary)
                .toList();
        return new GetAllCustomers.Result(items);
    }
}

interface AllCustomersRepository extends JpaRepository<AllCustomersEntity, String> {
}
```

### Result DTO rules

- If the read model matches the query result **1:1**, expose the summary record directly.
- If the read model contains fields the caller already knows from the query (e.g., the filter field),
  omit those from the `Result` and map from the projector's internal model.

### Entity + repository template

For filtered queries, add an index and a derived-query method instead of `findAll()`:

```java
@Entity
@Table(
    name = "{context}_read_{slicename}",
    indexes = {@Index(name = "idx_{context}_{slicename}_{col}", columnList = "{filterField}")}
)
public class {SliceName}Entity {
    @Id private String id;
    private String {filterField};
    // ... other fields
}

@Repository
interface {SliceName}Repository extends JpaRepository<{SliceName}Entity, String> {
    List<{SliceName}Entity> findAllBy{FilterField}(String {filterField});
}
```

Use `findAllBy{FilterField}(...)` in the `@QueryHandler` — DB-level filtering, not client-side.

## Step 3: REST API Exposure (Optional)

Check the target project's convention first.

```java
// File: {SliceName}RestApi.java
@RestController
public class {SliceName}RestApi {

    private final QueryGateway queryGateway;

    public {SliceName}RestApi(QueryGateway queryGateway) {
        this.queryGateway = queryGateway;
    }

    @GetMapping("/api/{context}/{filterField}")
    public Mono<Get{SliceName}.Result> query(@PathVariable String {filterField}) {
        return Mono.fromFuture(
            queryGateway.query(new Get{SliceName}({filterField}), Get{SliceName}.Result.class)
        );
    }
}
```

## Step 4: Design Test Cases

Implement the test cases provided in the slice definition. 
Do not design your own test cases unless specifically instructed to do so.

### Mapping GWT Scenarios to Tests

| GWT Element | Test Code |
|---|---|
| `NOTHING` in Given | instantiate projector, call `handle(query)` directly |
| Event in Given | call `projector.on(event)` |
| Information in Then | `assertThat(result.items()).containsExactlyInAnyOrder(...)` |

## Step 5: Implement the Slice Test

Pure unit tests — instantiate the projector directly, no Spring context needed.
Fast, no container startup.

```java
// File: src/test/java/de/<package>/{context}/slices/{slicename}/{SliceName}ProjectorTest.java
class {SliceName}ProjectorTest {

    private {SliceName}Projector projector;

    @BeforeEach
    void setUp() {
        projector = new {SliceName}Projector();
    }

    @Test
    @DisplayName("given no events, when query, then empty result")
    void emptyState() {
        var result = projector.handle(new Get{SliceName}("filter-value"));

        assertThat(result.items()).isEmpty();
    }

    @Test
    @DisplayName("given creation event, then item appears in result")
    void creationEvent() {
        projector.on(new {CreationEvent}("id-1", "filter-value" /*, other fields */));

        var result = projector.handle(new Get{SliceName}("filter-value"));

        assertThat(result.items()).containsExactly(
            new {SliceName}Summary("id-1", "filter-value" /*, expected fields */)
        );
    }

    @Test
    @DisplayName("given creation then deletion, then item disappears")
    void deletionEvent() {
        projector.on(new {CreationEvent}("id-1", "filter-value"));
        projector.on(new {DeletionEvent}("id-1"));

        var result = projector.handle(new Get{SliceName}("filter-value"));

        assertThat(result.items()).isEmpty();
    }

    @Test
    @DisplayName("items are isolated by filter field")
    void isolation() {
        projector.on(new {CreationEvent}("id-1", "group-A"));
        projector.on(new {CreationEvent}("id-2", "group-B"));

        assertThat(projector.handle(new Get{SliceName}("group-A")).items()).hasSize(1);
        assertThat(projector.handle(new Get{SliceName}("group-B")).items()).hasSize(1);
    }
}
```

### Key Rules

- **Metadata when needed**: If the projector uses `@MetadataValue(...)`, pass metadata by publishing
  events to an `AxonTestFixture` rather than calling `on(event)` directly. Use the Spring Boot
  integration test approach in that case.
- **Assert with full objects**: Use `containsExactlyInAnyOrder(new Summary(...))` rather than
  field-by-field assertions — catches serialization mismatches.

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] Every field in the read model / query result definition in slice.json has a field in `{SliceName}Summary` — no invented fields
- [ ] Every event type in `events[]` has an `@EventHandler` in the projector — no events missed or assumed
- [ ] Every GWT scenario in `specifications[]` maps to a test case in `{SliceName}ProjectorTest`
- [ ] No extra query parameters or filter logic were added beyond what slice.json defines
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code