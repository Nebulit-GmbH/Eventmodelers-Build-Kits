---
name: build-state-change
authors:
  - Martin Dilger
description: >
  Implement Event Sourcing write slices using OpenCQRS 2.0.0 (Spring Boot, EventSourcingDB) in this
  project's one established pattern: Command record → immutable write-model record → @CommandHandling
  method (in a @CommandHandlerConfiguration class) that checks state inline → CommandHandlingTestFixture
  unit test (no Spring context, no event store). Use when implementing a new write slice / command
  handler from a slice.json event model in this project. Plain Java only. There is exactly one
  supported style — do not offer alternatives.
---

# OpenCQRS — Write Slice (Java)

Directory layout is flat — `src/main/java/.../slices/{context}/{slicename}/`, no `write`/`read`/
`automation` folder layer in between (only the shared `slices/{context}/api/` folder, holding Command
and Event records shared by every slice in that context, sits alongside slice folders).

## Step 0: Read the slice definition

Read `.build-kit/.slices/{context}/{slicename}/slice.json`. Extract, and use **only** what's there:

- `commands[].fields[]` → Command record fields, in order
- `events[].fields[]` → Event record fields, in order
- `specifications[]` (GWT scenarios) → one test method per scenario
- Which command field(s) have `idAttribute: true` — these compose the command's `getSubject()` (see
  Step 1)
- `storylines[]` (optional, may be absent) → narrated walkthroughs with ordered `elements[]` "beats";
  see Step 7b for how a COMMAND beat in one of these can add a supplementary test

Never invent a field, business rule, or event that isn't in slice.json.

## Step 0a: Determine `{basePackage}`

Every code example below is rooted at `{basePackage}.slices.{context}.{slicename}`. Resolve
`{basePackage}` as documented in `.build-kit/CLAUDE.md`'s Structure section — never hardcode
`com.example.quickstart` (the shipped quickstart scaffold's package) or any other specific package.

## Step 1: Command

Check `src/main/java/.../{context}/api/` first for an existing `{Context}Command` marker interface —
add to it rather than creating a duplicate if other commands in this context already share one:

```java
package {basePackage}.slices.{context}.api;

import com.opencqrs.framework.command.Command;

public interface {Context}Command extends Command {

    String idField();

    @Override
    default String getSubject() {
        return "/{context-lower}/" + idField();
    }
}
```

The command itself:

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.{Context}Command;
import com.opencqrs.framework.command.Command;

public record {SliceName}Command(String field1, String idField) implements {Context}Command {

    @Override
    public SubjectCondition getSubjectCondition() {
        return SubjectCondition.PRISTINE; // or EXISTS — see below
    }
}
```

**`getSubjectCondition()`** — checked by the `CommandRouter` before your handler runs, independent of
whatever your own business-rule code checks:

- `SubjectCondition.PRISTINE` — the subject must **not** already have any events (creation commands).
  Violated → `CommandSubjectAlreadyExistsException`.
- `SubjectCondition.EXISTS` — the subject **must** already have at least one event (commands that act
  on something that must already exist). Violated → `CommandSubjectDoesNotExistException`.
- `SubjectCondition.NONE` (the interface default — only omit the override for this) — no check. Rare;
  most commands are one of the two above.

**Two co-equal id fields, no natural parent/child relationship** (e.g. `email` + `courseId` for a
subscription) — there is no compound-id class or tagging system to build, unlike frameworks that source
strictly by aggregate id. A subject is just a path string: concatenate both fields directly, in a fixed,
documented order:

```java
@Override
public String getSubject() {
    return "/subscription/" + email() + "/" + courseId();
}
```

**Parent/child relationship** (e.g. a "page" belonging to a "book") — nest the child's subject under
the parent's, as its own separate slice with its own command/write-model, rather than cramming child
data into the parent's write model:

```java
// {basePackage}.slices.{context}.api.{Context}PageCommand
@Override
default String getSubject() {
    return "/{context-lower}/" + isbn() + "/page/" + page();
}
```

This hierarchical-subject relationship is also exactly what Step 3's `sourcingMode` choice hinges on —
see below.

## Step 2: Event — only if it doesn't already exist

Check `src/main/java/.../{context}/api/` first; add to it rather than creating a duplicate.

```java
package {basePackage}.slices.{context}.api;

public record {EventName}(String field1, String idField) {}
```

Plain record — no annotation needed on the event class itself. **Then register its type explicitly** in
`src/main/java/{basePackage}/config/CqrsConfiguration.java`'s `eventTypeResolver()` bean — this is a
single project-wide map, not per-slice, and every event used anywhere in the project must be listed:

```java
"quickstart.{context-lower}.{eventname-lower}.v1", {EventName}.class
```

**This step is easy to forget and doesn't fail at compile time.** The default fallback
(`ClassNameEventTypeResolver`) silently uses the Java classname as the stored type instead, which then
breaks the moment the class is renamed or moved — always add the explicit registration line as part of
this slice, never skip it.

## Step 3: Write-model record

Immutable record — **not** a mutable entity with setters. Use a nested sealed interface for a field
that has a small closed set of states (see `Lending` below), rather than a loose boolean/enum pair that
can go out of sync.

**Derive the field(s) from this slice's `specifications[]` (Step 0), not from the event's shape.** Each
GWT scenario's `given`/`then` pair states the one decision the command handler must make and the prior
fact that decision depends on — that fact is the field. Re-read the scenarios before naming fields: a
"given no prior activity" / "given already {X}" pair means one boolean flag or sealed-interface state
for {X}; a scenario that discriminates on a value (not just presence/absence) means a value field
holding that value, not a boolean. Add exactly one field per fact a scenario actually branches on — an
event can carry several fields, but the write model only needs the ones a `specifications[]` scenario
checks.

```java
package {basePackage}.slices.{context}.{slicename};

import java.util.Set;

public record {SliceName}(String idField, <otherFields>, <ruleField>) {

    public {SliceName} with(<ruleFieldType> updated) {
        return new {SliceName}(idField(), <otherFields>, updated);
    }
}
```

`@StateRebuilding` methods (Step 4) reconstruct this by applying one event at a time — write the record
so each transition is a cheap `with(...)`-style copy, not a full manual reconstruction.

## Step 4: Command handler + state rebuilding

Both live in one `@CommandHandlerConfiguration` class per context (or per slice, if the project already
splits it that way — check existing slices first):

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.*;
import com.opencqrs.framework.command.*;

@CommandHandlerConfiguration
public class {SliceName}Handling {

    @CommandHandling
    public String handle({SliceName}Command command, CommandEventPublisher<{SliceName}> publisher) {
        publisher.publish(new {EventName}(command.field1(), command.idField()));
        return command.idField();
    }

    @StateRebuilding
    public {SliceName} on({EventName} event) {
        return new {SliceName}(event.idField(), /* initial field values */);
    }
}
```

**Creation commands** (subject condition `PRISTINE`) use the `(command, publisher)` signature above —
there is no prior write-model instance to pass, since none exists yet.

**Commands that depend on prior state** take the write-model instance as the first parameter, and the
matching `@StateRebuilding` method takes both the previous instance and the event:

```java
@CommandHandling
public void handle({SliceName} state, {SliceName}Command command, CommandEventPublisher<{SliceName}> publisher) {
    if (state.<ruleField>()) {
        throw new IllegalStateException("...");
    }
    publisher.publish(new {EventName}(command.field1(), command.idField()));
}

@StateRebuilding
public {SliceName} on({SliceName} state, {EventName} event) {
    return state.with(/* updated field */);
}
```

Parameters may be given in any order; add `@Autowired SomeDependency dep` for injected collaborators
(resolved from the `ApplicationContext` — no separate mocking wiring needed beyond `@MockitoBean` in the
test, see Step 7). Add `Map<String, ?> metadata` as a parameter to read metadata the caller sent — see
Step 5's `opencqrs.metadata.propagation.keys`.

**`sourcingMode` — how far back state is rebuilt from:**

- **Omit it** (default: `RECURSIVE`) — fetches this subject's own events **and** any events published
  under a nested subject (e.g. a `/book/{isbn}/page/{page}` slice's events are visible to a
  `/book/{isbn}` handler). Use this whenever the business rule genuinely needs to see child-subject
  data — add a `@StateRebuilding` method for that child event type directly onto this write-model
  record.
- **`@CommandHandling(sourcingMode = SourcingMode.LOCAL)`** — fetches only this exact subject's own
  events, ignoring any nested subjects. Use this for creation commands and any command whose rule
  genuinely has nothing to do with child-subject data — it's the cheaper, more precise choice whenever
  RECURSIVE's extra reads aren't needed.

Getting this wrong doesn't fail loudly: too-broad (RECURSIVE when unnecessary) usually still works, just
wastefully; too-narrow (LOCAL when a rule actually depends on a child subject's events) silently drops
data the rule needed, and the bug only shows up as a business rule that never fires.

## Step 5: REST endpoint — only if slice.json shows an inbound `SCREEN` dependency on the command

```java
package {basePackage}.slices.{context}.{slicename};

import com.opencqrs.framework.command.CommandRouter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/{context}")
public class {SliceName}RestController {

    @Autowired
    private CommandRouter commandRouter;

    @PostMapping("/{resource}")
    public ResponseEntity<Void> handle(@RequestBody {SliceName}RequestBody body, HttpServletRequest request) {
        var command = new {SliceName}Command(body.field1(), body.idField());
        commandRouter.send(command, Map.of("request-uri", request.getRequestURI()));
        return ResponseEntity.ok().build();
    }

    public record {SliceName}RequestBody(String field1, String idField) {}
}
```

This project uses plain Spring **WebMVC** (`ResponseEntity`, blocking) — **not** WebFlux/`Mono`.

If the only inbound dependency is another slice's `AUTOMATION`, skip this step — it calls the
`CommandRouter` in-process, it doesn't need HTTP.

**Metadata propagation**: `commandRouter.send(command, Map.of("key", value))` attaches metadata to the
command execution; whether that metadata also gets copied onto the *published events'* own metadata is
controlled project-wide by `opencqrs.metadata.propagation.keys` in `application.properties` — add a key
there only if a slice actually needs to read it back later via `@StateRebuilding`'s/`@EventHandling`'s
`Map<String, ?>` parameter.

**Exception mapping**: business rule violations (`IllegalStateException` or a dedicated exception type)
and the framework's own `CommandSubjectAlreadyExistsException` / `CommandSubjectDoesNotExistException` /
`CqrsFrameworkException.TransientException` / `CqrsFrameworkException.NonTransientException` should map
to HTTP statuses via a shared `@ControllerAdvice` — check whether the project already has one
(`{basePackage}.rest.ExceptionControllerAdvice` or similar) before adding a new one. See
[references/rest-api-patterns.md](references/rest-api-patterns.md) for the full pattern plus a
`@WebMvcTest`/`MockMvc`-based test shape.

## Step 6: Feature flag

Every slice component (handler, REST controller) gets `@ConditionalOnProperty(prefix =
"slices.{context}.write", name = "{slicename}.enabled")` — the write-model record does not need it. Wire
the flag in:

- `src/main/resources/application.properties` — `slices.{context}.write.{slicename}.enabled=true`
- `src/test/resources/application.properties` — `slices.{context}.write.{slicename}.enabled=false`

See [references/feature-flag-patterns.md](references/feature-flag-patterns.md) for the full pattern.
This flag is irrelevant to the Step 7 test below — that test never boots Spring, so
`@ConditionalOnProperty` never runs.

## Step 7: Test — `CommandHandlingTestFixture`, no Spring-booted event store

`@CommandHandlingTest` boots a narrow Spring test slice that auto-discovers this project's
`@CommandHandlerConfiguration` classes and wires a `CommandHandlingTestFixture<YourCommand>` per test
method — no event store, no HTTP, no real database.

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.*;
import com.opencqrs.framework.command.CommandHandlingTest;
import com.opencqrs.framework.command.CommandHandlingTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@CommandHandlingTest
class {SliceName}HandlingTest {

    @Test
    void happyPath(@Autowired CommandHandlingTestFixture<{SliceName}Command> fixture) {
        fixture.given()
                .nothing()
                .when(new {SliceName}Command("value1", "id-1"))
                .succeeds()
                .allEvents()
                .exactly(new {EventName}("value1", "id-1"));
    }

    @Test
    void ruleViolation(@Autowired CommandHandlingTestFixture<{SliceName}Command> fixture) {
        fixture.given()
                .events(new {EventName}("value1", "id-1"))
                .when(new {SliceName}Command("value2", "id-1"))
                .fails()
                .throwing(IllegalStateException.class);
    }
}
```

One test method per GWT scenario in slice.json's `specifications[]`.

**Given-phase options**: `.nothing()` (no prior events/state — creation case) · `.events(e1, e2, ...)`
(replays these through your `@StateRebuilding` methods to build prior state — prefer this, it exercises
the same code path production uses) · `.state(new {SliceName}(...))` (injects prior state directly,
bypassing `@StateRebuilding` — only reach for this if replaying events is impractical for the scenario).

**Then-phase assertions**: `.succeeds()` / `.fails().throwing(ExceptionClass.class)` · on success,
`.allEvents().exactly(new Event(...), ...)` (equality match, in order) or `.allEvents().single(e ->
e.ofType(EventClass.class))` / `.single(e -> e.asserting(a -> a.commandSubject().payloadType(...)))` for
a looser one-event check · `.havingResult(expectedValue)` to assert the command handler's return value
(check this *before* `.nextEvents()`/`.allEvents()` in the chain — see the reference file). Mock
`@Autowired` collaborators with `@MockitoBean` at the test class level, exactly like a normal
`@SpringBootTest`.

Full fluent-API cheat sheet: see
[references/test-fixture-patterns.md](references/test-fixture-patterns.md).

## Step 7b: Storyline-Derived Tests (Optional)

`slice.json` may carry a `storylines[]` array alongside `specifications[]` — narrated walkthroughs
where an ordered sequence of `elements[]` "beats" (EVENT/COMMAND/READMODEL/...) shows one use case
end to end. This is a secondary, supplementary source — `specifications[]` (Step 7) stays the
primary and default source of test methods. Most slices have no `storylines[]`; skip this step
silently when there's nothing relevant.

A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need
to match beats against `commands[]` by id/title. Find beats whose `type` is `COMMAND`. For each such
beat, the storyline gives you a ready-made test: `given` = the cumulative ordered `EVENT` beats
preceding it in the storyline, `when` = the command built from the beat's `fields`, `then` = the
`EVENT` beat(s) immediately following it in the storyline.

```java
@Test
void storylineBeat(@Autowired CommandHandlingTestFixture<{SliceName}Command> fixture) {
    fixture.given()
            .events(new {PrecedingEventName}(/* fields from earlier beats */))
            .when(new {SliceName}Command(/* fields from the command beat */))
            .succeeds()
            .allEvents()
            .exactly(new {EventName}(/* fields from the following event beat */));
}
```

Do **not** try to also assert read-model state in this same test — that half (the following
EVENT→READMODEL beats) belongs to `build-state-view`'s own storyline step, since this fixture never
touches a projector. If the beat immediately after the command isn't an EVENT, don't force a test —
leave it undocumented rather than fabricating an assertion.

## Final Verification

Before considering the slice done:

- [ ] Every field in slice.json's `commands[]` is in the Command record — no invented fields, none missing
- [ ] Every field in slice.json's `events[]` is in the Event record — no invented fields, none missing
- [ ] The new event's type string is registered in `CqrsConfiguration`'s `eventTypeResolver()`
- [ ] `getSubjectCondition()` matches whether this is a creation (`PRISTINE`) or must-already-exist (`EXISTS`) command
- [ ] `sourcingMode` reflects whether this handler's rule needs nested/child-subject events (`RECURSIVE`, the default) or not (`LOCAL`)
- [ ] Every `specifications[]` scenario has a corresponding test method
- [ ] If `storylines[]` is present: every COMMAND beat for this slice's command has a storyline test — or was deliberately skipped as untraceable
- [ ] No business rule exists in the handler that isn't traceable to slice.json's `description`/`comments`
- [ ] `./mvnw compile -q`, then run the slice's own tests only
- [ ] If checks pass, commit with `feat: {Slice Name}` and set slice status to `Done`
