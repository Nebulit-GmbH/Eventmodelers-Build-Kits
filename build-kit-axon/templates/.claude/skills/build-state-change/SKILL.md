---
name: build-state-change
authors:
  - Mateusz Nowak
  - Martin Dilger
description: >
  Implement Event Sourcing write slices using Axon Framework 5.1.1 in this project's one established
  pattern: Command record → mutable decision-model entity (@EventSourced + @EventCriteriaBuilder) →
  @Component CommandHandler that checks entity state inline → AxonTestFixture unit test (no Spring
  context). Use when implementing a new write slice / command handler from a slice.json event model in
  this project. There is exactly one supported style — do not offer alternatives.
---

# Axon Framework 5 — Write Slice

One pattern only. Directory layout is flat — `src/main/java/.../slices/{context}/{slicename}/`, no
`write`/`read`/`automation` folder layer in between (only the shared `slices/{context}/events/` folder
sits alongside slice folders). Every step below is grounded in the `RegisterCustomer` slice
(`src/main/java/.../foo/register/`, test in
`src/test/java/.../foo/register/RegisterCustomerDecisionModelTest.java`) and, for the compound-identifier
case in Step 1, the `SubscribeToCourse` slice (`src/main/java/.../foo/subscribetocourse/`) — both
verified, compiled and passing under `mvn test` against `io.axoniq.framework:axoniq-framework-bom:5.1.1`.

## Step 0: Read the slice definition

Read `.build-kit-axon/.slices/{context}/{slicename}/slice.json`. Extract, and use **only** what's there:

- `commands[].fields[]` → Command record fields, in order
- `events[].fields[]` → Event record fields, in order
- `specifications[]` (GWT scenarios) → one test method per scenario
- Which command field(s) have `idAttribute: true` — these carry `@TargetEntityId` (see Step 1) and the
  matching event field(s) carry `@EventTag`

Never invent a field, business rule, or event that isn't in slice.json.

## Step 1: Command

**Exactly one field has `idAttribute: true` in slice.json** — annotate it directly:

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import org.axonframework.messaging.commandhandling.annotation.Command;
import org.axonframework.modelling.annotation.TargetEntityId;

@Command(namespace = "{Context}", name = "{SliceName}", version = "1.0.0")
public record {SliceName}Command(
    String field1,
    @TargetEntityId
    String idField
) {}
```

**Two or more fields have `idAttribute: true`** — Axon only allows the resolved identifier to collapse
to exactly one distinct non-null value (`AnnotationBasedEntityIdResolver`, package
`org.axonframework.modelling.annotation`); annotating two fields with different values throws
`EntityIdResolutionException` at command-dispatch time, not at compile time. **Never annotate more than
one field directly.** Instead build a compound id record and put `@TargetEntityId` on a derived method —
verified against the `SubscribeToCourse` slice (`email` + `courseId` both `idAttribute: true`):

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

public record {SliceName}Id(String field1, String field2) {}
```

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import org.axonframework.messaging.commandhandling.annotation.Command;
import org.axonframework.modelling.annotation.TargetEntityId;

@Command(namespace = "{Context}", name = "{SliceName}", version = "1.0.0")
public record {SliceName}Command(String field1, String field2) {

    @TargetEntityId
    public {SliceName}Id identifier() {
        return new {SliceName}Id(field1, field2);
    }
}
```

The entity's generic id type becomes `{SliceName}Id` everywhere it's referenced (Step 3's
`@EventCriteriaBuilder` first parameter, Step 7's `EventSourcedEntityModule.autodetected({SliceName}Id.class, ...)`)
instead of `String`. `@TargetEntityId` scans both fields and methods on the payload
(`AnnotationBasedEntityIdResolver.findMembers`), so a method works exactly like a field for this purpose.

## Step 2: Event — only if it doesn't already exist

Check `src/main/java/.../{context}/events/` first; add to the existing sealed/marker interface rather
than creating a duplicate.

```java
package io.axoniq.quickstart.slices.{context}.events;

import org.axonframework.eventsourcing.annotation.EventTag;
import org.axonframework.messaging.eventhandling.annotation.Event;

@Event(namespace = "{Context}", name = "{EventName}", version = "1.0.0")
public record {EventName}(
    String field1,
    @EventTag(key = EventTags.{TAG_CONSTANT})
    String idField
) implements {Context}Event {}
```

Add the tag constant to the context's `EventTags` class if it isn't already there:

```java
public static final String {TAG_CONSTANT} = "idField";
```

## Step 3: Decision-model entity

Package-private, mutable field(s) — **not** an immutable `State` record with free-standing
`decide()`/`evolve()` static methods. One boolean/value field per fact the command handler's rule
check needs, nothing else.

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import io.axoniq.quickstart.slices.{context}.events.{EventName};
import io.axoniq.quickstart.slices.{context}.events.EventTags;
import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder;
import org.axonframework.eventsourcing.annotation.EventSourcingHandler;
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;
import org.axonframework.extension.spring.stereotype.EventSourced;
import org.axonframework.messaging.core.MessageTypeResolver;
import org.axonframework.messaging.eventstreaming.EventCriteria;
import org.axonframework.messaging.eventstreaming.Tag;

@EventSourced
class {SliceName}DecisionModel {

    public boolean <ruleFlag>;

    @EntityCreator
    private {SliceName}DecisionModel() {
    }

    @EventCriteriaBuilder
    private static EventCriteria resolveCriteria(String idField, MessageTypeResolver messageTypeResolver) {
        return EventCriteria.havingTags(Tag.of(EventTags.{TAG_CONSTANT}, idField))
                             .andBeingOneOfTypes(messageTypeResolver, {EventName}.class);
    }

    @EventSourcingHandler
    public void on({EventName} event) {
        this.<ruleFlag> = true;
    }
}
```

**Always write `@EventCriteriaBuilder`. Never rely on bare `@EventSourced(tagKey = "...")`.** A tag-key
mismatch produces no compiler error and no runtime exception — the entity just silently never loads any
prior events, so it always looks "fresh" and the business rule never fires. `@EventCriteriaBuilder`'s
first parameter is always the `@TargetEntityId` type; a second `MessageTypeResolver` parameter is
resolved automatically from `Configuration` — pass it plus the event class straight into
`andBeingOneOfTypes(messageTypeResolver, {EventName}.class)`.

**The `MessageTypeResolver` parameter is not optional — don't drop it to save an injection.** It was
tempting to think `andBeingOneOfTypes(new QualifiedName({EventName}.class))` should work without it,
since `QualifiedName` has a `Class<?>` constructor. Verified experimentally that it does NOT:
`QualifiedName(Class<?>)`'s only job is `clazz.getName()` — the raw Java class name
(`io.axoniq.quickstart.slices.foo.events.CustomerRegistered`) — not the `@Event(namespace, name)` value
the event was actually appended under (`Foo.CustomerRegistered`). Swapping to it in
`SubscribeToCourseDecisionModel` as a test made 2 of 3 passing tests fail immediately, silently, with
no exception pointing at the real cause — the criteria just stopped matching anything, identical in
effect to a `tagKey` mismatch. `MessageTypeResolver` is what correctly bridges the `@Event` annotation
to the type Axon actually matches on; there is no annotation-free shortcut. Never hand-type a
`"Namespace.Name"` string either, and never pass `{EventName}.class.getName()` — both drift silently
out of sync with the event's `@Event` annotation with no compiler check.

`EventCriteria`/`Tag` live in `org.axonframework.messaging.eventstreaming` in 5.1.1 — not
`org.axonframework.eventsourcing.eventstore` (that package has no such classes in this version).

**If Step 1 used a compound `{SliceName}Id`** (two or more `idAttribute: true` fields), the first
parameter here is `{SliceName}Id id` instead of `String idField` — pull the individual values back out
with `id.field1()`/`id.field2()` for tagging.

**Tag each event type by what THIS decision actually needs checked for it — not uniformly.** When
multiple event types feed one entity (via `EventCriteria.either(...)`), each branch gets its own tag
set, chosen per the specific invariant that event type is being loaded to verify. This is context-
dependent: the same event type can legitimately need a wider or narrower tag set in a different slice
that reads it for a different rule. Verified worked example — `SubscribeToCourseDecisionModel`, id is
`SubscriptionId(email, courseId)`, two rules, two different tag scopes on two different event types:

```java
@EventCriteriaBuilder
private static EventCriteria resolveCriteria(SubscriptionId id, MessageTypeResolver messageTypeResolver) {
    return EventCriteria.either(
        // "is this customer registered at all" — scoped to email only
        EventCriteria.havingTags(Tag.of(EventTags.EMAIL, id.email()))
                     .andBeingOneOfTypes(messageTypeResolver, CustomerRegistered.class),
        // "did this customer already subscribe to THIS course" — scoped to email + courseId
        EventCriteria.havingTags(Tag.of(EventTags.EMAIL, id.email()), Tag.of(EventTags.COURSE_ID, id.courseId()))
                     .andBeingOneOfTypes(messageTypeResolver, SubscribedToCourse.class)
    );
}
```

`CustomerRegistered` only needs the `email` tag — "is this customer registered" doesn't involve a
course. `SubscribedToCourse` needs **both** `email` and `courseId` tags together — the rule is "already
subscribed to *this* course", not "subscribed to any course", so loading a customer's subscription to a
*different* course must not satisfy it. This also directly simplifies the entity: narrowing the second
branch to `email` + `courseId` means the entity only ever sees `SubscribedToCourse` events for this
exact course, so a `Set<String> subscribedCourseIds` collecting every course is unnecessary — a single
`boolean alreadySubscribedToThisCourse` set by `@EventSourcingHandler` is enough. Getting the tag scope
wrong doesn't fail loudly: too-wide a scope silently pulls in unrelated events (correct here only by
coincidence, e.g. it still worked when courses were checked in Java after the fact) or double-counts;
too-narrow a scope silently drops events the rule actually needed.

A read-side use case for the *same* `SubscribedToCourse` event (e.g. "how many courses is this customer
subscribed to") would legitimately query it with `email` only, no `courseId` — the correct tag scope is
a property of the specific decision/query consuming the event, not a fixed property of the event type
itself.

## Step 4: Command handler

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import io.axoniq.quickstart.slices.{context}.events.{EventName};
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.core.Metadata;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;
import org.axonframework.modelling.annotation.InjectEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}CommandHandler {

    @CommandHandler
    public void handle(
        {SliceName}Command command,
        Metadata metadata,
        @InjectEntity {SliceName}DecisionModel entity,
        EventAppender eventAppender
    ) {
        if (entity.<ruleFlag>) {
            throw new IllegalStateException("...");
        }
        eventAppender.append(new {EventName}(command.field1(), command.idField()));
    }
}
```

`Metadata` is `org.axonframework.messaging.core.Metadata` — **not** `AxonMetadata`, which does not
exist as a type in this version.

## Step 5: REST endpoint — only if slice.json shows an inbound `SCREEN` dependency on the command

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

@RestController
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}RestController {

    private final CommandGateway commandGateway;

    public {SliceName}RestController(CommandGateway commandGateway) {
        this.commandGateway = commandGateway;
    }

    @PostMapping("/api/{context}/{resource}")
    public Mono<ResponseEntity<Void>> handle(@RequestBody {SliceName}RequestBody body) {
        var command = new {SliceName}Command(body.field1(), body.idField());
        return Mono.fromFuture(commandGateway.send(command).getResultMessage())
            .map(ignored -> ResponseEntity.ok().<Void>build())
            .onErrorResume(e -> Mono.just(ResponseEntity.badRequest().<Void>build()));
    }

    public record {SliceName}RequestBody(String field1, String idField) {}
}
```

If the only inbound dependency is another slice's `AUTOMATION`, skip this step — it calls the
`CommandGateway` in-process, it doesn't need HTTP.

This project uses WebFlux (`Mono<ResponseEntity<...>>`, not plain `ResponseEntity`) — see
[references/rest-api-patterns.md](references/rest-api-patterns.md) for the full annotated breakdown and
a `WebTestClient`-based test shape (this repo has no REST test yet — that file's test is the
recommended pattern for the first one, not a verified-passing example like the other references).

## Step 6: Feature flag

Every slice component (handler, REST controller) gets `@ConditionalOnProperty(prefix =
"slices.{context}.write", name = "{slicename}.enabled")` — the entity does not need it. Wire the flag
in all three places:

- `src/main/resources/application.properties` — `slices.{context}.write.{slicename}.enabled=true`
- `src/test/resources/application.properties` — `slices.{context}.write.{slicename}.enabled=false`
- `META-INF/additional-spring-configuration-metadata.json` — add a `{"name": "...", "type":
  "java.lang.Boolean", "description": "..."}` entry

This flag is irrelevant to the Step 7 test below — that test never boots Spring, so
`@ConditionalOnProperty` never runs.

## Step 7: Test — `AxonTestFixture`, no Spring context

One-time `pom.xml` addition (no version needed — resolved via the project's existing
`axoniq-framework-bom` → `axon-framework-bom` import):

```xml
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-test</artifactId>
    <scope>test</scope>
</dependency>
```

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import io.axoniq.quickstart.slices.{context}.events.{EventName};
import org.axonframework.eventsourcing.configuration.EventSourcedEntityModule;
import org.axonframework.eventsourcing.configuration.EventSourcingConfigurer;
import org.axonframework.messaging.commandhandling.configuration.CommandHandlingModule;
import org.axonframework.test.fixture.AxonTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class {SliceName}DecisionModelTest {

    private AxonTestFixture fixture;

    @BeforeEach
    void setUp() {
        var entityModule = EventSourcedEntityModule
            .autodetected(String.class, {SliceName}DecisionModel.class);
        var commandHandlerModule = CommandHandlingModule.named("{SliceName}")
            .commandHandlers()
            .autodetectedCommandHandlingComponent(c -> new {SliceName}CommandHandler());
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
    @DisplayName("given no prior activity, when {sliceName}, then {eventName} emitted")
    void happyPath() {
        fixture.given().noPriorActivity()
               .when().command(new {SliceName}Command("value1", "id-1"))
               .then().success()
               .events(new {EventName}("value1", "id-1"));
    }

    @Test
    @DisplayName("given <rule already true>, when {sliceName}, then rejected")
    void ruleViolation() {
        fixture.given().event(new {EventName}("value1", "id-1"))
               .when().command(new {SliceName}Command("value2", "id-1"))
               .then().exception(IllegalStateException.class, "...");
    }
}
```

One test method per GWT scenario in slice.json's `specifications[]`. This works because
`EventSourcedEntityModule.autodetected(...)` and `...autodetectedCommandHandlingComponent(...)` operate
directly on the `@EventSourced`/`@Component` classes via reflection — the same classes Spring
auto-discovers in production also work standalone, with zero `ApplicationContext`, zero
`@SpringBootTest`.

Fluent API cheat sheet and known gotchas (wrong `EventCriteria`/`Tag` package, a builder method that
was renamed between AF5 patch versions, `Customization.disableAxonServer()` not existing in 5.1.1):
see [references/axon-test-fixture-patterns.md](references/axon-test-fixture-patterns.md).

## Final Verification

Before considering the slice done:

- [ ] Every field in slice.json's `commands[]` is in the Command record — no invented fields, none missing
- [ ] Every field in slice.json's `events[]` is in the Event record — no invented fields, none missing
- [ ] Every `specifications[]` scenario has a corresponding test method
- [ ] No business rule exists in the handler that isn't traceable to slice.json's `description`/`comments`
- [ ] `mvn compile -q`, then run the slice's own tests only
- [ ] If checks pass, commit with `feat: {Slice Name}` and set slice status to `Done`