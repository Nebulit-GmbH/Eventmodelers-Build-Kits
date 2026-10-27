# Testing AF5 Applications

AF5 tests follow a **Given → When → Then** structure provided by `AxonTestFixture`. The fixture wires up a real (in-memory) AF5 configuration so tests exercise actual framework behaviour rather than mocks.

Test class conventions (from CLAUDE.md):
- JUnit 5 always; assertions via AssertJ
- `// given` / `// when` / `// then` section comments
- `@Nested` classes to group tests for the same method or scenario
- Test events created via `EventTestUtils`

---

## Setup

### Stateless command handlers

```java
class CourseCommandHandlerTest {

    AxonTestFixture fixture;

    @BeforeEach
    void setUp() {
        var configurer = MessagingConfigurer.create();
        configurer.registerCommandHandlingModule(
            CommandHandlingModule.named("course")
                .commandHandlers()
                .autodetectedCommandHandlingComponent(c -> new CourseCommandHandler())
        );
        fixture = AxonTestFixture.with(configurer);
    }

    @AfterEach
    void tearDown() {
        fixture.stop();
    }
}
```

### Command-centric stateful handlers (DCB with `@EventSourcedEntity`)

When the command handler uses `@InjectEntity` to receive event-sourced models, register each entity type explicitly via the component registry **before** registering the command handler:

```java
class EnrolmentCommandHandlerTest {

    AxonTestFixture fixture;

    @BeforeEach
    void setUp() {
        var configurer = MessagingConfigurer.create();

        // Register event-sourced entity models with the StateManager
        configurer.componentRegistry(cr -> cr.registerModule(
            EventSourcedEntityModule.autodetected(String.class, CourseState.class)
        ));

        // Register the command handler (no EventStore injection needed)
        configurer.registerCommandHandlingModule(
            CommandHandlingModule.named("enrolment")
                .commandHandlers()
                .autodetectedCommandHandlingComponent(c -> new EnrolmentCommandHandler())
        );

        fixture = AxonTestFixture.with(configurer);
    }

    @AfterEach
    void tearDown() {
        fixture.stop();
    }
}
```

For cross-boundary handlers that inject multiple entity types, register each:

```java
configurer.componentRegistry(cr -> cr.registerModule(
    EventSourcedEntityModule.autodetected(UUID.class, AuctionState.class)
));
configurer.componentRegistry(cr -> cr.registerModule(
    EventSourcedEntityModule.autodetected(String.class, WalletState.class)
));
```

`EventSourcedEntityModule.autodetected(IdType.class, EntityType.class)` reads the `@EventSourcedEntity` annotation to configure sourcing criteria, entity factory, and ID resolver automatically. The `IdType` must match the Java type of the routing-key field on commands targeting that entity.

By default the fixture **excludes** heavy infrastructure (such as the Axon Server connector), so a plain `AxonTestFixture.with(configurer)` will not try to connect to an Axon Server instance. To keep that infrastructure wired in — for an integration test — opt in with the customizer: `AxonTestFixture.with(configurer, Customization::asIntegrationTest)`. See `testing/advanced.md` for integration-test setup.

> Under **Spring Boot** the in-memory toggle is the `axon.axonserver.enabled` property, which the commercial `io.axoniq.framework:axon-server-connector` does not honour — that connector connects regardless. See the caveat in `testing/advanced.md` before relying on `axon.axonserver.enabled=false`.

---

## Given — seeding prior state

The Given phase populates the recording event store before the When action runs.

```java
// Single event
fixture.given()
       .event(new CourseCreated("course-1", "DDD", 30))

// Multiple events in one unit of work
       .events(new CourseCreated("course-1", "DDD", 30),
               new StudentEnrolled("course-1", "student-A"))

// Event with metadata
       .event(new CourseCreated("course-1", "DDD", 30),
              Metadata.with("source", "admin"))

// No prior events — makes the intent explicit
       .noPriorActivity()
```

### Seeding tagged events (DCB / `@InjectEntity` tests)

Pass **plain event payloads** to `fixture.given().event(...)`. The fixture's internal `StorageEngineBackedEventStore` runs each payload through `AnnotationBasedTagResolver`, which reads `@EventTag` annotations on the payload class and attaches the correct tags automatically — exactly as a real append would.

```java
fixture.given()
       .event(new CourseCreated("course-1", "DDD", 30))
       .when()
       .command(new EnrollStudent("course-1", "student-A"))
       ...
```

As long as `CourseCreated` carries `@EventTag`-annotated fields, the tags are resolved and stored. When `@InjectEntity` sources events by tag (e.g. `Tag.of("course", "course-1")`), the events are found and the entity state is built correctly.

Events tagged with multiple keys (e.g., a `BidPlaced` tagged with both `auction` and `user`) need no special treatment — all `@EventTag` fields are resolved in one pass.

#### Pitfall: do not pass `GenericTaggedEventMessage` to `fixture.given().event(...)`

```java
// WRONG — tags are silently lost; entity sourcing finds nothing
fixture.given()
       .event(tagged(new CourseCreated("course-1", "DDD", 30), "course", "course-1"))
```

`TaggedEventMessage<E>` does **not** extend `EventMessage`. When the fixture receives a `GenericTaggedEventMessage` as the payload argument, its `payload instanceof EventMessage` check is `false`, so the entire tagged message object is treated as an opaque payload and wrapped in a new `GenericEventMessage` with `GenericTaggedEventMessage.class` as its type. The event is stored with no meaningful tags. When `@InjectEntity` later sources events by tag, it finds nothing, the entity stays in its initial state, and the command handler behaves as if no prior events existed.

**Always pass plain event payload objects.** Manual tag construction is neither needed nor correct.

---

## When — the action under test

```java
// Dispatch a command
.when().command(new EnrollStudent("course-1", "student-A"))

// Dispatch a command with metadata
.when().command(new EnrollStudent("course-1", "student-A"),
                Metadata.with("userId", "admin"))

// Publish an event (for testing event handlers / projections)
.when().event(new CourseCreated("course-1", "DDD", 30))
```

---

## Then — assertions

### Events published

```java
// Exact payload match (uses deep-equals by default)
.then().events(new StudentEnrolled("course-1", "student-A"))

// Multiple events in order
.then().events(new StudentEnrolled("course-1", "student-A"),
               new EnrolmentConfirmed("course-1", "student-A"))

// No events expected
.then().noEvents()

// Custom assertion on the event list
.then().eventsSatisfy(events -> {
    assertThat(events).hasSize(1);
    assertThat(events.get(0).payload()).isInstanceOf(StudentEnrolled.class);
})
```

### Command handler result

```java
// Handler completed without exception
.then().success()

// Handler returned a specific value
.then().success()
       .resultMessagePayload(new EnrolmentId("enrol-42"))

// Custom assertion on the result
.then().resultMessagePayloadSatisfies(EnrolmentId.class,
        id -> assertThat(id.value()).startsWith("enrol-"))
```

### Exceptions

```java
// Handler threw a specific exception type
.then().exception(CourseFullException.class)

// Exception type and EXACT message (compared with String.equals, not a substring)
.then().exception(CourseFullException.class, "course-1 is at capacity")

// For substring / custom checks, use exceptionSatisfies
.then().exceptionSatisfies(ex -> {
    assertThat(ex).isInstanceOf(CourseFullException.class);
    assertThat(ex.getMessage()).contains("course-1");
})
```

### Commands dispatched as side effects

```java
// Assert that a command was dispatched during event handling
.then().commands(new SendEnrolmentConfirmation("course-1", "student-A"))

// No commands dispatched
.then().noCommands()
```

### Async assertions (streaming event processors)

When the When phase publishes an event that triggers an async event processor:

```java
.when().event(new CourseCreated("course-1", "DDD", 30))
.then().await(then -> then.commands(
        new NotifyCourseAvailable("course-1")))   // default 5 s timeout

// With explicit timeout
.then().await(then -> then.events(new NotificationSent("course-1")),
              Duration.ofSeconds(10))
```

---

## Chaining scenarios

```java
fixture.given()
       .event(new CourseCreated("course-1", "DDD", 30))
       .when().command(new EnrollStudent("course-1", "student-A"))
       .then().events(new StudentEnrolled("course-1", "student-A"))
       .and()   // ← returns to Given for the next scenario
       .given()
       .event(new CourseCreated("course-2", "EDA", 10))
       .when().command(new EnrollStudent("course-2", "student-B"))
       .then().success();
```

---

## EventTestUtils

Use `EventTestUtils` (in `messaging` test sources) to create generic test events when the specific payload doesn't matter:

```java
import static org.axonframework.messaging.eventhandling.EventTestUtils.*;

List<EventMessage<?>> events = createEvents(3);   // payloads: Integer 0, 1, 2
EventMessage<?> single     = createEvent(42);      // payload: Integer 42
EventMessage<?> wrapped    = asEventMessage(new CourseCreated("c", "DDD", 30));
```

---

## Matchers

For richer assertions beyond exact equality, use the `Matchers` factory:

```java
import static org.axonframework.test.matchers.Matchers.*;
import static org.hamcrest.Matchers.*;

// Deep field-by-field equality (ignores transient fields by default)
deepEquals(new StudentEnrolled("course-1", "student-A"))

// Ordered exact sequence with no extras
exactSequenceOf(
    messageWithPayload(instanceOf(StudentEnrolled.class)),
    messageWithPayload(instanceOf(EnrolmentConfirmed.class)),
    andNoMore())

// Sequence allowing gaps
sequenceOf(
    messageWithPayload(hasProperty("studentId", equalTo("student-A"))))

// Any of the list
listWithAnyOf(messageWithPayload(instanceOf(StudentEnrolled.class)))
```

`.eventsMatch(...)` and `.commandsMatch(...)` take a `Predicate<List<EventMessage>>` / `Predicate<List<CommandMessage>>` — **not** a Hamcrest `Matcher`. To assert with a Hamcrest matcher, use the `*Satisfy` form and apply the matcher inside it:

```java
.then().eventsSatisfy(events -> assertThat(events, exactSequenceOf(
    messageWithPayload(deepEquals(new StudentEnrolled("course-1", "student-A"))),
    andNoMore())))
```

See `testing/matchers.md` for the full matcher and field-filter reference.

---

## Ignoring fields in deep equality

Register field filters to ignore generated or timestamp fields:

```java
fixture = AxonTestFixture.with(configurer, c -> c
        .registerIgnoredField(StudentEnrolled.class, "enrolledAt")
        .registerIgnoredField(StudentEnrolled.class, "enrollmentId"));
```

---

## JUnit 5 structure example

```java
class EnrolmentCommandHandlerTest {

    AxonTestFixture fixture;

    @BeforeEach void setUp() { /* ... */ }
    @AfterEach  void tearDown() { fixture.stop(); }

    @Nested
    class WhenEnrollingStudent {

        @Test
        void publishesStudentEnrolledEvent() {
            // given
            fixture.given()
                   .event(new CourseCreated("c1", "DDD", 30));
            // when / then
            fixture.when()
                   .command(new EnrollStudent("c1", "s1"))
                   .then()
                   .events(new StudentEnrolled("c1", "s1"));
        }

        @Test
        void rejectsWhenCourseFull() {
            // given
            fixture.given()
                   .event(new CourseCreated("c1", "DDD", 1))
                   .event(new StudentEnrolled("c1", "s-existing"));
            // when / then
            fixture.when()
                   .command(new EnrollStudent("c1", "s-new"))
                   .then()
                   .exception(CourseFullException.class);
        }
    }
}
```
