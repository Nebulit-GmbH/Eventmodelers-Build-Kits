# CommandHandlingTestFixture Cheat Sheet

`@CommandHandlingTest` (package `com.opencqrs.framework.command`, from the `framework-test` module) is a
narrow Spring test slice — it discovers this project's `@CommandHandlerConfiguration` classes, but never
touches EventSourcingDB, HTTP, or a real database. Inject one `CommandHandlingTestFixture<YourCommand>`
per test method via `@Autowired`.

## Given

| Call | Meaning |
|---|---|
| `.given().nothing()` | no prior events/state — the creation case |
| `.given().events(e1, e2, ...)` | replays these through your `@StateRebuilding` methods to build prior state. **Prefer this** — it exercises the same reconstruction path production uses |
| `.given().state(new WriteModel(...))` | injects prior state directly, bypassing `@StateRebuilding` entirely. Only reach for this when replaying realistic events is impractical |

## When

`.when(new YourCommand(...))` — executes the command handler under test.

## Then — outcome

- `.succeeds()` — command executed without throwing
- `.fails().throwing(ExceptionClass.class)` — asserts the exact exception type thrown

## Then — result value

`.succeeds().havingResult(expectedValue)` — asserts the command handler method's return value.
Chain this **before** `.allEvents()`/`.nextEvents()` if you also want to assert published events on the
same fixture call.

## Then — published events

Two complementary entry points:

- `.allEvents()` — operates on the complete captured event list, no cursor (fine for a fixture used once
  per test)
- `.nextEvents()` — a consuming cursor; use this if you called `.havingResult(...)` first and want to
  keep asserting on the same fixture

Matcher methods (call one of these on the result of `.allEvents()`/`.nextEvents()`):

| Method | Behavior |
|---|---|
| `.exactly(payload1, payload2, ...)` | events match the given payloads in order, by `Object.equals` — records make this a plain field-by-field match |
| `.single(consumer)` | exactly one event was captured, **and** it matches the consumer's assertion |
| `.once(consumer)` | exactly one event matches the consumer's predicate; other unrelated events may also exist |
| `.any(consumer)` | at least one event matches |
| `.every(consumer)` | every captured event matches |
| `.none(consumer)` | no event matches |

`consumer` typically uses one of:

- `e -> e.ofType(SomeEvent.class)` — type-only check
- `e -> e.asserting(a -> a.commandSubject().payloadType(SomeEvent.class))` — asserts the event's subject
  equals the command's subject, and its payload type
- `e -> e.asserting(a -> a.commandSubject().noMetaData().payloadType(SomeEvent.class))` — same, plus
  asserts no metadata was published with the event

## Mocking collaborators

Exactly like `@SpringBootTest` — `@MockitoBean` at the test class level:

```java
@CommandHandlingTest
class {SliceName}HandlingTest {

    @MockitoBean
    private SomeCollaborator someCollaborator;

    @Test
    void test(@Autowired CommandHandlingTestFixture<{SliceName}Command> fixture) {
        doReturn(someValue).when(someCollaborator).someMethod(any());
        // ...
    }
}
```

## What this fixture deliberately does NOT do

- No event upcasting, no event-type-string resolution — events are matched/compared as plain Java
  objects.
- No real event store — nothing is ever actually persisted.
- Command metadata propagation onto published events (the `opencqrs.metadata.propagation.keys`
  mechanism) is **not** exercised — this fixture only cares about the command handler's own logic.
- State caching is disabled — every `.when(...)` call rebuilds state from the given events/state fresh.
