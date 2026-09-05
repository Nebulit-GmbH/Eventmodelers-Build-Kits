---
name: build-automation
authors:
  - Martin Dilger
description: >
  Implement automation slices (Event → Command) directly against KurrentDB 1.2.x (Java client) in this
  project's one established pattern: a KurrentDB persistent subscription reacts to a trigger event by
  invoking the target slice's own *Handling.handle(command) (reusing its decide/evolve validation),
  guarded against at-least-once redelivery by catching whatever exception that target's decide throws
  for its own "already done" case. Automations can be stateless (direct event-to-command mapping) or
  backed by a private JPA read model (to look up data needed for command construction). Use when
  implementing a new automation / event-to-command reactor from a slice.json event model in this
  project. Plain Java only. There is exactly one supported style — do not offer alternatives.
---

# KurrentDB — Automation Slice (Java)

An automation reacts to an event by dispatching a command. In Event Modeling: the **orange** stripe.

**There is no dedicated "processor"/"reactor" abstraction distinct from a projection here** — an
automation uses the exact same KurrentDB persistent-subscription mechanism `build-state-view` uses,
just reacting by calling the target slice's `*Handling.handle(command)` instead of (or in addition to)
writing to a repository. Everything `build-state-view` documents about subscription-group naming,
`@PostConstruct` startup, and idempotent group creation applies here unchanged — this skill only adds
what's specific to **dispatching a command safely under at-least-once delivery**, which is the one
thing that's easy to get wrong.

There are two kinds:

- **Stateless**: the trigger event alone carries everything the target command needs.
- **With a private read model**: needs data that isn't in the trigger event itself (e.g. "look up this
  book's page count"), built by projecting one event and read when reacting to another.

## Step 0: Discover target project conventions

> **Comments & description**: Each element in the slice carries a `comments: string[]` array and a
> `description` field. Use these as implementation hints. When done, resolve each used comment:
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get
> IDs first via GET on same path).

Read the target project's `.build-kit/CLAUDE.md` and explore existing slices for the subscription-group
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

Choose **stateless** when all command fields can be derived directly from the trigger event.

## Step 2: Ensure events exist

All events the automation handles must exist in `src/main/java/.../{context}/api/`. If they don't,
create them **first** (see `build-state-change` Step 2), including registering each new event's type
name in `{Context}EventTypes`.

## Step 3: Dispatching the target command — the part that's easy to get wrong

**Prefer calling the target slice's own `*Handling.handle(command)`** over hand-rolling a raw
`EventStore.append(...)` call — this reuses that slice's own `decide`/`evolve` validation instead of
duplicating (or worse, bypassing) it.

```java
@Component
public class {AutomationName}Handling {

    private final {TargetSlice}Handling targetHandling;

    public {AutomationName}Handling({TargetSlice}Handling targetHandling) {
        this.targetHandling = targetHandling;
    }

    void react({TriggerEvent} event) {
        targetHandling.handle(new {TargetCommand}Command(event.idField() /*, mapped fields */));
    }
}
```

**This alone is not safe.** KurrentDB persistent subscriptions guarantee only **at-least-once**
delivery — the same event can, and eventually will, be redelivered after a crash or a nack/retry that
happens between the target command actually succeeding and this subscription's ack reaching the server.
`targetHandling.handle(...)` will then run a second time for the same logical trigger, replay the
target stream (which now already has the event from the first successful dispatch), and call the
target's `decide` again — which is exactly where the target slice's **own** business rule for "this was
already done" fires.

**Catch whatever exception the target's `decide` throws for that case — right at the dispatch call —
and treat it as success, not a failure:**

```java
void react({TriggerEvent} event) {
    try {
        targetHandling.handle(new {TargetCommand}Command(event.idField()));
    } catch ({TargetAlreadyDoneException} e) {
        // already dispatched on a prior (redelivered) attempt — safe to ignore
    }
}
```

**There is no single, uniform exception type for this** — unlike a framework with a built-in
subject-existence check, the exception here is whatever that specific target slice's own `decide`
throws for its "already happened" branch (read that slice's `SKILL.md`-generated code, or its
`specifications[]`, to find out — it might be `IllegalStateException`, or a dedicated exception class
like `{X}AlreadyLentException`). **Read the target command's `decide` implementation before writing
this catch block** — guessing the wrong exception type here means a genuine redelivery crashes the
automation instead of being silently absorbed.

**If the target has no `*Handling` of its own** — e.g. a bare "mark as done" fact with no independent
command/decide, just a stream that either has one specific event or doesn't — append directly instead,
using `StreamState.noStream()` as the precondition, and catch KurrentDB's own
`WrongExpectedVersionException`:

```java
void react({TriggerEvent} event) {
    var eventData = EventData.builderAsJson(UUID.randomUUID(), "{FactEventName}",
            {Context}EventTypes.serialize(new {FactEventName}(event.idField()))).build();
    try {
        eventStore.append("{context-lower}-" + event.idField() + "-{factsuffix}", StreamState.noStream(),
                List.of(eventData));
    } catch (WrongExpectedVersionException e) {
        // already dispatched on a prior (redelivered) attempt — safe to ignore
    }
}
```

See [references/idempotent-dispatch-patterns.md](references/idempotent-dispatch-patterns.md) for the
full decision table and why swallowing the exception locally (not letting it propagate out of the
subscription listener's `onEvent`) matters.

## Step 4: Implement the automation

### Stateless automation

```java
package {basePackage}.slices.{context}.automation.{slicename};

import {basePackage}.slices.{context}.api.*;
import {basePackage}.slices.{context}.{targetslicename}.{TargetSlice}Handling;
import {basePackage}.slices.{context}.{targetslicename}.{TargetCommand}Command;
import io.kurrent.dbclient.*;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.util.concurrent.ExecutionException;

@Component
public class {AutomationName}Handling {

    private static final String GROUP = "{context}-{slicename}";

    private final KurrentDBPersistentSubscriptionsClient subscriptionsClient;
    private final {TargetSlice}Handling targetHandling;

    public {AutomationName}Handling(KurrentDBPersistentSubscriptionsClient subscriptionsClient,
                                     {TargetSlice}Handling targetHandling) {
        this.subscriptionsClient = subscriptionsClient;
        this.targetHandling = targetHandling;
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
        }

        subscriptionsClient.subscribeToAll(GROUP, new PersistentSubscriptionListener() {
            @Override
            public void onEvent(PersistentSubscription subscription, int retryCount, ResolvedEvent event) {
                try {
                    {Context}EventTypes.deserialize(event.getOriginalEvent())
                            .filter({TriggerEvent}.class::isInstance)
                            .map({TriggerEvent}.class::cast)
                            .ifPresent({AutomationName}Handling.this::react);
                    subscription.ack(event);
                } catch (Exception ex) {
                    subscription.nack(NackAction.Park, ex.getMessage(), event);
                }
            }

            @Override
            public void onCancelled(PersistentSubscription subscription, Throwable exception) {
            }
        });
    }

    private void react({TriggerEvent} event) {
        try {
            targetHandling.handle(new {TargetCommand}Command(event.idField() /*, mapped fields */));
        } catch ({TargetAlreadyDoneException} e) {
            // already dispatched on a prior (redelivered) attempt — safe to ignore
        }
    }
}
```

Note that `react`'s idempotency catch is deliberately narrow (Step 3) — only the target's own
"already done" exception is swallowed; every other exception propagates out of `onEvent`'s try block
into the outer `catch (Exception ex)`, which `nack(Park, ...)`s it. That outer catch is a safety net for
genuine failures, not a substitute for the specific idempotency catch — don't rely on it to mask
redelivery, it parks the message instead of acking it, which stops progress for this trigger entirely.

### Automation with a private read model

When the automation needs stored state, put everything in one package. **Never reuse another slice's
entity/repository** — build a private one, exactly like `build-state-view`'s own private-entity rule.
Both the "build" and "react" logic must be reached via the **same subscription group**, so KurrentDB's
`$all` global commit order guarantees the setup event is seen before the trigger event.

```java
@Component
public class {AutomationName}Handling {

    // ... GROUP, @PostConstruct start() as above, but onEvent dispatches to whichever of these two
    // matches the deserialized event's type ...

    private void onSetupEvent({SetupEvent} event) {
        repository.save(new {AutomationName}Entity(event.idField(), event.someLookupValue()));
    }

    private void react({TriggerEvent} event) {
        var entry = repository.findById(event.idField()).orElseThrow();
        try {
            targetHandling.handle(new {TargetCommand}Command(entry.id(), /* derived fields */));
        } catch ({TargetAlreadyDoneException} e) {
            // already dispatched on a prior (redelivered) attempt — safe to ignore
        }
    }
}
```

**Iterating over multiple matches** (dispatch a command per matching entry): use
`repository.findAllBy...(...)` instead of `findById`, and loop, catching the target's idempotency
exception around each individual `targetHandling.handle(...)` call rather than around the whole loop —
one entry's already-handled conflict must not stop the others from being dispatched.

### Alternative to a private read model: reading events directly

For a stateless, read-only lookup that doesn't need its own durable table, `KurrentDBClient` can be
`@Autowired`/constructor-injected directly to read another stream on demand (via the shared `EventStore`
helper) instead of maintaining a private projection. Reach for this only for genuinely occasional,
non-hot-path lookups — a private JPA read model built incrementally (above) is the default, well-trodden
choice for anything on the automation's main dispatch path.

## Step 5: Feature flags (optional)

Same house convention as `build-state-change`/`build-state-view` — see
[references/feature-flag-patterns.md](references/feature-flag-patterns.md). **Enable both the
automation and its target command's write slice** in any test that exercises the automation end-to-end.

## Step 6: Implement tests

Same principle as `build-state-view`: split the reacting logic out as its own package-private method
(`react`/`onSetupEvent` above) specifically so a test can call it directly, bypassing
`@PostConstruct`/subscribe/ack/the persistent-subscription machinery entirely.

**Stateless automation** — a plain unit test with the real target `*Handling` (which itself needs only
a real or Testcontainers-backed `EventStore`, no Spring context — see `build-state-change`'s
[references/integration-test-patterns.md](../build-state-change/references/integration-test-patterns.md)):

```java
class {AutomationName}HandlingTest {

    static GenericContainer<?> kurrentdb = /* same Testcontainers setup as build-state-change's
                                                integration-test-patterns.md */;
    static {AutomationName}Handling automation;

    @BeforeAll
    static void setUp() {
        kurrentdb.start();
        var eventStore = new EventStore(/* KurrentDBClient pointed at the container */);
        automation = new {AutomationName}Handling(null, new {TargetSlice}Handling(eventStore));
    }

    @Test
    void conditionMet_dispatchesCommand() {
        var event = new {TriggerEvent}("entity-1" /*, fields that meet the condition */);

        automation.react(event); // package-private, called directly — no subscription needed

        // assert via the target stream, e.g. eventStore.read(...) and check the expected event landed
    }

    @Test
    void redeliveredEvent_doesNotThrow() {
        var event = new {TriggerEvent}("entity-1" /*, fields that meet the condition */);

        automation.react(event); // first delivery
        automation.react(event); // simulated redelivery — must not throw
    }
}
```

Passing `null` for the `KurrentDBPersistentSubscriptionsClient` constructor argument is safe here
because `react`/`onSetupEvent` never touch it — only `@PostConstruct start()` does, and the test never
calls that.

**Automation with a private read model** — use `@DataJpaTest` + `@Import` + Testcontainers Postgres
(see `build-state-view`'s Step 5), constructing the automation directly (not `@Autowired`) so its
`@PostConstruct` never runs in the test:

```java
@DataJpaTest
@Testcontainers
@Import({AutomationName}Entity.class)
class {AutomationName}HandlingTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    @Autowired
    private {AutomationName}Repository repository;

    @Test
    void setupThenTrigger_dispatchesForMatchingEntry() {
        var automation = new {AutomationName}Handling(null, targetHandlingStub(), repository);

        automation.onSetupEvent(new {SetupEvent}("entity-1", 42L));
        automation.react(new {TriggerEvent}("entity-1"));

        // assert the target stream received the expected command's resulting event
    }
}
```

### Test cases to cover

**Stateless automations:**
1. Condition met → expected command dispatched (assert via the target stream's resulting event)
2. Condition not met → no command dispatched
3. Redelivered trigger event (target already handled) → the target's idempotency exception is
   swallowed, `react` does not throw

**Automations with a read model:**
1. Setup + trigger with a matching entry → command dispatched for that entry
2. Setup + trigger with no matching entry → no command dispatched (or however the slice defines that
   case)
3. Temporal ordering: only entries set up *before* the trigger are found — reflects that both methods
   are reached through the same subscription group and therefore see events in commit order

### Mapping GWT scenarios to tests

| GWT Element | Test code |
|---|---|
| Event in Given | `automation.onSetupEvent(new Event(...))` (read-model phase) or direct setup |
| Command in Then | assert the target stream's resulting event landed |
| NOTHING in Then | assert the target stream is unchanged / still empty |

### Storyline-Derived Tests (Optional)

`slice.json` may also carry a `storylines[]` array — narrated walkthroughs with an ordered
`elements[]` "beats" sequence (EVENT/COMMAND/READMODEL/...). This is a secondary, supplementary
source; `specifications[]` above stays the primary and default source of test cases. Most slices
have no `storylines[]` — skip silently when there's nothing relevant.

Find a beat whose `type` is `EVENT` immediately followed by a `COMMAND` beat. That pair is a ready-made
test: `given` = the cumulative preceding `EVENT` beats (setup events) through the trigger beat, `then` =
the resulting event on the target stream, built from the command beat's fields — same shape as the
"Mapping GWT Scenarios to Tests" row above, just sourced from the storyline instead of
`specifications[]`.

If the beat following the trigger event isn't a COMMAND this automation dispatches (e.g. it's a
READMODEL or SCREEN beat), don't force a test — leave it undocumented rather than fabricating an
assertion.

## References

- [Feature Flag Patterns](references/feature-flag-patterns.md) — `@ConditionalOnProperty`
- [Idempotent Command Dispatch](references/idempotent-dispatch-patterns.md) — the full decision table for which exception to catch, and why swallowing it locally matters

---

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] The trigger event in the automation matches the trigger event in slice.json exactly
- [ ] The command dispatched matches the target command defined in slice.json
- [ ] All fields mapped from trigger event (or private read model) to command come from slice.json — no invented mappings
- [ ] The dispatch call is wrapped to swallow the target's specific "already done" exception — never left to propagate
- [ ] If a private read model is used: it is private to this slice, and both event-handling methods are reached through the same subscription group
- [ ] Every new event's type name is registered in `{Context}EventTypes`
- [ ] Every GWT scenario in `specifications[]` maps to a test case, including a redelivery/idempotency-swallowed case
- [ ] If `storylines[]` is present: every trigger-EVENT→target-COMMAND beat pair for this automation has a storyline test — or was deliberately skipped as untraceable
- [ ] No filtering conditions were invented — all conditions come from slice.json `description` or `comments`
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
