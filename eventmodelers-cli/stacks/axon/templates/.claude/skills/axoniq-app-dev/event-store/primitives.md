# Event Store Primitives — AF5 Reference

This is the API reference for the low-level event store primitives used in DCB command decision models. For the pattern and reasoning, see the **`commands/decision-models-dcb.md` guide**.

---

## EventStore / EventStoreTransaction

`EventStore` is injected into command handlers. All reads and writes go through a **transaction** bound to the current `ProcessingContext` (unit of work).

```java
EventStoreTransaction tx = eventStore.transaction(processingContext);
```

The transaction tracks every `SourcingCondition` you use and the position reached. At commit, it derives the `AppendCondition` automatically — you do not construct one by hand in normal usage.

### `EventStoreTransaction` methods

```java
// Source events matching a condition (returns a finite stream ending with TerminalEventMessage)
MessageStream<? extends EventMessage> source(SourcingCondition condition)

// Source with a callback that receives the resume position after the stream is consumed
MessageStream<? extends EventMessage> source(SourcingCondition condition,
                                             Consumer<Position> resumePositionCallback)

// Stage an event for atomic append on commit
void appendEvent(EventMessage eventMessage)

// The ConsistencyMarker representing the position after the last sourced event
ConsistencyMarker appendPosition()

// 5.2.0+: replace/adjust the AppendCondition derived from sourcing, applied at commit
void overrideAppendCondition(UnaryOperator<AppendCondition> conditionOverride)
```

`appendPosition()` advances every time you fully consume a sourced stream. It reflects "I have read up to here" and is used by the transaction to detect concurrent writes at commit.

`overrideAppendCondition(...)` (5.2.0+) receives the condition the transaction calculated from your `source(...)` calls (or `AppendCondition.none()` if nothing was sourced) and returns the condition to use instead; multiple calls compose. Two intended uses: enforcing a consistency boundary **without sourcing first** (start from `AppendCondition.none()` and set criteria with `AppendCondition.withCriteria(...)` — checked against the whole store), and **narrowing** a broadly-sourced condition to just the criteria that represent real conflicts via `condition.replaceCriteria(...)` (the sourced marker is preserved). Returning `AppendCondition.none()` bypasses conflict detection entirely.

> `source(...)` hands back a `MessageStream<? extends EventMessage>`. Consume it by folding with `reduce` over its `Entry` items (`entry.message()` gives the `EventMessage`) — see `foundations/message-streams.md` for the full stream API. It is **not** a `Flux`.

---

## SourcingCondition

Selects which events to load from the store.

```java
import org.axonframework.eventsourcing.eventstore.SourcingCondition;

// Load all matching events from the beginning of the store
SourcingCondition.conditionFor(EventCriteria criteria)

// Resume from a saved position (e.g., after a snapshot)
SourcingCondition.conditionFor(Position startPosition, EventCriteria criteria)

// Union of two conditions (either criteria, minimum start position)
SourcingCondition a = SourcingCondition.conditionFor(critA);
SourcingCondition b = SourcingCondition.conditionFor(critB);
SourcingCondition combined = a.or(b);
```

---

## EventCriteria

Defines which events to include, based on their tags.

```java
import org.axonframework.messaging.eventstreaming.EventCriteria;

// Events tagged with course=XYZ  (AND within one criterion)
EventCriteria criteria = EventCriteria.havingTags("course", "XYZ");

// Events tagged with BOTH course=XYZ AND seat=42
EventCriteria criteria = EventCriteria.havingTags("course", "XYZ", "seat", "42");

// Events matching EITHER criterion  (OR between criteria)
EventCriteria criteria = EventCriteria
        .havingTags("course", "XYZ")
        .or()
        .havingTags("student", "alice");

// Using Tag objects directly
EventCriteria criteria = EventCriteria.havingTags(new Tag("course", "XYZ"));

// No tag filter — match any event
EventCriteria criteria = EventCriteria.havingAnyTag();
```

---

## Tag and @EventTag

Tags are stored with events at write time. Declare them on event payload fields or methods:

```java
import org.axonframework.eventsourcing.annotation.EventTag;

record CourseCreated(
        @EventTag(key = "course") String courseId,   // → Tag("course", courseId)
        String name,
        int capacity
) {}

record StudentEnrolled(
        @EventTag(key = "course") String courseId,
        @EventTag(key = "student") String studentId  // → Tag("student", studentId)
) {}
```

Rules:
- `key` defaults to the field name when omitted: `@EventTag String id` → `Tag("id", id)`
- On a `List` or `Set` field, one tag is created per element: `@EventTag List<String> items` → `Tag("items", "a"), Tag("items", "b"), ...`
- On a `Map<String,String>` field, each entry becomes a tag: `@EventTag Map<String,String> meta` → `Tag("k1", "v1"), Tag("k2", "v2"), ...`
- `@EventTag` can be placed on methods (getters) as well as fields

The default `AnnotationBasedTagResolver` processes these at append time. Register it in your configuration if it is not already the default.

---

## AppendCondition

`AppendCondition` specifies the consistency contract at append time. You normally let `EventStoreTransaction` derive this automatically from your sourcing. Use `AppendCondition` directly when working at the `EventStorageEngine` level.

```java
import org.axonframework.eventsourcing.eventstore.AppendCondition;

// No consistency check — always succeeds
AppendCondition.none()

// Fail if any event matching `criteria` was appended after `marker`
AppendCondition.withCriteria(EventCriteria criteria)
               .withMarker(ConsistencyMarker marker)

// Check two independent boundaries (OR of criteria, but the marker covers both)
AppendCondition.withCriteria(critA)
               .withMarker(marker)
               .orCriteria(critB)
```

---

## ConsistencyMarker

Represents a point in the event stream. Used to declare "I read up to here; fail if matching events appeared after this point."

```java
import org.axonframework.eventsourcing.eventstore.ConsistencyMarker;

// Any existing matching event is a conflict — use for "must not exist yet" checks
ConsistencyMarker.ORIGIN

// No events are a conflict — use for unconditional appends
ConsistencyMarker.INFINITY

// Combine two markers: take the earlier one (conservative — catches conflicts on either boundary)
ConsistencyMarker combined = markerA.lowerBound(markerB);

// Take the later one (only conflicts if BOTH boundaries were written after)
ConsistencyMarker combined = markerA.upperBound(markerB);
```

`lowerBound` is almost always the right choice when crossing multiple boundaries. It means: "treat any write on either boundary as a conflict."

### Extracting from a stream (advanced)

When not using `EventStoreTransaction`, extract the marker manually from the terminal stream entry:

`MessageStream` has no `collect`; fold the stream with `reduce` (see `foundations/message-streams.md`). The `ConsistencyMarker` rides on the terminal entry's resources, so you can capture it directly during the fold:

```java
ConsistencyMarker marker = stream
        .reduce((ConsistencyMarker) null,
                // only the terminal entry carries the marker; preceding entries return null
                (last, entry) -> {
                    ConsistencyMarker m = entry.getResource(ConsistencyMarker.RESOURCE_KEY);
                    return m != null ? m : last;
                })
        .orTimeout(30, TimeUnit.SECONDS).join();
```

The terminal entry always has `TerminalEventMessage.INSTANCE` as its message and a non-null `ConsistencyMarker` in its resources. All preceding entries have a null marker.

---

## AppendEventsTransactionRejectedException

Thrown (wrapped in `CompletionException`) when the event store detects that a conflicting event was appended after the marker used in the `AppendCondition`. The command must be retried: re-source the decision state and re-evaluate the business rules.

```java
try {
    tx.appendEvent(event);
    // ... commit happens at ProcessingContext close
} catch (AppendEventsTransactionRejectedException e) {
    // A concurrent write beat us — retry the whole command
}
```

---

## Position

Used to resume sourcing without replaying events from the beginning, e.g., after loading a snapshot.

```java
import org.axonframework.eventsourcing.eventstore.Position;
import org.axonframework.eventsourcing.eventstore.GlobalIndexPosition;

// Beginning of the store
Position.START

// A specific global index
new GlobalIndexPosition(42L)

// From a consistency marker (after sourcing)
Position resumePos = marker.position();
```

Store the `Position` alongside a snapshot. On next load, pass it as the start of `SourcingCondition.conditionFor(position, criteria)` to skip already-applied events.
