---
name: build-state-change
authors:
  - Martin Dilger
description: >
  Implement Event Sourcing write slices directly against KurrentDB 1.2.x (Java client) in this
  project's one established pattern: Command record → pure evolve/decide functions → a small
  @Component wrapper using the shared EventStore helper to read/append with optimistic concurrency →
  plain JUnit unit test (zero I/O — no KurrentDB, no Spring context). There is no CQRS framework here;
  this convention IS the framework. Use when implementing a new write slice / command handler from a
  slice.json event model in this project. Plain Java only. There is exactly one supported style — do
  not offer alternatives.
---

# KurrentDB — Write Slice (Java)

Directory layout is flat — `src/main/java/.../slices/{context}/{slicename}/`, no `write`/`read`/
`automation` folder layer in between (only the shared `slices/{context}/api/` folder, holding this
context's sealed event interface + event records + `{Context}EventTypes` registry, sits alongside slice
folders).

## Step 0: Read the slice definition

Read `.build-kit/.slices/{context}/{slicename}/slice.json`. Extract, and use **only** what's there:

- `commands[].fields[]` → Command record fields, in order
- `events[].fields[]` → Event record fields, in order
- `specifications[]` (GWT scenarios) → one test method per scenario
- Which command field(s) have `idAttribute: true` — these compose the stream id (see Step 1)
- `storylines[]` (optional, may be absent) → narrated walkthroughs with ordered `elements[]` "beats";
  see Step 6b for how a COMMAND beat in one of these can add a supplementary test

Never invent a field, business rule, or event that isn't in slice.json.

## Step 0a: Determine `{basePackage}`

Every code example below is rooted at `{basePackage}.slices.{context}.{slicename}`. Resolve
`{basePackage}` as documented in `.build-kit/CLAUDE.md`'s Structure section — never hardcode
`com.example.quickstart` (the shipped quickstart scaffold's package) or any other specific package.

## Step 1: Command

Plain record — no interface to implement, there is no `Command` type in this stack:

```java
package {basePackage}.slices.{context}.{slicename};

public record {SliceName}Command(String idField, String field1) {}
```

**Stream id** — one KurrentDB stream per aggregate instance, named `"{context-lower}-" + idField`.
Define this as a small static method on the slice's `*Handling` class (Step 4), not duplicated across
files:

```java
static String streamId(String idField) {
    return "{context-lower}-" + idField;
}
```

**Two co-equal id fields, no natural parent/child relationship** — a stream id is just a string;
concatenate both fields directly, in a fixed, documented order: `"{context-lower}-" + field1 + "-" +
field2`.

**Parent/child relationship** (e.g. a "page" belonging to a "book") — this is its own separate slice
with its own stream (e.g. `"{context-lower}-" + isbn + "-page-" + page`), not nested data inside the
parent's stream. Unlike frameworks with hierarchical subjects, there is no automatic
"parent sees child's events" mechanism here — if a decision genuinely needs another stream's data, read
it explicitly (`eventStore.read(otherStreamId)`) inside `decide`'s caller (Step 5), never inside `decide`
itself (which must stay pure).

## Step 2: Event — only if it doesn't already exist

Check `src/main/java/.../{context}/api/` first; add to the existing sealed interface rather than
creating a duplicate.

```java
package {basePackage}.slices.{context}.api;

public record {EventName}(String idField, String field1) implements {Context}Event {}
```

If `{Context}Event` (the sealed marker interface) doesn't exist yet for this context, create it:

```java
package {basePackage}.slices.{context}.api;

public sealed interface {Context}Event permits {EventName}, /* ...every other event in this context */ {}
```

Every `permits` clause must be updated whenever a new event is added — the compiler enforces this
(a missing entry is a compile error), which is exactly the safety net a sealed interface buys you here.

**Then register the event's type name** in this context's `{Context}EventTypes` class — a single
project-wide-per-context map, not per-slice:

```java
package {basePackage}.slices.{context}.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.kurrent.dbclient.RecordedEvent;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.Optional;

public final class {Context}EventTypes {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final Map<String, Class<? extends {Context}Event>> TYPES = Map.of(
            "{EventName}", {EventName}.class
            // , "{OtherEventName}", {OtherEventName}.class
    );

    private {Context}EventTypes() {}

    public static String typeNameOf({Context}Event event) {
        return switch (event) {
            case {EventName} e -> "{EventName}";
            // add one arm per event type — the compiler enforces exhaustiveness
        };
    }

    public static byte[] serialize({Context}Event event) {
        try {
            return MAPPER.writeValueAsBytes(event);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Empty for an event type this context doesn't recognize — a foreign event on a shared stream. */
    public static Optional<{Context}Event> deserialize(RecordedEvent recordedEvent) {
        Class<? extends {Context}Event> type = TYPES.get(recordedEvent.getEventType());
        if (type == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(MAPPER.readValue(recordedEvent.getEventData(), type));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
```

**This step is easy to forget and doesn't fail at compile time.** An unregistered event type is simply
invisible to every reader that scans a stream (`evolve`, a projection, an automation) — `deserialize`
returns empty for it and it's silently skipped. Add the map entry and the `typeNameOf` switch arm as
part of the same commit that introduces the event, never as an afterthought.

Use a short, stable string for the type name (e.g. `"BookPurchased"`) — **never** the Java classname.
The classname will get refactored eventually; the stored event's type string must not change when it
does.

## Step 3: Write-model record

Immutable record — **not** a mutable entity with setters. Use a nested sealed interface for a field
that has a small closed set of states, rather than a loose boolean/enum pair that can go out of sync.

**Derive the field(s) from this slice's `specifications[]` (Step 0), not from the event's shape.** Each
GWT scenario's `given`/`then` pair states the one decision the command handler must make and the prior
fact that decision depends on — that fact is the field. Re-read the scenarios before naming fields: a
"given no prior activity" / "given already {X}" pair means one boolean flag or sealed-interface state
for {X}; a scenario that discriminates on a value (not just presence/absence) means a value field
holding that value, not a boolean. Add exactly one field per fact a scenario actually branches on.

```java
package {basePackage}.slices.{context}.{slicename};

public record {SliceName}(String idField, <otherFields>, <ruleField>) {

    public {SliceName} with(<ruleFieldType> updated) {
        return new {SliceName}(idField(), <otherFields>, updated);
    }
}
```

## Step 4: evolve / decide — pure functions, zero I/O

Both are `static` methods on the slice's `*Handling` class. **Neither touches KurrentDB, Spring, or any
collaborator that does I/O** — that's what makes Step 7's test free of any container/context.

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.{EventName};
import {basePackage}.slices.{context}.api.{Context}Event;

import java.util.List;

class {SliceName}Handling {
    // ... (Step 5 continues this same class)

    static String streamId(String idField) {
        return "{context-lower}-" + idField;
    }

    // ---- evolve: pure, no I/O. Exhaustive switch over the sealed event interface — the compiler
    // errors if a new permitted event type isn't handled here. ----
    static {SliceName} evolve({SliceName} state, {Context}Event event) {
        return switch (event) {
            case {EventName} e -> new {SliceName}(e.idField(), /* initial field values */);
            // one arm per event this write-model reacts to; other permitted events in this
            // context that this slice doesn't care about still need a `case ... -> state;` arm
            // (exhaustiveness applies to every type the sealed interface permits, not just this
            // slice's own events)
        };
    }

    // ---- decide: pure, no I/O. Throws a plain business exception on rule violation. ----
    static List<{Context}Event> decide({SliceName}Command command, {SliceName} state) {
        if (state != null && /* rule from specifications[] */) {
            throw new IllegalStateException("...");
        }
        return List.of(new {EventName}(command.idField(), command.field1()));
    }
}
```

**Creation commands** (no prior stream) — `decide` receives `state == null`; check for that explicitly
rather than assuming a non-null default. **Commands that depend on prior state** — `decide` receives the
folded `{SliceName}` state built by replaying every recognized event through `evolve` (Step 5 does this
folding, not `decide` itself).

## Step 5: The `*Handling` component — the only part that touches the event store

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.common.EventStore;
import {basePackage}.slices.{context}.api.{Context}Event;
import {basePackage}.slices.{context}.api.{Context}EventTypes;
import io.kurrent.dbclient.EventData;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

@Component
public class {SliceName}Handling {

    private final EventStore eventStore;

    public {SliceName}Handling(EventStore eventStore) {
        this.eventStore = eventStore;
    }

    // ... streamId/evolve/decide from Step 4 ...

    private {SliceName} replay(EventStore.StreamEvents streamEvents) {
        {SliceName} state = null;
        for (var resolved : streamEvents.events()) {
            var domainEvent = {Context}EventTypes.deserialize(resolved.getOriginalEvent());
            if (domainEvent.isPresent()) {
                state = evolve(state, domainEvent.get());
            }
        }
        return state;
    }

    private void append(String idField, EventStore.StreamEvents streamEvents, List<{Context}Event> events) {
        List<EventData> eventData = events.stream()
                .map(e -> EventData.builderAsJson(UUID.randomUUID(), {Context}EventTypes.typeNameOf(e),
                        {Context}EventTypes.serialize(e)).build())
                .toList();
        eventStore.append(streamId(idField), streamEvents.expectedState(), eventData);
    }

    public void handle({SliceName}Command command) {
        var streamEvents = eventStore.read(streamId(command.idField()));
        var state = replay(streamEvents);
        var events = decide(command, state);
        append(command.idField(), streamEvents, events);
    }
}
```

`EventStore.StreamEvents.expectedState()` (see `{basePackage}.common.EventStore`) resolves to
`StreamState.noStream()` when the stream doesn't exist yet, or `StreamState.streamRevision(...)`
pinned to exactly what was just read — this is the optimistic-concurrency check: if another writer
appended to the same stream between this read and this append, KurrentDB rejects the append with
`WrongExpectedVersionException` rather than silently interleaving. That exception propagates unwrapped
out of `eventStore.append(...)` (see `EventStore`'s own Javadoc) — Step 6 maps it to an HTTP 409; an
automation dispatching a command instead has its own idempotency handling, see `build-automation`.

For a command per slice.json with more than one command mapped to this same write model (e.g. purchase
+ lend on the same `Book`), add one more public `handle...`/`decide` pair to this same class — see the
example above where `decide` is overloaded per command type, mirroring how a real hand-rolled Java ES
codebase reads.

## Step 6: REST endpoint — only if slice.json shows an inbound `SCREEN` dependency on the command

```java
package {basePackage}.slices.{context}.{slicename};

import io.kurrent.dbclient.WrongExpectedVersionException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/{context}")
public class {SliceName}RestController {

    private final {SliceName}Handling handling;

    public {SliceName}RestController({SliceName}Handling handling) {
        this.handling = handling;
    }

    @PostMapping("/{resource}")
    public ResponseEntity<Void> handle(@RequestBody {SliceName}RequestBody body) {
        try {
            handling.handle(new {SliceName}Command(body.idField(), body.field1()));
            return ResponseEntity.ok().build();
        } catch (WrongExpectedVersionException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
    }

    public record {SliceName}RequestBody(String idField, String field1) {}
}
```

This project uses plain Spring **WebMVC** (`ResponseEntity`, blocking) — not WebFlux/`Mono`.

If the only inbound dependency is another slice's `AUTOMATION`, skip this step — the automation calls
`{SliceName}Handling` in-process, it doesn't need HTTP.

## Step 7: Test — plain JUnit, zero I/O

`evolve`/`decide` are `static` and package-private — call them directly from a test in the same
package. **No KurrentDB, no Spring context, no container.** This is the primary and default test for a
state-change slice; only reach for an integration-style test (a real, disposable KurrentDB via
Testcontainers — see [references/integration-test-patterns.md](references/integration-test-patterns.md))
when you specifically need to verify the `EventStore`/`*Handling` wiring itself, not the business rule.

```java
package {basePackage}.slices.{context}.{slicename};

import {basePackage}.slices.{context}.api.{EventName};
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static {basePackage}.slices.{context}.{slicename}.{SliceName}Handling.decide;
import static {basePackage}.slices.{context}.{slicename}.{SliceName}Handling.evolve;

class {SliceName}HandlingTest {

    @Test
    void givenNothing_whenCommand_thenEventEmitted() {
        var events = decide(new {SliceName}Command("id-1", "value1"), null);

        assertThat(events).containsExactly(new {EventName}("id-1", "value1"));
    }

    @Test
    void givenRuleAlreadyTrue_whenCommand_thenThrows() {
        var state = evolve(null, new {EventName}("id-1", "value1"));

        assertThatThrownBy(() -> decide(new {SliceName}Command("id-1", "value2"), state))
                .isInstanceOf(IllegalStateException.class);
    }
}
```

One test method per GWT scenario in slice.json's `specifications[]`. Build the "given" state by folding
`evolve` over the scenario's given events (`evolve(evolve(null, e1), e2)`, etc.) — exactly what `replay`
does in production — rather than hand-constructing a `{SliceName}` record literal, so the test exercises
the same reconstruction path production uses.

## Step 6b: Storyline-Derived Tests (Optional)

`slice.json` may carry a `storylines[]` array alongside `specifications[]` — narrated walkthroughs
where an ordered sequence of `elements[]` "beats" (EVENT/COMMAND/READMODEL/...) shows one use case
end to end. This is a secondary, supplementary source — `specifications[]` (Step 7) stays the
primary and default source of test methods. Most slices have no `storylines[]`; skip this step
silently when there's nothing relevant.

Find beats whose `type` is `COMMAND`. For each such beat: fold `evolve` over the cumulative ordered
`EVENT` beats preceding it to build `state`, call `decide` with the command built from the beat's
`fields`, and assert the result against the `EVENT` beat(s) immediately following it in the storyline.

```java
@Test
void storylineBeat() {
    var state = evolve(null, new {PrecedingEventName}(/* fields from earlier beats */));

    var events = decide(new {SliceName}Command(/* fields from the command beat */), state);

    assertThat(events).containsExactly(new {EventName}(/* fields from the following event beat */));
}
```

Do **not** try to also assert read-model state in this same test — that half (the following
EVENT→READMODEL beats) belongs to `build-state-view`'s own storyline step. If the beat immediately
after the command isn't an EVENT, don't force a test — leave it undocumented rather than fabricating an
assertion.

## Final Verification

Before considering the slice done:

- [ ] Every field in slice.json's `commands[]` is in the Command record — no invented fields, none missing
- [ ] Every field in slice.json's `events[]` is in the Event record — no invented fields, none missing
- [ ] The new event is added to the context's sealed `{Context}Event` interface's `permits` clause
- [ ] The new event's type name is registered in `{Context}EventTypes` (both the `TYPES` map and the `typeNameOf` switch)
- [ ] `evolve` is an exhaustive switch (compiler-enforced) and never performs I/O
- [ ] `decide` never performs I/O and only throws for rules traceable to slice.json's `description`/`comments`
- [ ] Every `specifications[]` scenario has a corresponding test method, built by folding `evolve` over given events
- [ ] If `storylines[]` is present: every COMMAND beat for this slice's command has a storyline test — or was deliberately skipped as untraceable
- [ ] `./mvnw compile -q`, then run the slice's own tests only
- [ ] If checks pass, commit with `feat: {Slice Name}` and set slice status to `Done`
