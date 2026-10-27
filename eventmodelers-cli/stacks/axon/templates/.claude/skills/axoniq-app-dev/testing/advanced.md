# Advanced Testing in Axon Framework 5

This guide builds on `testing/basics.md` (Given → When → Then with `AxonTestFixture`) and `testing/matchers.md`. It covers the parts of `AxonTestFixture` you reach for once the basics are in place: asserting on metadata, inspecting result messages and exceptions in depth, controlling time, customizing the fixture, integration tests against a real configuration, and Spring Boot wiring with `@AxonSpringBootTest`.

All examples use the University domain. Setup (`@BeforeEach`/`@AfterEach`, building the `MessagingConfigurer`/`EventSourcingConfigurer`) is as shown in `testing/basics.md` and is omitted here unless relevant.

> The fixture lives in `org.axonframework.test.fixture`. The fluent phases are defined on `AxonTestPhase` (`Setup`, `Given`, `When`, `Then`). The Then-phase assertion methods live on `AxonTestPhase.Then.MessageAssertions`.

---

## Asserting on metadata

The basic `.events(payload...)` and `.commands(payload...)` overloads compare payloads only (deep field equality, message identifier ignored). To assert on **metadata**, use one of two approaches.

### Compare full message including metadata

Pass `EventMessage` / `CommandMessage` instances instead of plain payloads. These overloads compare the payload **and** the metadata for equality:

```java
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.core.Metadata;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.GenericEventMessage;

fixture.given()
       .event(new CourseCreated("course-1", "DDD", 30))
       .when()
       .command(new EnrollStudent("course-1", "student-A"),
                Metadata.with("userId", "admin"))
       .then()
       .events(new GenericEventMessage(
               new MessageType(StudentEnrolled.class),
               new StudentEnrolled("course-1", "student-A"),
               Metadata.with("userId", "admin")));
```

> Metadata comparison is **exact equality** of the metadata map. If dispatch interceptors enrich the message (correlation ids, tracing headers), those keys must be present in the expected message too, or use the inspection approach below.

### Inspect metadata with a custom assertion

`eventsSatisfy` / `commandsSatisfy` hand you the recorded `List<EventMessage>` / `List<CommandMessage>` so you can read `metadata()` selectively — ideal when interceptors add keys you don't want to enumerate:

```java
import static org.assertj.core.api.Assertions.assertThat;

fixture.given().noPriorActivity()
       .when()
       .command(new EnrollStudent("course-1", "student-A"),
                Metadata.with("userId", "admin"))
       .then()
       .eventsSatisfy(events -> {
           assertThat(events).hasSize(1);
           assertThat(events.getFirst().metadata())
                   .containsEntry("userId", "admin");
       });
```

`eventsMatch(Predicate<List<EventMessage>>)` / `commandsMatch(...)` are the `Predicate`-based equivalents:

```java
.then()
.eventsMatch(events ->
        events.stream().allMatch(e -> e.metadata().containsKey("traceId")));
```

> Field filters registered via `Customization` (see below) apply only to the payload-comparing methods (`events(...)`, `commands(...)`, `resultMessagePayload(...)`). They are **not** consulted by `eventsSatisfy`/`eventsMatch`.

---

## Result messages

For command handlers that return a value, the Then phase exposes the full `CommandResultMessage`, not just its payload.

| Method | Purpose |
|---|---|
| `success()` | Assert the When phase completed without an exception (any/no return value). |
| `resultMessagePayload(Object)` | Assert the result payload equals the given value (uses field filters). |
| `resultMessagePayloadSatisfies(Class<T>, Consumer<T>)` | Convert the payload to `T` (via the configured `MessageConverter`) and run a custom assertion. |
| `resultMessageSatisfies(Consumer<CommandResultMessage>)` | Custom assertion on the whole result message — payload **and** metadata. |

```java
import org.axonframework.messaging.commandhandling.CommandResultMessage;

fixture.given().noPriorActivity()
       .when()
       .command(new EnrollStudent("course-1", "student-A"))
       .then()
       .success()
       .resultMessagePayloadSatisfies(EnrolmentId.class,
               id -> assertThat(id.value()).startsWith("enrol-"))
       .resultMessageSatisfies(result ->
               assertThat(result.metadata()).containsKey("enrolledBy"));
```

> Prefer `resultMessagePayloadSatisfies(Class, Consumer)` over the deprecated no-type `resultMessagePayloadSatisfies(Consumer<Object>)`: it handles payload conversion automatically, which matters for distributed setups where the raw payload may be a `byte[]` or other intermediate form.

---

## Testing exception outcomes

| Method | Behaviour |
|---|---|
| `exception(Class<? extends Throwable>)` | The When phase threw an exception assignable to the given type. |
| `exception(Class<? extends Throwable>, String)` | Type match **and** the message equals the given string exactly. |
| `exceptionSatisfies(Consumer<Throwable>)` | Custom assertion on the thrown exception. |

```java
// Type only
fixture.given()
       .event(new CourseCreated("course-1", "DDD", 1))
       .event(new StudentEnrolled("course-1", "student-existing"))
       .when()
       .command(new EnrollStudent("course-1", "student-new"))
       .then()
       .exception(CourseFullException.class)
       .noEvents();   // assertions chain — also verify nothing was published
```

```java
// Custom assertion (use for partial-message / cause / state checks)
fixture.given().noPriorActivity()
       .when()
       .command(new EnrollStudent("unknown-course", "student-A"))
       .then()
       .exceptionSatisfies(ex -> {
           assertThat(ex).isInstanceOf(CourseNotFoundException.class);
           assertThat(ex.getMessage()).contains("unknown-course");
       });
```

> `exception(type, message)` matches the message with `String.equals` — it is **not** a substring match. For substring or pattern checks, use `exceptionSatisfies` and assert with `contains(...)` / `matches(...)` yourself.

> Exceptions are only captured for messages dispatched explicitly in the When phase (`command`/`event`). Exceptions thrown by handlers reacting as a *side effect* (e.g. a downstream event handler) are not surfaced by `exception(...)`.

---

## Controlling time

Event timestamps and any handler logic that reads "now" resolve through the framework's global clock, `org.axonframework.common.ClockUtils`. There is no dedicated time method on the fixture; pin the clock directly for deterministic timestamps, then restore it.

```java
import org.axonframework.common.ClockUtils;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

@Test
void recordsEnrolmentAtFixedInstant() {
    ClockUtils.set(Clock.fixed(Instant.parse("2026-01-01T10:00:00Z"), ZoneOffset.UTC));
    try {
        fixture.given().noPriorActivity()
               .when()
               .command(new EnrollStudent("course-1", "student-A"))
               .then()
               .eventsSatisfy(events ->
                       assertThat(events.getFirst().timestamp())
                               .isEqualTo(Instant.parse("2026-01-01T10:00:00Z")));
    } finally {
        ClockUtils.reset();   // restore the default UTC system clock
    }
}
```

> `ClockUtils` is process-global. Always `ClockUtils.reset()` in a `finally` (or `@AfterEach`) so a pinned clock does not leak into sibling tests.

---

## Customizing the fixture

`AxonTestFixture.with(configurer, customization)` takes a `UnaryOperator<Customization>`. `Customization` is an immutable record; each method returns a new instance, so chain fluently.

| Method | Effect |
|---|---|
| `asIntegrationTest()` | Keep "heavy" infrastructure enhancers (e.g. the Axon Server connector). Defaults to **off** — by default those enhancers are disabled, so the fixture runs fully in-memory. |
| `registerIgnoredField(Class<?>, String)` | Exclude a field from deep-equality payload comparison (timestamps, generated ids). |
| `registerFieldFilter(FieldFilter)` | Register an arbitrary `FieldFilter`; a field is compared only if **all** registered filters accept it. |

```java
fixture = AxonTestFixture.with(configurer, c -> c
        .registerIgnoredField(StudentEnrolled.class, "enrolledAt")
        .registerIgnoredField(StudentEnrolled.class, "enrolmentId"));
```

> By default (no `asIntegrationTest()`), the fixture disables the Axon Server and PostgreSQL configuration enhancers, so no external connection is attempted. Call `asIntegrationTest()` only when you genuinely want to exercise that infrastructure (see below). Field filters apply to `events`/`commands`/`resultMessagePayload`; richer comparisons belong in `matchers.md`.

> The Spring Boot path is different — there the in-memory behaviour is keyed off the `axon.axonserver.enabled` property, which the commercial `io.axoniq.framework` connector does **not** honour. See the caveat under **Testing with Spring Boot** below.

---

## Integration testing

`AxonTestFixture` accepts your entire `ApplicationConfigurer`, and the broad `given().execute(...)` and `then().expect(...)` hooks give you the running `Configuration`. Together these turn the fixture into an integration-test driver: seed state, dispatch through the real wiring, then resolve any component to verify side effects.

```java
import org.axonframework.common.configuration.Configuration;
import org.axonframework.modelling.repository.Repository;
import org.axonframework.test.fixture.AxonTestFixture;

class EnrolmentIntegrationTest {

    private AxonTestFixture fixture;

    @BeforeEach
    void setUp() {
        // Build from the full application configurer (e.g. a static factory in your app)
        fixture = AxonTestFixture.with(UniversityApp.configurer());
    }

    @Test
    void enrolsAgainstRealConfiguration() {
        fixture.given()
               .event(new CourseCreated("course-1", "DDD", 30))
               .execute(config -> {
                   // arbitrary setup against any component
                   var repository = config.getComponent(Repository.class);
                   // ...
               })
               .when()
               .command(new EnrollStudent("course-1", "student-A"))
               .then()
               .success()
               .expect(config -> {
                   // resolve components and verify
                   var repository = config.getComponent(Repository.class);
                   assertThat(repository).isNotNull();
               });
    }

    @AfterEach
    void tearDown() {
        fixture.stop();   // shuts down the configuration; releases resources
    }
}
```

`expectAsync(Function<Configuration, CompletableFuture<?>>)` is the asynchronous counterpart of `expect`, and `executeAsync(...)` the async counterpart of `execute`. For assertions that depend on an async (streaming) event processor catching up, wrap them in `await(...)` (default 5s timeout) — see `testing/basics.md`.

---

## Testing with Spring Boot

Under Spring Boot, Axon builds and starts an `AxonConfiguration` as part of the context lifecycle. The simplest path is the `@AxonSpringBootTest` annotation from the `axon-spring-boot-starter-test` dependency, which registers the recording enhancer, exposes an injectable `AxonTestFixture` bean, and manages its lifecycle (no `@BeforeEach`/`@AfterEach`).

```java
import org.axonframework.extension.springboot.test.AxonSpringBootTest;
import org.axonframework.test.fixture.AxonTestFixture;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;

@AxonSpringBootTest(properties = "axon.axonserver.enabled=false")
class EnrolmentSpringBootTest {

    @Autowired
    private AxonTestFixture fixture;

    @Test
    void enrolsStudent() {
        fixture.given()
               .event(new CourseCreated("course-1", "DDD", 30))
               .when()
               .command(new EnrollStudent("course-1", "student-A"))
               .then()
               .success()
               .events(new StudentEnrolled("course-1", "student-A"));
    }
}
```

The fixture's `Customization` is derived from the Spring environment: Axon Server is disabled unless `axon.axonserver.enabled=true`, so when the property is `false` **or absent** the fixture runs in-memory. Set it to `true` to keep Axon Server wired in (equivalent to `asIntegrationTest()`). Override the behaviour by declaring a `Customization` bean:

> **Caveat with the commercial `io.axoniq.framework:axon-server-connector`.** `axon.axonserver.enabled=false` does **not** stop that connector from constructing the Axon Server event store and connecting — it registers its event store through a `ServiceLoader`-discovered `ServerConnectorConfigurationEnhancer`, which runs regardless of the flag. A `@AxonSpringBootTest(properties = "axon.axonserver.enabled=false")` test will then still try to reach Axon Server. To guarantee an in-memory run, disable the enhancer explicitly (`configurer.componentRegistry(r -> r.disableEnhancer(ServerConnectorConfigurationEnhancer.class))` in a test configurer, or via a `Customization` that does the same), or — simplest — keep the connector off the **test** classpath so the enhancer is never discovered. When neither is practical, test the changed code directly without the full Spring context: a JPA slice test (`@DataJpaTest`) for read-model projections and a plain `AxonTestFixture` test for the command side.

```java
@AxonSpringBootTest
class CustomizedSpringBootTest {

    @TestConfiguration
    static class TestConfig {
        @Bean
        AxonTestFixture.Customization customization() {
            return new AxonTestFixture.Customization().asIntegrationTest();
        }
    }

    @Autowired
    private AxonTestFixture fixture;
    // ...
}
```

### Verifying (mocked) Spring beans

Because `then().expect(config -> ...)` exposes the running `Configuration`, you can resolve any Spring bean — including mocks declared in a `@TestConfiguration` — and verify it was invoked during the When phase:

```java
import static org.mockito.Mockito.*;

@AxonSpringBootTest(properties = "axon.axonserver.enabled=false")
class NotificationSpringBootTest {

    @TestConfiguration
    static class TestConfig {
        @Bean
        NotificationGateway notificationGateway() {
            return mock(NotificationGateway.class);
        }
    }

    @Autowired
    private AxonTestFixture fixture;

    @Test
    void sendsNotificationOnEnrolment() {
        fixture.given()
               .event(new CourseCreated("course-1", "DDD", 30))
               .when()
               .command(new EnrollStudent("course-1", "student-A"))
               .then()
               .success()
               .expect(config -> {
                   var gateway = config.getComponent(NotificationGateway.class);
                   verify(gateway).notifyEnrolled("course-1", "student-A");
               });
    }
}
```

### Manual setup without the annotation

If you can't use `@AxonSpringBootTest`, inject the `AxonConfiguration` and construct the fixture yourself — but you must register the `MessagesRecordingConfigurationEnhancer` as a bean so the fixture can capture dispatched commands and published events:

```java
import org.axonframework.common.configuration.AxonConfiguration;
import org.axonframework.test.fixture.AxonTestFixture;
import org.axonframework.test.fixture.MessagesRecordingConfigurationEnhancer;

@SpringBootTest
class ManualSpringTest {

    @TestConfiguration
    static class TestConfig {
        @Bean
        MessagesRecordingConfigurationEnhancer recordingEnhancer() {
            return new MessagesRecordingConfigurationEnhancer();
        }
    }

    @Autowired
    private AxonConfiguration configuration;
    private AxonTestFixture fixture;

    @BeforeEach
    void setUp() {
        fixture = new AxonTestFixture(configuration, new AxonTestFixture.Customization());
    }

    @AfterEach
    void tearDown() {
        fixture.stop();
    }
}
```

---

## Sharing fixtures across tests with a provider

The `axon-test` JUnit 5 extension (`AxonFrameworkExtension` + `@ProvidedAxonTestFixture`) lets you centralise fixture construction in an `AxonTestFixtureProvider` and inject the resulting `AxonTestFixture` — handy when many slice tests share one configuration and you want consistent Axon-Server-vs-in-memory selection:

```java
import org.axonframework.test.extension.AxonTestFixtureProvider;

public class FacultyFixtures {
    public static class FacultySlice implements AxonTestFixtureProvider {
        @Override
        public AxonTestFixture get() {
            var configurer = FacultyModuleConfiguration.configure(/* ... */);
            return AxonTestFixture.with(configurer);   // add .asIntegrationTest() when targeting real infra
        }
    }
}
```

Then wire the provider into a test class with `@ExtendWith(AxonFrameworkExtension.class)` and `@ProvidedAxonTestFixture(...)`, and declare an `AxonTestFixture` parameter on each test:

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.axonframework.test.extension.AxonFrameworkExtension;
import org.axonframework.test.extension.ProvidedAxonTestFixture;

@ExtendWith(AxonFrameworkExtension.class)
@ProvidedAxonTestFixture(FacultyFixtures.FacultySlice.class)
class EnrollStudentTest {

    @Test
    void enrollsStudent(AxonTestFixture fixture) {   // injected by the extension
        fixture.given().event(new StudentSubscribed("student-1", "course-1"))
               .when().command(new EnrollStudent("student-1", "course-1"))
               .then().success();
    }
}
```

The extension resolves the `AxonTestFixture` parameter from the registered provider and calls `stop()` after each test automatically, so no manual lifecycle handling is needed.

---

## See also

- `testing/basics.md` — Given/When/Then setup, seeding tagged events, event/command assertions, `EventTestUtils`, chaining with `and()`.
- `testing/matchers.md` — Hamcrest matchers and field filters for richer payload comparisons.
- `commands/decision-models-dcb.md` — testing DCB / `@EventSourcedEntity` command handlers.
