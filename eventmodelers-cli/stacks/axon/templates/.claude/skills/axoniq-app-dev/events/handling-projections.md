# Event Handling in Axon Framework 5

Event handlers react to events published on the event bus or stored in the event store. The most common use is building **projections** (read models) and **reactions** (side effects like sending notifications).

---

## Writing an event handler

Annotate any method with `@EventHandler`. The first parameter type determines which event is matched.

```java
import org.axonframework.messaging.eventhandling.annotation.EventHandler;

class CoursesProjection {

    @EventHandler
    void on(CourseCreated event) {
        repository.save(new CourseView(event.courseId(), event.name(), event.capacity(), 0));
    }

    @EventHandler
    void on(CourseRenamed event) {
        repository.updateName(event.courseId(), event.newName());
    }

    @EventHandler
    void on(StudentEnrolled event) {
        repository.incrementEnrolment(event.courseId());
    }
}
```

### Resolved parameters

| Parameter | What you get |
|---|---|
| First param (any type) | Event payload — determines which event this handler receives |
| `@MetadataValue("key") String` | A single value from the event's metadata |
| `Metadata` | The full metadata map |
| `ProcessingContext` | The active processing context |
| `QueryUpdateEmitter` | Push updates to subscription query subscribers |
| `@Timestamp Instant` | The event's stored timestamp |

> **Event timestamp**: to inject the event's stored timestamp, annotate the `Instant` parameter with `@Timestamp` (`org.axonframework.messaging.eventhandling.annotation.Timestamp`). A plain `Instant` parameter without the annotation will fail to resolve at runtime.
> ```java
> @EventHandler
> void on(BidPlaced event, @Timestamp Instant timestamp) {
>     entity.lastBidPlacedAt = timestamp;
> }
> ```

```java
@EventHandler
void on(StudentEnrolled event,
        @MetadataValue("enrolledBy") String actor,
        QueryUpdateEmitter emitter) {
    var view = repository.incrementEnrolment(event.courseId());
    // Push live update to any open subscription queries
    emitter.emit(GetCourseStats.class,
                 q -> q.courseId().equals(event.courseId()),
                 view);
}
```

---

## Publishing events

Use `EventGateway` to publish events from outside a command handler (e.g., from a scheduled job or integration adapter):

```java
// Simple fire-and-forget
eventGateway.publish(new CourseCreated(courseId, name, capacity)).join();

// Publishing within an explicit unit of work (preferred when you need transactional control)
var uow = unitOfWorkFactory.create();
uow.onInvocation(ctx -> eventGateway.publish(ctx,
        new CourseCreated(courseId, name, capacity),
        new CourseActivated(courseId)));
uow.execute().join();
```

Within a `@CommandHandler` method, prefer `EventAppender` (injected as a parameter) — it ties the append to the command's unit of work automatically.

---

## Event processors

AF5 provides two processor types. Choose based on your consistency and scalability needs.

### SubscribingEventProcessor

Processes events **synchronously in the publishing thread**. The event handler runs in the same transaction as the command that published the event.

- Simple to reason about: if the command commits, the projection updated
- No tracking token or replay support
- Best for: projections that must be consistent with the write side, simple in-process use cases

### PooledStreamingEventProcessor

Reads events from the event store using a **tracking token**, processing them asynchronously in a thread pool.

- Independent of the write side; slight lag
- Supports **replay**: reset the token to replay all events and rebuild the projection
- Supports **segmented parallelism** across multiple nodes
- Built-in dead letter queue support
- Best for: scalable projections, cross-service event consumption, rebuilding read models

---

## Replay control

### @AllowReplay / @DisallowReplay

By default all `@EventHandler` methods are replayed when a processor resets. Opt specific handlers out:

```java
class CoursesProjection {

    @EventHandler
    void on(CourseCreated event) {
        // replayed by default — safe for read model rebuilds
        repository.save(new CourseView(event.courseId(), event.name()));
    }

    @DisallowReplay
    @EventHandler
    void on(StudentEnrolled event) {
        // NOT replayed — e.g. this sends a welcome email
        emailService.sendWelcome(event.studentId());
    }
}

// Class-level default: block replay on all handlers in this class,
// then explicitly allow specific ones
@DisallowReplay
class NotificationHandler {

    @EventHandler
    void on(CourseCreated event) { /* blocked */ }

    @AllowReplay(true)
    @EventHandler
    void on(CourseRenamed event) { /* allowed */ }
}
```

### @ResetHandler

Called before replay begins. Use it to clear the projection so it can be rebuilt cleanly:

```java
import org.axonframework.messaging.eventhandling.replay.annotation.ResetHandler;

class CoursesProjection {

    @ResetHandler
    void onReset() {
        repository.deleteAll();
    }

    @EventHandler
    void on(CourseCreated event) {
        repository.save(new CourseView(event.courseId(), event.name()));
    }
}
```

---

## Sequencing policies

Sequencing policies control which events are processed concurrently within a `PooledStreamingEventProcessor`.

```java
import org.axonframework.messaging.core.annotation.SequencingPolicy;
import org.axonframework.messaging.core.sequencing.PropertySequencingPolicy;
import org.axonframework.messaging.core.sequencing.FullConcurrencyPolicy;

// All events with the same courseId processed sequentially — safe for per-entity projections
@SequencingPolicy(type = PropertySequencingPolicy.class, parameters = {"courseId"})
class CoursesProjection { ... }

// All events processed concurrently — use only if handlers are truly independent
@SequencingPolicy(type = FullConcurrencyPolicy.class)
class StatisticsProjection { ... }
```

Available policies:

| Policy | Behaviour |
|---|---|
| `SequentialPerAggregatePolicy` | Sequential per aggregate identifier |
| `PropertySequencingPolicy` | Sequential per payload field value |
| `MetadataSequencingPolicy` | Sequential per metadata key value |
| `FullConcurrencyPolicy` | All concurrent |
| `SequentialPolicy` | All sequential (single-threaded) |

The default is a `HierarchicalSequencingPolicy` that tries `SequentialPerAggregatePolicy` first and falls back to `SequentialPolicy`. **In a DCB context this matters:** DCB events carry tags, not an aggregate identifier, so `SequentialPerAggregatePolicy` returns `Optional.empty()` for every event and the fallback `SequentialPolicy` always wins — meaning the processor runs all events single-threaded in one segment. `SequentialPerAggregatePolicy` is effectively a no-op here. Always set an explicit policy (e.g. `PropertySequencingPolicy` keyed on your projection's identity field) to get any concurrency.

---

## Dead letter queue

Configure a DLQ on a `PooledStreamingEventProcessor` to park events that fail processing instead of halting the processor. DLQ support is part of **Axon Framework 5** (open source) — no additional dependencies needed.

```java
import org.axonframework.messaging.deadletter.Decisions;
import org.axonframework.messaging.eventhandling.deadletter.DeadLetterQueueConfiguration;

configurer.eventProcessing(ep -> ep
    .pooledStreaming(ps -> ps
        .processor("courses-projection",
            components -> components.declarative("courses-handler",
                                                 c -> new CoursesProjection(repository)))
        .customized((cfg, c) -> c
            .extend(DeadLetterQueueConfiguration.class, () -> new DeadLetterQueueConfiguration()
                .enabled()
                .enqueuePolicy((letter, cause) -> {
                    if (cause instanceof TransientException) return Decisions.enqueue(cause);
                    return Decisions.doNotEnqueue();   // discard permanent failures
                })
                .clearOnReset(true)    // wipe DLQ when processor resets/replays
            )
        )
    )
);
```

The default `factory` creates an `InMemorySequencedDeadLetterQueue`. For persistence across restarts, switch to a JDBC or JPA-backed queue:

```java
import org.axonframework.messaging.eventhandling.deadletter.jdbc.JdbcSequencedDeadLetterQueue;

.extend(DeadLetterQueueConfiguration.class, () -> new DeadLetterQueueConfiguration()
    .enabled()
    .factory((processingGroup, config) ->
        JdbcSequencedDeadLetterQueue.builder()
            .processingGroup(processingGroup)
            .dataSource(dataSource)
            .transactionManager(transactionManager)
            .build())
)
```

Or with JPA:

```java
import org.axonframework.messaging.eventhandling.deadletter.jpa.JpaSequencedDeadLetterQueue;

.extend(DeadLetterQueueConfiguration.class, () -> new DeadLetterQueueConfiguration()
    .enabled()
    .factory((processingGroup, config) ->
        JpaSequencedDeadLetterQueue.builder()
            .processingGroup(processingGroup)
            .entityManagerProvider(entityManagerProvider)
            .transactionManager(transactionManager)
            .build())
)
```

`Decisions` utility (`org.axonframework.messaging.deadletter.Decisions`):

| Method | Meaning |
|---|---|
| `Decisions.enqueue(cause)` | Park the event with the given cause |
| `Decisions.enqueue()` | Park without a cause |
| `Decisions.doNotEnqueue()` | Discard — do not park, move on |
| `Decisions.evict()` | Remove from queue (used during reprocessing) |
| `Decisions.ignore()` | Leave in queue unchanged (used during reprocessing) |
| `Decisions.requeue(cause)` | Return to queue with updated cause (used during reprocessing) |

---

## Registering event handlers

```java
MessagingConfigurer.create()
    .eventProcessing(ep -> ep
        .subscribing(sub -> sub
            .processor("courses-subscribing",
                       components -> components.declarative(
                           "courses-handler",
                           config -> new CoursesProjection(repository))))
        .pooledStreaming(pool -> pool
            .processor("courses-streaming",
                       components -> components.declarative(
                           "courses-projection",
                           config -> new CoursesProjection(repository))))
    );
```

Use **subscribing** when you need transactional consistency with the command side.  
Use **pooled streaming** when you need replay, independent scaling, or DLQ support.
