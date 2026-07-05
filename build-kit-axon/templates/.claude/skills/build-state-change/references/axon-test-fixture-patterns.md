# AxonTestFixture Patterns (Verified against Axon Framework 5.1.1)

Everything on this page was compiled and run with `mvn test` against
`io.axoniq.framework:axoniq-framework-bom:5.1.1` (which pulls in
`org.axonframework:axon-framework-bom:5.1.1`). It supersedes any conflicting claim elsewhere in this
skill about `@SpringBootTest` / `AxonTestFixture.configSlice(...)` — that method does not exist in
5.1.1. Ground-truth worked example: `RegisterCustomer` slice in this repo
s(`src/main/java/.../foo/register/`, test in `src/test/java/.../foo/register/RegisterCustomerDecisionModelTest.java`).
Slice folders sit directly under their context — `slices/{context}/{slicename}/`, no `write`/`read`/
`automation` layer in between.

## 0. Add the dependency

`axon-test` is **not** pulled in by `axoniq-spring-boot-starter`. Add it explicitly (no version needed —
it's managed by the `axoniq-framework-bom` → `axon-framework-bom` import already in the project's `pom.xml`):

```xml
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-test</artifactId>
    <scope>test</scope>
</dependency>
```

## 0b. `@EventSourced` (Spring stereotype) works directly with `EventSourcedEntityModule.autodetected(...)`

`org.axonframework.extension.spring.stereotype.EventSourced` is not a plain marker — it aliases its
attributes onto `org.axonframework.eventsourcing.annotation.EventSourcedEntity` via Spring's
`@AliasFor` mechanism. `AnnotationBasedEventCriteriaResolver`/`EventSourcedEntityModule.autodetected(...)`
resolve that alias correctly at runtime even with zero Spring context — verified empirically:
`EventSourcedEntityModule.autodetected(String.class, RegisterCustomerDecisionModel.class)` succeeded
against an entity annotated only with the bare `@EventSourced` (no explicit `@EventSourcedEntity`).
You do **not** need to dual-annotate or swap to `@EventSourcedEntity` just to make the entity
fixture-testable.

## 1. Key finding: you do NOT need a Spring context to test the entity/handler pair

Production code stays `@EventSourced` (Spring stereotype) entity + `@Component` handler, auto-discovered
by `SpringEventSourcedEntityLookup` at runtime. The test does **not** have to boot Spring —
`EventSourcedEntityModule.autodetected(...)` and `CommandHandlingModule...autodetectedCommandHandlingComponent(...)`
work directly off the annotated classes via reflection, regardless of them also being
`@Component`/`@EventSourced`-Spring-stereotyped for production wiring. This is dramatically faster than
`@SpringBootTest` (no `ApplicationContext` startup) and needs zero Spring test slices.

```java
class RegisterCustomerDecisionModelTest {

    private AxonTestFixture fixture;

    @BeforeEach
    void setUp() {
        var entityModule = EventSourcedEntityModule
            .autodetected(String.class, RegisterCustomerDecisionModel.class);
        var commandHandlerModule = CommandHandlingModule.named("Register")
            .commandHandlers()
            .autodetectedCommandHandlingComponent(c -> new RegisterCustomerCommandHandler());
        var configurer = EventSourcingConfigurer.create()
            .registerEntity(entityModule)
            .registerCommandHandlingModule(commandHandlerModule);
        fixture = AxonTestFixture.with(configurer);
    }

    @AfterEach
    void tearDown() {
        fixture.stop();
    }

    @Test
    @DisplayName("given no prior registration, when register customer, then customer registered emitted")
    void happyPath() {
        fixture.given().noPriorActivity()
               .when().command(new RegisterCustomerCommand("Martin", "test@test.de"))
               .then().success()
               .events(new CustomerRegistered("Martin", "test@test.de"));
    }

    @Test
    @DisplayName("given customer registered, when register customer with same email, then already registered")
    void alreadyRegistered() {
        fixture.given().event(new CustomerRegistered("Martin", "test@test.de"))
               .when().command(new RegisterCustomerCommand("Max", "test@test.de"))
               .then().exception(IllegalStateException.class, "Email already registered");
    }
}
```

**Method name note**: in 5.0.1 the fluent builder method was `annotatedCommandHandlingComponent`; it was
**renamed** to `autodetectedCommandHandlingComponent` in 5.1.x. Use `javap` against the project's actual
resolved jar before trusting either name in a new project — don't assume the older name still compiles.

`AxonTestFixture.Customization::disableAxonServer` (seen in older AF4-adjacent examples) does **not**
exist as a method in 5.1.1's `AxonTestFixture.Customization` record — the plain `AxonTestFixture.with(configurer)`
overload (no customization argument) already runs fully in-memory with no Axon Server connection. Only
reach for the `UnaryOperator<Customization>` overload (`.asIntegrationTest()`, `.registerFieldFilter(...)`,
`.registerIgnoredField(...)`) when you actually need one of those specific behaviors.

## 2. Fluent API cheat sheet

```java
fixture.given().noPriorActivity()                 // no prior events
fixture.given().event(someEvent)                  // one prior event
fixture.given().events(e1, e2, ...)                // several prior events

fixture.when().command(someCommand)
fixture.when().event(someEvent)                    // dispatch via when() also supported

.then().success()                                   // command handler returned normally
.then().events(expectedEvent1, expectedEvent2)       // exact events emitted (equality via all-fields match)
.then().exception(IllegalStateException.class)                       // exception type only
.then().exception(IllegalStateException.class, "Email already registered") // type + exact message
.then().noEvents()                                   // handler ran, nothing emitted
```

`given()`/`when()`/`then()` all live on `AxonTestFixture` (`fixture.given()`, `fixture.when()`), chained
onto the previous phase's return value (`.given()....when()....then()...`), not called repeatedly on
`fixture` mid-chain.

## 3. `@EventCriteriaBuilder` over bare `tagKey`

**Do not** rely on `@EventSourced(tagKey = "...")` (or the plain `@EventSourcedEntity(tagKey = "...")`)
for anything beyond the most trivial single-tag case — it silently produces an entity that never loads
any prior events if the tag key doesn't happen to match by coincidence, and there is no compiler or
runtime error to catch the mismatch; you only notice when a "should already exist" test unexpectedly
passes as if the entity were fresh. Prefer an explicit `@EventCriteriaBuilder` static method:

```java
@EventCriteriaBuilder
private static EventCriteria resolveCriteria(String email, MessageTypeResolver messageTypeResolver) {
    return EventCriteria.havingTags(Tag.of(EventTags.EMAIL, email))
                         .andBeingOneOfTypes(messageTypeResolver, CustomerRegistered.class);
}
```

Rules (verified from `AnnotationBasedEventCriteriaResolver`, package `org.axonframework.eventsourcing.annotation`):
- Must be `static`, must return `EventCriteria` (package `org.axonframework.messaging.eventstreaming`, **not**
  `org.axonframework.eventsourcing.eventstore` — that package does not contain `EventCriteria`/`Tag` in 5.1.1).
- First parameter is always the entity's `@InjectEntity`/`@TargetEntityId` identifier type (here `String`).
- Any additional parameters are resolved as components from the `Configuration` — `MessageTypeResolver` is
  a valid injectable component and is the type-safe way to restrict the criteria to specific event classes:
  `andBeingOneOfTypes(MessageTypeResolver, Class<?>...)`. This avoids hand-typing `"Namespace.Name"` strings
  that can silently drift out of sync with the `@Event(namespace=..., name=...)` annotation on the event
  record — prefer it over the string-literal `andBeingOneOfTypes(String...)` overload wherever a
  `MessageTypeResolver` is easily injectable (which it always is, inside an `@EventCriteriaBuilder` method).
- Only one `@EventCriteriaBuilder` method may exist per distinct identifier parameter type on a given entity.

## 4. Minimal working `pom.xml` diff

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
<dependency>                                 <!-- add this -->
    <groupId>org.axonframework</groupId>
    <artifactId>axon-test</artifactId>
    <scope>test</scope>
</dependency>
```

No other pom changes are required — version resolution comes from the BOM already imported for the
main `org.axonframework`/`io.axoniq.framework` dependencies.
