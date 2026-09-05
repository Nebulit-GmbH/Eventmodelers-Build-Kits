# UmaDB Query, AppendCondition & Test Fake — Cheat Sheet

Verified against `io.github.domenicdev:umadb-java-client:0.7` (package `io.umadb.client`) and a real
`umadb/umadb:0.7.5` server (Testcontainers), and against the `RegisterCustomer`/`SubscribeToCourse`
slices this pattern was built from.

## `Query` / `QueryItem` matching semantics

A `Query` is a list of `QueryItem`s. **Items are OR'd together** - an event matches the query if it
matches ANY item. Within one item:

- `types` (OR): event matches if `types` is empty, or the event's `type()` is one of them
- `tags` (AND): event matches if `tags` is empty, or the event's `tags()` contains ALL of them
- an item matches only if BOTH the type condition and the tag condition match

An **empty `Query`** (`Query.empty()`, or `Query.of(List.of())`) matches every event - never pass
`null`/empty expecting "match nothing".

```java
// "CustomerRegistered for this email" OR "SubscribedToCourse for this email+courseId"
Query.of(List.of(
    QueryItem.of(List.of(CustomerRegistered.TYPE), List.of(EventTags.tag(EventTags.EMAIL, email))),
    QueryItem.of(List.of(SubscribedToCourse.TYPE), List.of(
            EventTags.tag(EventTags.EMAIL, email), EventTags.tag(EventTags.COURSE_ID, courseId)))
));
```

**Tag scope is a property of the rule, not the event type.** The same event type can legitimately
need a wider or narrower tag set depending on which decision is consuming it - see
`SubscribeToCourseDecision.relevantEvents` (`build-state-change` Step 3): `CustomerRegistered` is
scoped to `email` alone (the rule is "registered at all"), but `SubscribedToCourse` is scoped to
`email` AND `courseId` together (the rule is "subscribed to THIS course", not "subscribed to any
course"). Getting this wrong doesn't fail loudly - too wide silently pulls in unrelated events, too
narrow silently drops events the rule needed.

## `AppendCondition` - the actual consistency boundary

```java
AppendCondition.failIfExistsAfter(query, lastPosition)
```

Fails the append (throws `UmaDbException.IntegrityException`) if any event matching `query` exists
at a position **strictly greater than** `lastPosition` - i.e. appeared after the position this
command's `DecisionModelLoader.load` call observed via `getHeadPosition()`. Always pass the SAME
query used to load the decision - a narrower/different query here silently weakens the consistency
guarantee (a conflicting write could slip through undetected).

`DecisionModelLoader.append` already wraps this and translates the exception into
`OptimisticConcurrencyException` - don't call `AppendCondition`/`client.handle(AppendRequest...)`
directly from a command handler; use the loader.

**Idempotency**: appending an `Event` whose `id` (a `UUID`) already exists in the store is a no-op
that returns the existing position, regardless of any condition - verified against the client's own
`UmaDbClientTest#testIdempotentAppendReturnsSamePosition`. `Event.of(...)` generates a random id per
call, so this only matters if you're deliberately re-sending the exact same `Event` instance/id for
retry safety - not something a normal command handler needs to think about.

## Testing: `InMemoryUmaDbClient`, not a fixture DSL

UmaDB has no test-fixture library (unlike `axon-test`'s `AxonTestFixture`). This project's
`src/test/java/.../testsupport/InMemoryUmaDbClient` (shipped in the root scaffold) is a from-scratch
`UmaDbClient` implementation replicating the matching/condition/idempotency rules above, fast and
container-free. Write given/when/then as plain JUnit, not through a fixture DSL:

```java
var loader = new DecisionModelLoader(new InMemoryUmaDbClient());
var commandHandler = new RegisterCustomerCommandHandler(loader);

// given no prior activity, when registerCustomer, then succeeds
assertThatNoException().isThrownBy(() -> commandHandler.handle(new RegisterCustomerCommand(...)));
```

`InMemoryUmaDbClient.subscribe(...)` deliberately throws `UnsupportedOperationException` - no
command-handler test needs it (that's `build-state-view`/`build-automation`'s territory, tested via
a direct `on(event)` call instead - see those skills). The one thing that genuinely needs a live
subscription (`EventDispatcher` itself) is proven against a REAL `umadb/umadb` server via
Testcontainers instead - see `build-state-view`'s reference integration test. Don't try to make the
fake support subscription; use the real container for that one case.
