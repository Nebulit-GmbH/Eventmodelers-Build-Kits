---
name: build-state-change
authors:
  - Martin Dilger
description: >
  Implement DCB-style write slices against the raw UmaDB Java client in this project's one
  established pattern: Command record → mutable Decision class (a Query + an apply(Event) fold) →
  @Component CommandHandler using DecisionModelLoader → InMemoryUmaDbClient-based unit test (no
  Spring context, no Docker). Use when implementing a new write slice / command handler from a
  slice.json event model in this project. There is exactly one supported style — do not offer
  alternatives.
---

# UmaDB — Write Slice

One pattern only. Directory layout is flat — `src/main/java/.../slices/{context}/{slicename}/`, no
`write`/`read`/`automation` folder layer in between (only the shared `slices/{context}/events/`
folder sits alongside slice folders). Every step below is grounded in the `RegisterCustomer` slice
(single id field, test in `RegisterCustomerCommandHandlerTest`) and, for the compound-identifier
case in Step 1, the `SubscribeToCourse` slice (test in `SubscribeToCourseCommandHandlerTest`) —
both verified, compiled and passing under `mvn test` against
`io.github.domenicdev:umadb-java-client:0.7` and a real `umadb/umadb:0.7.5` server.

UmaDB itself has no annotation-driven modelling layer at all (no `@Command`/`@Event`/`@Aggregate`
the way Axon Framework has) — every convention below (the Decision class shape, the tag-string
format, the `DecisionModelLoader` read-decide-append loop) is this project's own, hand-rolled once
in the shared `eventstore` package and reused by every slice, not something UmaDB enforces itself.

## Step 0: Read the slice definition

Read `.build-kit/.slices/{context}/{slicename}/slice.json`. Extract, and use **only** what's there:

- `commands[].fields[]` → Command record fields, in order
- `events[].fields[]` → Event record fields, in order
- `specifications[]` (GWT scenarios) → one test method per scenario
- Which command field(s) have `idAttribute: true` — these become the tag(s) the command's Query and
  the resulting event are both scoped to (see Step 1/Step 3)
- `storylines[]` (optional, may be absent) → narrated walkthroughs with ordered `elements[]`
  "beats"; see Step 7b for how a COMMAND beat in one of these can add a supplementary test

Never invent a field, business rule, or event that isn't in slice.json.

## Step 0a: Determine `{basePackage}`

Every code example below is rooted at `{basePackage}.slices.{context}.{slicename}`. Resolve
`{basePackage}` as documented in `.build-kit/CLAUDE.md` — never hardcode `io.umadb.quickstart` (the
shipped quickstart scaffold's package) or any other specific package.

## Step 1: Command

**Exactly one field has `idAttribute: true`** — no annotation needed (UmaDB has nothing like
`@TargetEntityId`); the field is just referenced directly wherever the id is needed:

```java
package {basePackage}.slices.{context}.{slicename};

public record {SliceName}Command(String field1, String idField) {}
```

**Two or more fields have `idAttribute: true`** — combine them into a compound id record, with a
convenience method building it from the command. Verified against `SubscribeToCourseCommand`
(`email` + `courseId` both `idAttribute: true`):

```java
package {basePackage}.slices.{context}.{slicename};

public record {SliceName}Id(String field1, String field2) {}
```

```java
package {basePackage}.slices.{context}.{slicename};

public record {SliceName}Command(String field1, String field2) {

    public {SliceName}Id identifier() {
        return new {SliceName}Id(field1, field2);
    }
}
```

The Decision's `relevantEvents(...)` (Step 3) and the CommandHandler (Step 4) both take this
`{SliceName}Id` wherever a single id string would otherwise appear.

## Step 2: Event — only if it doesn't already exist

Check `src/main/java/.../{context}/events/` first; add to the existing sealed interface rather than
creating a duplicate.

```java
package {basePackage}.slices.{context}.events;

public record {EventName}(String field1, String idField) implements {Context}Event {

    public static final String TYPE = "{Context}.{EventName}";
}
```

`TYPE` is this project's own convention for what goes into UmaDB's `Event.type()` — UmaDB has no
`@Event(namespace, name, version)` annotation of its own. Add the tag constant to the context's
`EventTags` class if it isn't already there:

```java
public static final String {TAG_CONSTANT} = "idField";
```

## Step 3: Decision class

Package-private, mutable field(s) per fact a `specifications[]` scenario actually branches on —
**not** an immutable state record with free-standing decide/evolve functions.

**Derive the field(s) from this slice's `specifications[]` (Step 0), not from the event's shape.**
Each GWT scenario's `given`/`then` pair states the one decision the command handler must make and
the prior fact that decision depends on — that fact is the field. A "given no prior activity" /
"given already {X}" pair means one boolean flag for {X}; a scenario that discriminates on a value
(not just presence/absence) means a value field holding that value, not a boolean.

```java
package {basePackage}.slices.{context}.{slicename};

import io.umadb.client.Event;
import io.umadb.client.Query;
import io.umadb.client.QueryItem;
import {basePackage}.slices.{context}.events.{EventName};
import {basePackage}.slices.{context}.events.EventTags;

import java.util.List;

class {SliceName}Decision {

    boolean <ruleFlag>;

    static Query relevantEvents(String idField) {
        return Query.of(QueryItem.of(
                List.of({EventName}.TYPE),
                List.of(EventTags.tag(EventTags.{TAG_CONSTANT}, idField))
        ));
    }

    void apply(Event event) {
        if (event.type().equals({EventName}.TYPE)) {
            this.<ruleFlag> = true;
        }
    }
}
```

`apply` takes the raw `io.umadb.client.Event`, not a decoded domain object — most decisions only
need to know a matching event of a given `type()` existed (a boolean flag). Only decode the payload
(`EventCodec.fromEvent(event, {EventName}.class)`) when a scenario needs an actual field value, not
just presence/absence.

**Tag each event type by what THIS decision actually needs checked for it — not uniformly.** When
multiple event types feed one decision (a `Query` with several `QueryItem`s, OR'd together), each
item gets its own tag set, chosen per the specific invariant that event type is being loaded to
verify — this is context-dependent, not a fixed property of the event type itself. Verified worked
example — `SubscribeToCourseDecision`, id is `SubscriptionId(email, courseId)`, two rules, two
different tag scopes on two different event types:

```java
static Query relevantEvents(SubscriptionId id) {
    return Query.of(List.of(
        // "is this customer registered at all" — scoped to email only
        QueryItem.of(List.of(CustomerRegistered.TYPE), List.of(EventTags.tag(EventTags.EMAIL, id.email()))),
        // "did this customer already subscribe to THIS course" — scoped to email + courseId
        QueryItem.of(List.of(SubscribedToCourse.TYPE), List.of(
                EventTags.tag(EventTags.EMAIL, id.email()),
                EventTags.tag(EventTags.COURSE_ID, id.courseId())))
    ));
}
```

`CustomerRegistered` only needs the `email` tag — "is this customer registered" doesn't involve a
course. `SubscribedToCourse` needs **both** `email` and `courseId` together — the rule is "already
subscribed to *this* course", not "subscribed to any course". Getting the tag scope wrong doesn't
fail loudly: too wide silently pulls in unrelated events, too narrow silently drops events the rule
needed. See [references/umadb-query-patterns.md](references/umadb-query-patterns.md) for the full
`Query`/`QueryItem` matching rules this relies on.

## Step 4: Command handler

Uses the shared `DecisionModelLoader` (in `{basePackage}.eventstore`) — never call
`UmaDbClient.handle(ReadRequest...)`/`.handle(AppendRequest...)` directly from a command handler;
the loader is this project's one shared read-decide-append loop (see its Javadoc for why).

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.eventstore.DecisionModelLoader;
import {basePackage}.slices.{context}.events.{EventName};
import {basePackage}.slices.{context}.events.EventTags;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}CommandHandler {

    private final DecisionModelLoader loader;

    public {SliceName}CommandHandler(DecisionModelLoader loader) {
        this.loader = loader;
    }

    public void handle({SliceName}Command command) {
        var query = {SliceName}Decision.relevantEvents(command.idField());
        var loaded = loader.load(query, {SliceName}Decision::new, {SliceName}Decision::apply);

        if (loaded.decision().<ruleFlag>) {
            throw new IllegalStateException("...");
        }

        loader.append(
                new {EventName}(command.field1(), command.idField()),
                {EventName}.TYPE,
                List.of(EventTags.tag(EventTags.{TAG_CONSTANT}, command.idField())),
                query,
                loaded.lastPosition()
        );
    }
}
```

`loader.append` throws `OptimisticConcurrencyException` (from `{basePackage}.eventstore`) if a
conflicting event was appended concurrently between this handler's `load` and `append` calls — this
IS the consistency boundary, not just a convenience; see
[references/umadb-query-patterns.md](references/umadb-query-patterns.md).

## Step 5: REST endpoint — only if slice.json shows an inbound `SCREEN` dependency on the command

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.eventstore.OptimisticConcurrencyException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}RestController {

    private final {SliceName}CommandHandler commandHandler;

    public {SliceName}RestController({SliceName}CommandHandler commandHandler) {
        this.commandHandler = commandHandler;
    }

    @PostMapping("/api/{context}/{resource}")
    public ResponseEntity<Void> handle(@RequestBody {SliceName}RequestBody body) {
        try {
            commandHandler.handle(new {SliceName}Command(body.field1(), body.idField()));
            return ResponseEntity.ok().build();
        } catch (IllegalStateException | OptimisticConcurrencyException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    public record {SliceName}RequestBody(String field1, String idField) {}
}
```

If the only inbound dependency is another slice's `AUTOMATION`, skip this step — an automation
calls the command handler directly (see `build-automation`), it doesn't need HTTP.

This project uses plain Spring MVC (`spring-boot-starter-web`), **not** WebFlux — `UmaDbClient`'s
core API is blocking (returns `Iterator`, not a reactive `Publisher`), so a reactive controller
would only hide the blocking calls behind a `Mono`, not remove them. Plain `ResponseEntity<...>`,
not `Mono<ResponseEntity<...>>`.

## Step 6: Feature flag

Every slice component (command handler, REST controller) gets `@ConditionalOnProperty(prefix =
"slices.{context}.write", name = "{slicename}.enabled")` — the Decision class does not need it.
Wire the flag in both places:

- `src/main/resources/application.properties` — `slices.{context}.write.{slicename}.enabled=true`
- `src/test/resources/application.properties` — `slices.{context}.write.{slicename}.enabled=false`

See [references/feature-flag-patterns.md](references/feature-flag-patterns.md) for the full
pattern. This flag is irrelevant to the Step 7 test below — that test never boots Spring, so
`@ConditionalOnProperty` never runs.

## Step 7: Test — `InMemoryUmaDbClient`, no Spring context, no Docker

UmaDB ships no test-fixture library (unlike Axon Framework's `axon-test`) — this project's
`InMemoryUmaDbClient` (`src/test/java/.../testsupport/`, already in the root scaffold) is a
from-scratch fake `UmaDbClient` implementation for exactly this. Write given/when/then as plain
JUnit + AssertJ, one test method per GWT scenario in slice.json's `specifications[]`:

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.eventstore.DecisionModelLoader;
import {basePackage}.testsupport.InMemoryUmaDbClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class {SliceName}CommandHandlerTest {

    private {SliceName}CommandHandler commandHandler;

    @BeforeEach
    void setUp() {
        var loader = new DecisionModelLoader(new InMemoryUmaDbClient());
        commandHandler = new {SliceName}CommandHandler(loader);
    }

    @Test
    @DisplayName("given no prior activity, when {sliceName}, then succeeds")
    void happyPath() {
        assertThatNoException().isThrownBy(
                () -> commandHandler.handle(new {SliceName}Command("value1", "id-1")));
    }

    @Test
    @DisplayName("given <rule already true>, when {sliceName}, then rejected")
    void ruleViolation() {
        commandHandler.handle(new {SliceName}Command("value1", "id-1"));

        assertThatThrownBy(() -> commandHandler.handle(new {SliceName}Command("value2", "id-1")))
                .isInstanceOf(IllegalStateException.class);
    }
}
```

When a slice's decision needs prior events from ANOTHER slice's command handler first (like
`SubscribeToCourse` needing a `RegisterCustomer` to have happened), construct both command handlers
from the SAME `DecisionModelLoader`/`InMemoryUmaDbClient` instance and call the prerequisite handler
directly in the test — see `SubscribeToCourseCommandHandlerTest`. Don't hand-craft raw `Event`
objects as a shortcut; go through the real command handler so the test also exercises that
handler's own tagging.

Full cheat sheet — `Query`/`QueryItem` matching, `AppendCondition` semantics, idempotent-append
behaviour, why `subscribe()` isn't faked: see
[references/umadb-query-patterns.md](references/umadb-query-patterns.md).

## Step 7b: Storyline-Derived Tests (Optional)

`slice.json` may carry a `storylines[]` array alongside `specifications[]` — narrated walkthroughs
where an ordered sequence of `elements[]` "beats" (EVENT/COMMAND/READMODEL/...) shows one use case
end to end. This is a secondary, supplementary source — `specifications[]` (Step 7) stays the
primary and default source of test methods. Most slices have no `storylines[]`; skip this step
silently when there's nothing relevant.

Find beats whose `type` is `COMMAND`. For each such beat: `given` = the cumulative ordered `EVENT`
beats preceding it in the storyline (dispatched through their own real command handlers, per Step
7's guidance), `when` = the command built from the beat's `fields`, `then` = the `EVENT` beat(s)
immediately following it — asserted by reading the event back via a second `client.handle(ReadRequest...)`
call, or more simply by asserting the command handler didn't throw and trusting Step 7's own
per-field tests to have already covered the event's shape.

Do **not** try to also assert read-model state in this same test — that half belongs to
`build-state-view`'s own storyline step, since this test never touches a projector. If the beat
immediately after the command isn't an EVENT, don't force a test — leave it undocumented rather than
fabricating an assertion.

## Final Verification

Before considering the slice done:

- [ ] Every field in slice.json's `commands[]` is in the Command record — no invented fields, none missing
- [ ] Every field in slice.json's `events[]` is in the Event record — no invented fields, none missing
- [ ] Every `specifications[]` scenario has a corresponding test method
- [ ] If `storylines[]` is present: every COMMAND beat for this slice's command has a storyline test — or was deliberately skipped as untraceable
- [ ] No business rule exists in the handler that isn't traceable to slice.json's `description`/`comments`
- [ ] The Decision's `relevantEvents` query and the append's consistency-boundary query are the SAME query
- [ ] `mvn compile -q`, then run the slice's own tests only
- [ ] If checks pass, commit with `feat: {Slice Name}` and set slice status to `Done`
