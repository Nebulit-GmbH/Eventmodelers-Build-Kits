---
name: build-automation
authors:
  - Martin Dilger
description: >
  Implement automation slices (Event → Command) using OpenCQRS 2.0.0 (Spring Boot, EventSourcingDB) in
  this project's one established pattern: an @EventHandling method that reacts to a trigger event by
  dispatching a command via CommandRouter, guarded against at-least-once redelivery by catching the
  target command's own subject-condition exception locally. Automations can be stateless (direct
  event-to-command mapping) or backed by a private JPA read model (to look up data needed for command
  construction). Use when implementing a new automation / event-to-command reactor from a slice.json
  event model in this project. Plain Java only. There is exactly one supported style — do not offer
  alternatives.
---

# OpenCQRS — Automation Slice (Java)

An automation reacts to an event by dispatching a command. In Event Modeling: the **orange** stripe.

**There is no dedicated "processor"/"reactor" abstraction in OpenCQRS distinct from a projection** — an
automation is exactly the same `@EventHandling` mechanism `build-state-view` uses, just reacting by
calling `CommandRouter.send(...)` instead of (or in addition to) writing to a repository. Everything
`build-state-view` documents about processing-group naming, per-method `@Autowired` parameters, and the
`@DataJpaTest` test pattern applies here unchanged — this skill only adds what's specific to
**dispatching a command safely under at-least-once delivery**, which is the one thing that's easy to get
wrong.

There are two kinds:

- **Stateless**: the trigger event alone carries everything the target command needs.
- **With a private read model**: needs data that isn't in the trigger event itself (e.g. "look up this
  book's page count to pick a random damaged page"), built by one `@EventHandling` method from earlier
  events and read by another.

## Step 0: Discover target project conventions

> **Comments & description**: Each element in the slice carries a `comments: string[]` array and a
> `description` field. Use these as implementation hints. When done, resolve each used comment:
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get
> IDs first via GET on same path).

Read the target project's `.build-kit/CLAUDE.md` and explore existing slices for the processing-group
naming convention already in use.

**Determine `{basePackage}`** — every path below is rooted at
`{basePackage}.slices.{context}.automation.{slicename}`. Resolve `{basePackage}` as documented in
`.build-kit/CLAUDE.md`'s Structure section.

## Step 1: Understand the input

Extract these elements regardless of input format:

| Element | What to extract |
|---|---|
| **Trigger event** | Which event triggers the automation, and which condition filters it |
| **Target command** | Which command to dispatch, with what properties |
| **Mapping logic** | How event properties map to command properties |
| **Read model needed?** | Does the automation need data NOT in the trigger event itself? |

If the Event Modeling artifact includes slice details with `## Scenarios (GWTs)`, use them to derive
test cases. GWT format for automations: `Given (events) → Then (command | NOTHING)`. Events in Given
include read-model-building events first, trigger event last.

`slice.json` may also carry an optional `storylines[]` array — see the "Storyline-Derived Tests"
section under Step 5 for how a trigger-event beat in one of these can add a supplementary test.

If the slice details contain `## Implementation Guidelines`, **follow them**.

### Stateless vs. with-read-model decision

Choose **with a private read model** when:

- The automation needs data that is NOT in the trigger event (e.g. "find this book's page count")
- The automation must iterate over a collection to dispatch multiple commands
- Two different events are involved: one builds the read model, another triggers the dispatch

Choose **stateless** when all command fields can be derived directly from the trigger event (plus a
pure calculation).

## Step 2: Ensure events exist

All events the automation handles must exist in `src/main/java/.../{context}/api/`. If they don't,
create them **first** (see `build-state-change` Step 2), including registering each new event's type
string in `CqrsConfiguration`'s `eventTypeResolver()` bean.

## Step 3: Dispatching the target command — the part that's easy to get wrong

`CommandRouter` is a normal Spring bean — inject it into an `@EventHandling` method exactly like any
other collaborator, via a method-parameter `@Autowired` (see `build-state-view`'s Step 2 on why
`@EventHandling` methods take collaborators this way, not via the constructor):

```java
@{SliceName}Handling
public void react({TriggerEvent} event, @Autowired CommandRouter commandRouter) {
    commandRouter.send(new {TargetCommand}Command(/* mapped fields */));
}
```

**This alone is not safe.** `EventHandlingProcessor` guarantees only **at-least-once** delivery — the
same event can, and eventually will, be redelivered to this method after a crash/restart/fail-over that
happens between the command actually succeeding and the processor's checkpoint advancing past it. The
target command handler will then run a second time for the same logical trigger.

**The fix is exactly the same idempotency mechanism `build-state-change` already gives you for free: the
target command's own `SubjectCondition`.** If the target command is a creation command
(`SubjectCondition.PRISTINE`, the normal case for "mark this thing as done"), redelivery makes
`CommandRouter.send(...)` throw `CommandSubjectAlreadyExistsException` the second time — which is the
framework telling you "this was already handled", not a real failure. **Catch it locally, right at the
dispatch call**, and do nothing:

```java
@{SliceName}Handling
public void react({TriggerEvent} event, @Autowired CommandRouter commandRouter) {
    try {
        commandRouter.send(new {TargetCommand}Command(/* mapped fields */));
    } catch (CommandSubjectAlreadyExistsException e) {
        // already dispatched on a prior (redelivered) attempt — safe to ignore
    }
}
```

If the target command instead requires `SubjectCondition.EXISTS`, catch
`CommandSubjectDoesNotExistException` the same way where a redelivery-caused re-check is expected to
fail harmlessly. If the target command has `SubjectCondition.NONE` (no built-in idempotency check
available), you must give the dispatched command a stable, derivable subject/business key so a genuine
duplicate is rejected by that slice's own business rule instead — an automation with no way to detect
"already done" on redelivery will double-execute silently.

**Why this matters more here than it looks**: letting any other `NonTransientException` — or any
uncaught `Throwable` that isn't retried away — escape an `@EventHandling` method does not just fail
*this one event*. Per `EventHandlingProcessor`'s documented error handling, an escaping
`NonTransientException` **terminates the entire processing loop for that group**, stopping every other
event this group would otherwise still be handling, not just the one that failed. Swallowing the
expected conflict exception at the dispatch call site — never letting it propagate out of the
`@EventHandling` method — is what keeps the automation's processing group alive across redeliveries.

## Step 4: Implement the automation

### Stateless automation

```java
package {basePackage}.slices.{context}.automation.{slicename};

import {basePackage}.slices.{context}.api.*;
import com.opencqrs.framework.command.CommandRouter;
import com.opencqrs.framework.command.CommandSubjectAlreadyExistsException;
import com.opencqrs.framework.eventhandler.EventHandling;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class {AutomationName}Processor {

    @EventHandling("{context}-{slicename}")
    public void react({TriggerEvent} event, @Autowired CommandRouter commandRouter) {
        if (!shouldReact(event)) {
            return;
        }
        try {
            commandRouter.send(new {TargetCommand}Command(event.{idField()} /*, mapped fields */));
        } catch (CommandSubjectAlreadyExistsException e) {
            // already dispatched on a prior (redelivered) attempt — safe to ignore
        }
    }

    private boolean shouldReact({TriggerEvent} event) {
        return true; // replace with the actual condition from the slice definition
    }
}
```

A pure mapping/calculation dependency (e.g. picking which page to mark) can be `@Autowired` in
separately, exactly like any other collaborator — no special interface required, a plain injected
Spring bean is enough.

### Automation with a private read model

Verified, real pattern — two `@EventHandling` methods under the **same processing-group name**, so the
per-group in-order guarantee ensures the read model is built before the trigger event that consumes it
is ever handled. **Never reuse another slice's entity/repository** — build a private one, exactly like
`build-state-view`'s own private-entity rule.

```java
package {basePackage}.slices.{context}.automation.{slicename};

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
class {AutomationName}Entity {

    @Id
    public String id;
    public Long someLookupValue;

    public {AutomationName}Entity() {}

    public {AutomationName}Entity(String id, Long someLookupValue) {
        this.id = id;
        this.someLookupValue = someLookupValue;
    }
}
```

```java
package {basePackage}.slices.{context}.automation.{slicename};

import org.springframework.data.repository.CrudRepository;

interface {AutomationName}Repository extends CrudRepository<{AutomationName}Entity, String> {}
```

```java
package {basePackage}.slices.{context}.automation.{slicename};

import {basePackage}.slices.{context}.api.*;
import com.opencqrs.framework.command.CommandRouter;
import com.opencqrs.framework.command.CommandSubjectAlreadyExistsException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class {AutomationName}Processor {

    // Phase 1 — build the private read model from a setup event
    @{AutomationName}Handling
    public void on({SetupEvent} event, @Autowired {AutomationName}Repository repository) {
        repository.save(new {AutomationName}Entity(event.idField(), event.someLookupValue()));
    }

    // Phase 2 — trigger: look up what's needed, then dispatch
    @{AutomationName}Handling
    public void react(
            {TriggerEvent} event,
            @Autowired {AutomationName}Repository repository,
            @Autowired CommandRouter commandRouter) {
        var entry = repository.findById(event.idField()).orElseThrow();
        try {
            commandRouter.send(new {TargetCommand}Command(entry.id, /* derived fields */));
        } catch (CommandSubjectAlreadyExistsException e) {
            // already dispatched on a prior (redelivered) attempt — safe to ignore
        }
    }
}
```

Define the shared `@{AutomationName}Handling` meta-annotation (`@EventHandling("{context}-{slicename}")`)
exactly as shown in `build-state-view`'s Step 2 — required here since this pattern always has 2+ handler
methods sharing one group.

**Iterating over multiple matches** (dispatch a command per matching entry, not just one): use
`repository.findAllBy...(...)` instead of `findById`, and loop, catching the conflict exception around
each individual `commandRouter.send(...)` call rather than around the whole loop — one entry's already-
handled conflict must not stop the others from being dispatched.

### Alternative to a private read model: reading events directly

For a stateless, read-only lookup that doesn't need its own durable table, `EventRepository`/
`EventReader` can be `@Autowired` directly into any Spring bean to read events on demand (e.g.
`eventReader.readAsObject("/{context}", Set.of(new Option.Recursive()))`) instead of maintaining a
private projection. Reach for this only for genuinely occasional, non-hot-path lookups — a private JPA
read model built incrementally (above) is the default, well-trodden choice for anything on the
automation's main dispatch path.

## Step 5: Feature flags (optional)

Same house convention as `build-state-change`/`build-state-view` — see
[references/feature-flag-patterns.md](references/feature-flag-patterns.md). **Enable both the
automation and its target command's write slice** in any test that exercises the automation end-to-end.

## Step 6: Implement tests

There is no built-in test fixture for `@EventHandling` methods — call them directly, exactly as
`build-state-view` does, mocking `CommandRouter` since this is the collaborator under test here.

**Stateless automation:**

```java
package {basePackage}.slices.{context}.automation.{slicename};

import {basePackage}.slices.{context}.api.*;
import com.opencqrs.framework.command.CommandRouter;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class {AutomationName}ProcessorTest {

    private {AutomationName}Processor processor;

    @Mock
    private CommandRouter commandRouter;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        processor = new {AutomationName}Processor();
    }

    @Test
    void conditionMet_dispatchesCommand() {
        var event = new {TriggerEvent}("entity-1" /*, fields that meet the condition */);

        processor.react(event, commandRouter);

        verify(commandRouter).send(eq(new {TargetCommand}Command("entity-1" /*, expected fields */)));
    }

    @Test
    void conditionNotMet_dispatchesNothing() {
        var event = new {TriggerEvent}("entity-1" /*, fields that do NOT meet the condition */);

        processor.react(event, commandRouter);

        verifyNoInteractions(commandRouter);
    }

    @Test
    void redeliveredEvent_conflictIsSwallowed() {
        var event = new {TriggerEvent}("entity-1" /*, fields that meet the condition */);
        doThrow(new CommandSubjectAlreadyExistsException("...", "..."))
                .when(commandRouter).send(any());

        processor.react(event, commandRouter); // must not throw
    }
}
```

**Automation with a private read model** — use `@DataJpaTest` + `@Import` + Testcontainers Postgres
(see `build-state-view`'s Step 4 for why this project needs the real container, not an embedded
database), mocking only `CommandRouter`:

```java
@DataJpaTest
@Testcontainers
@Import({AutomationName}Processor.class)
class {AutomationName}ProcessorTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    @Autowired
    private {AutomationName}Processor processor;

    @Autowired
    private {AutomationName}Repository repository;

    @MockitoBean
    private CommandRouter commandRouter;

    @Test
    void setupThenTrigger_dispatchesForMatchingEntry() {
        processor.on(new {SetupEvent}("entity-1", 42L), repository);

        processor.react(new {TriggerEvent}("entity-1"), repository, commandRouter);

        verify(commandRouter).send(eq(new {TargetCommand}Command("entity-1", 42L)));
    }

    @Test
    void noSetupEvent_throwsOrSkips() {
        // reflects however Step 4's lookup handles a missing entry — orElseThrow(), or a
        // findAllBy(...).isEmpty() no-op loop; assert whichever this slice actually implements
    }
}
```

### Test cases to cover

**Stateless automations:**
1. Condition met → expected command dispatched
2. Condition not met → no command dispatched
3. Redelivered trigger event (target already handled) → the conflict exception is swallowed, method
   does not throw

**Automations with a read model:**
1. Setup + trigger with a matching entry → command dispatched for that entry
2. Setup + trigger with no matching entry → no command dispatched (or however the slice defines that
   case)
3. Temporal ordering: only entries set up *before* the trigger are found — reflects that both methods
   share one processing group and are therefore applied in event-store order

### Mapping GWT scenarios to tests

| GWT Element | Test code |
|---|---|
| Event in Given | `processor.on(new Event(...), repository)` (read-model phase) or direct setup |
| Command in Then | `verify(commandRouter).send(eq(expectedCommand))` |
| NOTHING in Then | `verifyNoInteractions(commandRouter)` |

### Storyline-Derived Tests (Optional)

`slice.json` may also carry a `storylines[]` array — narrated walkthroughs with an ordered
`elements[]` "beats" sequence (EVENT/COMMAND/READMODEL/...). This is a secondary, supplementary
source; `specifications[]` above stays the primary and default source of test cases. Most slices
have no `storylines[]` — skip silently when there's nothing relevant.

A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need
to match beats against `events[]`/`commands[]` by id/title. Find a beat whose `type` is `EVENT`
immediately followed by a `COMMAND` beat. That pair is a ready-made test: `given` = the cumulative
preceding `EVENT` beats (setup events) through the trigger beat, `then` =
`verify(commandRouter).send(eq(...))` built from the command beat's fields — same shape
as the "Mapping GWT Scenarios to Tests" row above, just sourced from the storyline instead of
`specifications[]`.

If the beat following the trigger event isn't a COMMAND this automation dispatches (e.g. it's a
READMODEL or SCREEN beat), don't force a test — leave it undocumented rather than fabricating an
assertion.

## References

- [Feature Flag Patterns](references/feature-flag-patterns.md) — `@ConditionalOnProperty`
- [Idempotent Command Dispatch](references/idempotent-dispatch-patterns.md) — the full exception-per-`SubjectCondition` table, and why swallowing it locally matters

---

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] The trigger event in the processor matches the trigger event in slice.json exactly
- [ ] The command dispatched matches the target command defined in slice.json
- [ ] All fields mapped from trigger event (or private read model) to command come from slice.json — no invented mappings
- [ ] The dispatch call is wrapped to swallow the target command's expected `SubjectCondition` conflict exception — never left to propagate
- [ ] If a private read model is used: it is private to this slice, and both `@EventHandling` methods share one stable processing-group name
- [ ] Every new event's type string is registered in `CqrsConfiguration`'s `eventTypeResolver()`
- [ ] Every GWT scenario in `specifications[]` maps to a test case in the test class, including a redelivery/conflict-swallowed case
- [ ] If `storylines[]` is present: every trigger-EVENT→target-COMMAND beat pair for this automation has a storyline test — or was deliberately skipped as untraceable
- [ ] No filtering conditions were invented — all conditions come from slice.json `description` or `comments`
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
