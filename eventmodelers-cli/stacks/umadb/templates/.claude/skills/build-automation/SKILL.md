---
name: build-automation
authors:
  - Martin Dilger
description: >
  Implement automation slices (Event → Command) that react to events off the shared
  EventDispatcher subscription and dispatch a command by calling its command handler directly, in
  this project's one established pattern. Automations can be stateless (direct event-to-command
  mapping) or carry a private read model (to look up data needed for command construction). Use
  when implementing a new automation / event-to-command reactor from a slice.json event model in
  this project. There is exactly one supported style — do not offer alternatives.
---

# UmaDB — Automation Slice

An automation reacts to an event by dispatching a command. In Event Modeling: the **orange**
stripe. There are two kinds:

- **Stateless**: direct event-to-command mapping — no stored state needed. Grounded in the
  `AutoSubscribeToDefaultCourseProcessor` slice (test in
  `AutoSubscribeToDefaultCourseProcessorTest`) — verified, compiled and passing under `mvn test`,
  including end-to-end against a real `umadb/umadb:0.7.5` server (`UmaDbContainerIntegrationTest`):
  a real `CustomerRegistered` event, delivered by the real `EventDispatcher` subscription, really
  causes a real `SubscribeToCourse` command to be handled and its event really appended.
- **With private read model**: needs data NOT in the trigger event itself (e.g. iterating over all
  entities matching a category). Same shape as `build-state-change`'s Decision-with-fold pattern,
  applied to a private in-memory model instead of a Query/replay — documented below by direct
  analogy, not separately proven against a compiled example in this session; verify it compiles and
  its tests pass before considering it done, the same as any other slice.

There is no separate command-bus abstraction in this project (unlike Axon's
`CommandDispatcher`/`CommandGateway` split) — an automation dispatches by calling the target
command handler's `handle(...)` method directly, since it's just another Spring bean and the call
is in-process either way.

## Step 0: Discover Target Project Conventions

> **Comments & description**: each element carries a `comments: string[]` array (board comments)
> and a `description` field — use them as implementation hints, and resolve consumed comments via
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

Read the target project's `.build-kit/CLAUDE.md` and explore existing slices.

**Determine `{basePackage}`** — every path below is rooted at
`{basePackage}.slices.{context}.automation.{slicename}`. Resolve `{basePackage}` as documented in
`.build-kit/CLAUDE.md`.

## Step 1: Understand the Input

Extract these elements from slice.json (or whatever Event Modeling artifact is given):

| Element                | What to extract                                                        |
|-------------------------|-------------------------------------------------------------------------|
| **Trigger event**      | Which event triggers the automation, and which condition filters it     |
| **Target command**     | Which command to dispatch, with what properties                         |
| **Mapping logic**      | How event properties map to command properties                          |
| **Read model needed?** | Does the automation need data NOT in the trigger event itself?          |

If the slice details include `## Scenarios (GWTs)`, use them to derive test cases. GWT format for
automations: `Given (events) → Then (command | NOTHING)`. Events in Given include read-model-
building events first, trigger event last.

`slice.json` may also carry an optional `storylines[]` array — see the "Storyline-Derived Tests"
section under Step 4 for how a trigger-event beat in one of these can add a supplementary test.

**If requirements are unclear, invoke `/request-feedback` rather than guessing** — see
`.build-kit/CLAUDE.md`'s escalation rule.

## Step 2: Ensure Events Exist

All events the automation reacts to, and the target command it dispatches, must already exist. If
they don't, create the event first following `build-state-change` Step 2, and the target command's
whole slice following `build-state-change` in full (a command never exists without its slice).

## Step 3: Implement the Automation

### Stateless Automation

New automation slices live under `src/main/java/.../slices/{context}/automation/{slicename}/`.

```java
package {basePackage}.slices.{context}.automation.{slicename};

import io.umadb.client.Event;
import {basePackage}.eventstore.EventCodec;
import {basePackage}.eventstore.SliceEventListener;
import {basePackage}.slices.{context}.events.{TriggerEvent};
import {basePackage}.slices.{context}.{targetslicename}.{TargetCommand}Command;
import {basePackage}.slices.{context}.{targetslicename}.{TargetCommand}CommandHandler;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "slices.{context}.automation", name = "{slicename}.enabled")
public class {AutomationName}Processor implements SliceEventListener {

    private final {TargetCommand}CommandHandler targetCommandHandler;

    public {AutomationName}Processor({TargetCommand}CommandHandler targetCommandHandler) {
        this.targetCommandHandler = targetCommandHandler;
    }

    @Override
    public boolean supports(String eventType) {
        return {TriggerEvent}.TYPE.equals(eventType);
    }

    @Override
    public void onEvent(Event event) {
        react(EventCodec.fromEvent(event, {TriggerEvent}.class));
    }

    /** Called directly (no client, no dispatcher) by this class's own test - see Step 4. */
    public void react({TriggerEvent} event) {
        if (!shouldReact(event)) {
            return;
        }
        targetCommandHandler.handle(new {TargetCommand}Command(event.field1() /*, mapped fields */));
    }

    private boolean shouldReact({TriggerEvent} event) {
        return true; // replace with the actual condition from slice.json, if any
    }
}
```

**Idempotency**: `EventDispatcher` may redeliver a trigger event after an application restart (see
its Javadoc on quickstart-level checkpointing) — a re-dispatched command is safe as long as the
target command handler's own Decision already no-ops a repeat (verified: re-subscribing to the same
course a second time is rejected by `SubscribeToCourseDecision.alreadySubscribedToThisCourse`, not
by anything in the automation itself). Don't add your own idempotency guard in the automation
unless the target command handler genuinely can't provide one — check that first.

### Automation with Read Model

When the automation needs data not in the trigger event, add a private in-memory model — never
reuse another slice's read model.

```java
@Component
@ConditionalOnProperty(prefix = "slices.{context}.automation", name = "{slicename}.enabled")
public class {AutomationName}Processor implements SliceEventListener {

    // Private read model, indexed by entity id - belongs to this automation only
    private final Map<String, {AutomationName}Entry> store = new ConcurrentHashMap<>();

    private final {TargetCommand}CommandHandler targetCommandHandler;

    public {AutomationName}Processor({TargetCommand}CommandHandler targetCommandHandler) {
        this.targetCommandHandler = targetCommandHandler;
    }

    @Override
    public boolean supports(String eventType) {
        return {SetupEvent}.TYPE.equals(eventType) || {TriggerEvent}.TYPE.equals(eventType);
    }

    @Override
    public void onEvent(Event event) {
        if (event.type().equals({SetupEvent}.TYPE)) {
            onSetup(EventCodec.fromEvent(event, {SetupEvent}.class));
        } else if (event.type().equals({TriggerEvent}.TYPE)) {
            react(EventCodec.fromEvent(event, {TriggerEvent}.class));
        }
    }

    // Phase 1 - build the private read model from setup events
    public void onSetup({SetupEvent} event) {
        store.put(event.entityId(), new {AutomationName}Entry(event.entityId(), event.filterField()));
    }

    // Phase 2 - trigger: dispatch a command per matching entry
    public void react({TriggerEvent} event) {
        store.values().stream()
                .filter(entry -> entry.filterField().equals(event.filterValue()))
                .forEach(entry -> targetCommandHandler.handle(new {TargetCommand}Command(entry.entityId() /*, other fields */)));
    }

    record {AutomationName}Entry(String entityId, String filterField) {}
}
```

Key rules:

- **Two branches in one `onEvent`**: one builds the private model (`onSetup`), one reacts
  (`react`) — `supports` must answer true for both event types.
- Since `EventDispatcher` delivers events sequentially in position order to every listener on a
  single subscription thread (see its Javadoc), there is no concurrent-mutation race between
  `onSetup` and `react` to guard against here the way a multi-threaded processing group would need
  to — `ConcurrentHashMap` is a safety margin, not a requirement.
- **Private read model belongs to this automation only** — never share it with another slice.

## Step 4: Implement Tests

**Stateless automations** — pure unit test with a mocked target command handler (Mockito):

```java
package {basePackage}.slices.{context}.automation.{slicename};

import {basePackage}.slices.{context}.events.{TriggerEvent};
import {basePackage}.slices.{context}.{targetslicename}.{TargetCommand}Command;
import {basePackage}.slices.{context}.{targetslicename}.{TargetCommand}CommandHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class {AutomationName}ProcessorTest {

    @Mock
    private {TargetCommand}CommandHandler targetCommandHandler;

    private {AutomationName}Processor processor;

    @BeforeEach
    void setUp() {
        processor = new {AutomationName}Processor(targetCommandHandler);
    }

    @Test
    @DisplayName("given trigger event with condition met, then command dispatched")
    void happyPath() {
        processor.react(new {TriggerEvent}("entity-1" /*, fields that meet condition */));

        verify(targetCommandHandler).handle(new {TargetCommand}Command("entity-1" /*, expected fields */));
    }

    @Test
    @DisplayName("given trigger event with condition not met, then no command dispatched")
    void conditionNotMet() {
        processor.react(new {TriggerEvent}("entity-1" /*, fields that do NOT meet condition */));

        verifyNoInteractions(targetCommandHandler);
    }
}
```

If Mockito's inline mock maker reports a Byte Buddy / JDK-version incompatibility when mocking a
project class (seen on very recent JDKs, harmless), add
`-Dnet.bytebuddy.experimental=true` to the surefire `<argLine>` in `pom.xml` — this affects only
Mockito's own bytecode generation, not the code under test.

**Automations with read model** — call `onSetup`/`react` directly, same mocked-handler style, setup
events before trigger events:

```java
processor.onSetup(new {SetupEvent}("entity-1", "filter-A"));
processor.onSetup(new {SetupEvent}("entity-2", "filter-B"));

processor.react(new {TriggerEvent}("filter-A"));

verify(targetCommandHandler).handle(new {TargetCommand}Command("entity-1" /*, fields */));
verifyNoMoreInteractions(targetCommandHandler);
```

### Test Cases to Cover

**Stateless automations:**
1. Condition met → expected command dispatched
2. Condition not met → no command dispatched

**Automations with read model:**
1. Setup + trigger with matching filter → command dispatched for matching entries only
2. Setup + trigger with non-matching filter → no command dispatched
3. Temporal ordering: setup before trigger vs. setup after trigger → only entries that existed at
   trigger time receive a command

### Mapping GWT Scenarios to Tests

| GWT Element | Test Code |
|---|---|
| Event in Given | `processor.react(new Event(...))` (or `onSetup(...)` for a setup event) |
| Multiple events in Given | multiple calls — setup events first, trigger last |
| Command in Then | `verify(targetCommandHandler).handle(eq(expectedCommand))` |
| NOTHING in Then | `verifyNoInteractions(targetCommandHandler)` |

### Storyline-Derived Tests (Optional)

`slice.json` may also carry a `storylines[]` array — narrated walkthroughs with an ordered
`elements[]` "beats" sequence (EVENT/COMMAND/READMODEL/...). This is a secondary, supplementary
source; `specifications[]` above stays the primary and default source of test cases. Most slices
have no `storylines[]` — skip silently when there's nothing relevant.

Find a beat whose `type` is `EVENT` immediately followed by a `COMMAND` beat this automation
dispatches. That pair is a ready-made test: `given` = the cumulative preceding `EVENT` beats
(setup events) through the trigger beat, `then` = `verify(targetCommandHandler).handle(eq(...))`
built from the command beat's fields — same shape as the "Mapping GWT Scenarios to Tests" row
above, just sourced from the storyline instead of `specifications[]`.

If the beat following the trigger event isn't a COMMAND this automation dispatches, don't force a
test — leave it undocumented rather than fabricating an assertion.

## References

- [Feature Flag Patterns](references/feature-flag-patterns.md) — `@ConditionalOnProperty`, wired the same as `build-state-change`

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] The trigger event in the processor matches the trigger event in slice.json exactly
- [ ] The command dispatched matches the target command defined in slice.json
- [ ] All fields mapped from trigger event to command come from the event fields defined in slice.json — no invented mappings
- [ ] Every GWT scenario in `specifications[]` maps to a test case in the test class
- [ ] If `storylines[]` is present: every trigger-EVENT→target-COMMAND beat pair for this automation has a storyline test — or was deliberately skipped as untraceable
- [ ] No filtering conditions were invented — all conditions come from slice.json `description` or `comments`
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
