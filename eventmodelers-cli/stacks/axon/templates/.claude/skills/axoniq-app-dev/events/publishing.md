# Event Publishing in Axon Framework 5

Publishing is the starting point of every event: it must be published before any handler can react to it. AF5 offers two high-level APIs, and which one you reach for depends on *where* you are publishing from. Inside a `@CommandHandler` use the **`EventAppender`**; from anywhere else (REST endpoints, scheduled jobs, other message handlers) use the **`EventGateway`**. Both ultimately hand events to an `EventSink`.

This guide covers both, plus the low-level `EventSink`/`EventBus`/`EventStore` interfaces and how publication ties into the processing context. See also [commands/stateless.md](../commands/stateless.md) for the `EventAppender` inside command handlers, [events/handling-projections.md](handling-projections.md) for the consuming side, and [foundations/messages-and-processing-context.md](../foundations/messages-and-processing-context.md) for the `ProcessingContext` model.

---

## Which API to use

| You are publishing from... | Use | Why |
|---|---|---|
| A `@CommandHandler` on an entity | `EventAppender` (parameter) | Ties events to the entity, tags them, and joins the command's unit of work automatically |
| A REST controller, scheduled task, integration adapter | `EventGateway` (no context) | Fire-and-forget; returns a `CompletableFuture<Void>` you can await |
| Inside another `@EventHandler` / `@QueryHandler` | `EventGateway` (with `ProcessingContext`) | Preserves correlation/causation data and joins the active lifecycle |
| Advanced infrastructure control | `EventSink` / `EventBus` / `EventStore` | You build the `EventMessage` yourself |

> **Rule of thumb**: prefer `EventAppender` and `EventGateway` at all times. The low-level interfaces exist for infrastructure and framework extension, not everyday application code.

---

## EventAppender — inside a command handler

The entity's `@CommandHandler` is the natural origin of events: the event is the notification that a decision was made. Declare an `EventAppender` parameter and Axon injects one bound to the current `ProcessingContext`.

```java
import org.axonframework.eventsourcing.annotation.EventSourcedEntity;
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;

@EventSourcedEntity(tagKey = "courseId")
class CourseCreation {

    @CommandHandler
    static void handle(CreateCourse command, EventAppender appender) {
        appender.append(new CourseCreated(command.courseId(),
                                          command.name(),
                                          command.capacity()));
    }

    @EntityCreator
    CourseCreation() {
    }
    // omitted: state and @EventSourcingHandler methods
}
```

When declared as a command-handler parameter the `EventAppender` is provided by the framework. It automatically:

1. Uses the current `ProcessingContext`, ensuring transactionality and correlation-data propagation.
2. Attaches the entity identifier (via tags) to the event.
3. Publishes the event to the entity's own event-sourcing handlers (needed to evolve state).
4. Publishes the event to the `EventSink`.

Events are *staged*, not published immediately: they are dispatched when the processing context commits, so they never escape if the command fails.

### Appending multiple events

`append(Object...)` and `append(List<?>)` both accept a batch:

```java
@CommandHandler
static void handle(CreateCourse command, EventAppender appender) {
    appender.append(
            new CourseCreated(command.courseId(), command.name(), command.capacity()),
            new CourseActivated(command.courseId())
    );
}
```

### Appending with metadata

`EventAppender` overloads accept `Metadata` for a single event or a whole batch:

```java
import org.axonframework.messaging.core.Metadata;
import java.util.List;
import java.util.Map;

@CommandHandler
static void handle(CreateCourse command, EventAppender appender) {
    Metadata metadata = Metadata.from(Map.of("issuedBy", "admin-service"));

    // Single event with metadata
    appender.append(new CourseCreated(command.courseId(),
                                      command.name(),
                                      command.capacity()), metadata);

    // ...or the same metadata applied to every event in a batch
    appender.append(
            List.of(new CourseCreated(command.courseId(), command.name(), command.capacity()),
                    new CourseActivated(command.courseId())),
            metadata
    );
}
```

> **Merging behaviour**: if the supplied event is already an `EventMessage` carrying its own metadata, the provided `Metadata` is *merged* with the existing metadata, and your values win on key conflicts. If the event is a plain object, the metadata is set directly on the resulting `EventMessage`.

`EventAppender` methods:

| Method | Description |
|---|---|
| `append(Object... events)` | Stage one or more plain events |
| `append(List<?> events)` | Stage a list of events |
| `append(Object event, Metadata metadata)` | Stage one event with metadata |
| `append(List<?> events, Metadata metadata)` | Stage a batch, same metadata on each |

> **Obtaining one manually**: outside annotation injection, `EventAppender.forContext(processingContext)` returns the appender bound to that context (the same instance is reused per context).

---

## EventGateway — outside a command handler

When the publisher is not an entity — a service, a scheduled task, an HTTP endpoint, or another event handler — use the `EventGateway`. It wraps your plain event objects into `EventMessage` instances before handing them to the `EventSink`, and every method returns a `CompletableFuture<Void>`.

### Publishing without a ProcessingContext

From outside any message handler, call `publish` without a context. This is fire-and-forget; await the future to know the events were published.

```java
import org.axonframework.messaging.eventhandling.gateway.EventGateway;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.concurrent.CompletableFuture;

@RestController
class CourseController {

    private final EventGateway eventGateway;

    CourseController(EventGateway eventGateway) {
        this.eventGateway = eventGateway;
    }

    @PostMapping("/courses")
    CompletableFuture<Void> createCourse(@RequestBody CreateCourseRequest request) {
        return eventGateway.publish(List.of(
                new CourseCreated(request.courseId(), request.name(), request.capacity())));
    }
}
```

Because the API is async-native you can chain follow-up work or handle failures:

```java
CompletableFuture<Void> publish() {
    return eventGateway.publish(List.of(new CourseCreated("c-1", "Event Sourcing", 100)))
                       .thenRun(() -> log.info("published"))
                       .exceptionally(ex -> { log.error("publish failed", ex); return null; });
}
```

### Publishing with a ProcessingContext

From *within* another message handler, pass the active `ProcessingContext` so the publication joins the same lifecycle and correlation chain:

```java
import org.axonframework.messaging.core.unitofwork.ProcessingContext;
import org.axonframework.messaging.eventhandling.annotation.EventHandler;
import org.axonframework.messaging.eventhandling.gateway.EventGateway;

@EventHandler
void on(PaymentReceived event, ProcessingContext context, EventGateway eventGateway) {
    // ...validation / decision logic...
    eventGateway.publish(context, new BalanceUpdated(event.accountId(), event.amount()));
}
```

Providing the context ensures that correlation/causation IDs flow from one message to the next, the publication is part of the same processing lifecycle, and distributed tracing stays connected across boundaries.

`EventGateway` methods:

| Method | Description |
|---|---|
| `publish(List<?> events)` | Publish without a context (uses `null`) |
| `publish(ProcessingContext context, List<?> events)` | Publish within the given context (context may be `null`) |
| `publish(ProcessingContext context, Object... events)` | Varargs convenience overload |

---

## Publishing within an explicit unit of work

When you have no surrounding handler but still want transactional control, create a unit of work via the `UnitOfWorkFactory`, stage the publication in its invocation phase, and execute it:

```java
import org.axonframework.messaging.core.unitofwork.UnitOfWorkFactory;

var unitOfWork = unitOfWorkFactory.create();
unitOfWork.onInvocation(ctx -> eventGateway.publish(ctx,
        List.of(new CourseCreated(courseId, name, capacity),
                new CourseActivated(courseId))));
unitOfWork.execute().join();
```

When a `ProcessingContext` is supplied, the `EventSink` stages the events in the context's *post-invocation* phase, so they are published only when the unit of work commits. With no context, the events are published immediately and the returned future completes on publication.

---

## Low-level: EventSink, EventBus, EventStore

These interfaces give full control over the `EventMessage` but require you to build it yourself. Prefer the gateways above unless you are writing infrastructure.

- **`EventSink`** (`org.axonframework.messaging.eventhandling.EventSink`) — foundational publishing interface; operates on `EventMessage` instances.
- **`EventBus`** (`org.axonframework.messaging.eventhandling.EventBus`) — extends `EventSink`, adding publication to subscribed event handlers.
- **`EventStore`** (`org.axonframework.eventsourcing.eventstore.EventStore`) — combines a bus with durable storage.

```java
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.EventSink;
import org.axonframework.messaging.eventhandling.GenericEventMessage;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

class DirectPublisher {

    private final EventSink eventSink;

    DirectPublisher(EventSink eventSink) {
        this.eventSink = eventSink;
    }

    CompletableFuture<Void> publish() {
        EventMessage event = new GenericEventMessage(
                new MessageType(CourseCreated.class),
                new CourseCreated("c-1", "Event Sourcing", 100)
        ).withMetadata(Map.of("source", "import-job"));
        return eventSink.publish(null, event);   // null context = publish now
    }
}
```

`EventBus` and `EventStore` use the identical call shape (`publish(context, eventMessage)`); only the injected component type changes.

> **You can still hand an `EventMessage` to the gateways**: both `EventAppender` and `EventGateway` detect when the supplied object is already an `EventMessage` and will not re-wrap it. So you rarely need the low-level interfaces purely to control metadata.

> **Storage caveat**: event publication only results in *durable storage* when an event store is configured. Without one, events are delivered to handlers but not persisted.

---

## How publishing ties into the processing context

The behaviour of every publish call hinges on whether a `ProcessingContext` is present:

| Context present? | When events are published | What the future means |
|---|---|---|
| Yes (handler / unit of work) | Staged in the post-invocation phase, dispatched on commit | Future completes when events are *staged* |
| No (`null`) | Published immediately | Future completes when events are *published* |

This is why the `EventAppender` is the safe default inside command handlers: the context is always there, so events are only released if the command succeeds. The `EventGateway` gives you the same guarantee when you pass the context, and a simpler fire-and-forget mode when you do not. For the broader lifecycle and phase model, see [foundations/messages-and-processing-context.md](../foundations/messages-and-processing-context.md).

For tagging published events (essential for consistency boundaries and event sourcing), see the `@EventTag` and `TagResolver` documentation alongside the event store internals guide.
