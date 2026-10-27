# Supported Handler Parameters in Axon Framework 5

Annotated message handlers (`@CommandHandler`, `@EventHandler`, `@QueryHandler`, `@EventSourcingHandler`) declare the data and collaborators they need as method parameters. The framework resolves each one through a `ParameterResolver`, produced by a `ParameterResolverFactory`. This guide is the reference for the parameters AF5 resolves out of the box.

For the annotations themselves see `foundations/annotations.md`. To register your own resolver for a type not listed here, see `foundations/handler-customization.md`. Handler-specific usage lives in `commands/stateless.md` and `events/handling-projections.md`.

> The **first parameter** of any handler is always the message **payload**, matched by type. Everything else is matched by type and/or annotation, in any order, after the payload.

---

## Universal parameters

These resolve on every annotated message handler regardless of message type.

| Parameter | Package | Resolves to |
|---|---|---|
| First parameter (any type) | — | The message **payload** |
| `Message` / `CommandMessage` / `EventMessage` / `QueryMessage` | `org.axonframework.messaging.*` (`.core`, `.commandhandling`, `.eventhandling`, `.queryhandling`) | The full message: payload + metadata + identifier |
| `Metadata` | `org.axonframework.messaging.core` | The complete metadata map of the message |
| `@MetadataValue("key") <T>` | `org.axonframework.messaging.core.annotation` | A single metadata value under `key` |
| `@MessageIdentifier String` | `org.axonframework.messaging.core.annotation` | The identifier of the handled message |
| `ProcessingContext` | `org.axonframework.messaging.core.unitofwork` | The active processing context (unit of work) |
| Spring bean | — | Any bean, when running under Spring; narrow with `@Qualifier` |

```java
import org.axonframework.messaging.core.Metadata;
import org.axonframework.messaging.core.annotation.MetadataValue;
import org.axonframework.messaging.core.annotation.MessageIdentifier;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;

@CommandHandler
void handle(EnrollStudent command,                       // payload
            @MetadataValue("userId") String actorId,     // one metadata value
            Metadata metadata,                           // the whole map
            @MessageIdentifier String commandId,         // message identifier
            ProcessingContext context) {                 // unit of work
    // ...
}
```

> **`@MetadataValue` and `required`.** `required` defaults to `false`, so a missing key injects `null`. Set `required = true` to *skip* the handler entirely when the key is absent. For a primitive parameter type, `required` is always treated as `true` (a primitive cannot be `null`).

```java
@EventHandler
void on(OrderPlaced event,
        @MetadataValue(value = "tenantId", required = true) String tenantId) {
    // only invoked when 'tenantId' metadata is present
}
```

### Message vs. payload as first parameter

To take `Message`/`CommandMessage`/`EventMessage`/`QueryMessage` as the *first* parameter (instead of the payload type), the handler must declare the message name explicitly — otherwise the framework cannot derive which message the handler is for:

```java
@CommandHandler(commandName = "faculty.RenameCourse")
void handle(CommandMessage message) {
    RenameCourse payload = (RenameCourse) message.payload();
    // ...
}
```

Prefer declaring the payload type first and adding the message as a second parameter when you need both.

---

## Command handler parameters

`@CommandHandler` methods resolve the universal parameters above, plus:

| Parameter | Package | Resolves to |
|---|---|---|
| `EventAppender` | `org.axonframework.messaging.eventhandling.gateway` | Appender for publishing events from the handler |
| `CommandDispatcher` | `org.axonframework.messaging.commandhandling.gateway` | Dispatcher for sending follow-up commands |
| `@InjectEntity <StateType>` | `org.axonframework.modelling.annotation` | The event-sourced entity/state, loaded for this command |

```java
import org.axonframework.messaging.eventhandling.gateway.EventAppender;
import org.axonframework.modelling.annotation.InjectEntity;

@CommandHandler
void handle(ChangeCourseCapacity command,
            @InjectEntity State state,   // current decision state, sourced from events
            EventAppender events) {
    if (command.newCapacity() < state.subscribedStudents())
        throw new IllegalStateException("Capacity below current subscriptions");
    events.append(new CourseCapacityChanged(command.courseId(), command.newCapacity()));
}
```

> `EventAppender` and `CommandDispatcher` are *processing-context aware*: events appended and commands dispatched through them automatically carry correlation data derived from the current message. See `commands/stateless.md` for `EventAppender` and `commands/dispatching.md`-style usage.

> `@InjectEntity` resolves the entity id from the payload's `@TargetEntityId` member by default (via `AnnotationBasedEntityIdResolver`). Override the property with `idProperty`, or supply a custom `idResolver`. The state type carries `@EventSourcingHandler` methods that fold past events into the decision state — see the DCB command guide.

---

## Event handler parameters

`@EventHandler` methods resolve the universal parameters, plus the following. Several are event-specific.

| Parameter | Package | Resolves to |
|---|---|---|
| `@Timestamp Instant` | `org.axonframework.messaging.eventhandling.annotation` | The time the event was created |
| `TrackingToken` | `org.axonframework.messaging.eventhandling.processing.streaming.token` | The current token (streaming processors only) |
| `ReplayStatus` | `org.axonframework.messaging.eventhandling.replay` | `REGULAR` or `REPLAY` for the current delivery |
| `@ReplayContext <T>` | `org.axonframework.messaging.eventhandling.replay.annotation` | Context value registered when a replay was started (replay only) |
| `EventAppender` | `org.axonframework.messaging.eventhandling.gateway` | Appender for publishing events in reaction |
| `CommandDispatcher` | `org.axonframework.messaging.commandhandling.gateway` | Dispatcher for triggering follow-up commands |
| `QueryUpdateEmitter` | `org.axonframework.messaging.queryhandling` | Emitter for pushing subscription-query updates |

```java
import java.time.Instant;
import org.axonframework.messaging.eventhandling.annotation.Timestamp;
import org.axonframework.messaging.eventhandling.replay.ReplayStatus;
import org.axonframework.messaging.eventhandling.replay.annotation.ReplayContext;

@EventHandler
void on(StudentEnrolled event,
        @Timestamp Instant occurredAt,
        ReplayStatus replayStatus,
        @ReplayContext String reason) {
    if (replayStatus == ReplayStatus.REPLAY) {
        // rebuilding the projection — skip external side effects
        return;
    }
    projection.record(event.studentId(), occurredAt);
}
```

### Emitting subscription-query updates

```java
import org.axonframework.messaging.queryhandling.QueryUpdateEmitter;

@EventHandler
void on(CourseRenamed event, QueryUpdateEmitter emitter) {
    projection.rename(event.courseId(), event.newName());
    emitter.emit(FetchCourseQuery.class,
                 q -> q.courseId().equals(event.courseId()),
                 projection.get(event.courseId()));
}
```

> `QueryUpdateEmitter`, like the other gateways, is processing-context aware and propagates correlation data. See `events/handling-projections.md`.

> **Aggregate-only parameters.** When events come from a *classic aggregate*-based store, three extra resolvers apply: `@AggregateType String` (`...core.annotation`), `@SequenceNumber long` (`...eventhandling.annotation`), and `@SourceId String` (`...core.annotation`). With the DCB-based event store these do **not** apply, because events are not aggregate-scoped. Prefer `Tag`/`@EventTag` for correlation instead — see the event-store guides.

---

## Query handler parameters

`@QueryHandler` methods resolve the universal parameters, plus the gateways below. Note that queries should normally be side-effect free.

| Parameter | Package | Resolves to |
|---|---|---|
| `CommandDispatcher` | `org.axonframework.messaging.commandhandling.gateway` | Dispatcher (discouraged in queries) |
| `EventAppender` | `org.axonframework.messaging.eventhandling.gateway` | Appender (discouraged in queries) |

```java
@QueryHandler
CourseSummary handle(FetchCourseQuery query, ProcessingContext context) {
    return projections.get(query.courseId());
}
```

---

## Event-sourcing handler parameters

`@EventSourcingHandler` methods fold past events into entity/decision state during sourcing. They resolve the same parameters as `@EventHandler` (payload, `Metadata`, `@MetadataValue`, `@MessageIdentifier`, the message, `@Timestamp`, `ProcessingContext`). Keep them pure — do not dispatch commands or append events from them.

```java
import org.axonframework.eventsourcing.annotation.EventSourcingHandler;

@EventSourcingHandler
void evolve(CourseCapacityChanged event) {
    this.capacity = event.newCapacity();
}
```

---

## How resolution works

The active `ParameterResolverFactory` is a composite (`MultiParameterResolverFactory`) discovered from the classpath (`ClasspathParameterResolverFactory`) plus configuration-provided factories. For each parameter, the factories are consulted in priority order; the first one that produces a non-null `ParameterResolver` wins. A resolver may also *decline to match* a given message (for example `@MetadataValue(required = true)` when the key is absent), which causes the handler to be skipped for that message rather than failing.

If no resolver matches a declared parameter, the handler is rejected at registration time. To support an additional type — a custom service, a tenant identifier, a security principal — implement `ParameterResolverFactory` and register it; see `foundations/handler-customization.md`.

```java
// Conceptual: a factory matching parameters of type TenantId
public class TenantIdParameterResolverFactory implements ParameterResolverFactory {
    @Override
    public ParameterResolver<?> createInstance(Executable executable, Parameter[] params, int index) {
        if (params[index].getType().equals(TenantId.class)) {
            return new ParameterResolver<TenantId>() {
                @Override
                public TenantId resolveParameterValue(ProcessingContext context) {
                    return context.getResource(TenantId.RESOURCE_KEY);
                }
                @Override
                public boolean matches(ProcessingContext context) {
                    return context.containsResource(TenantId.RESOURCE_KEY);
                }
            };
        }
        return null; // let another factory try
    }
}
```

---

## Quick reference: which parameters where

| Parameter | Command | Event | Query | EventSourcing |
|---|:--:|:--:|:--:|:--:|
| Payload (first) | yes | yes | yes | yes |
| `Message` subtype | yes | yes | yes | yes |
| `Metadata` | yes | yes | yes | yes |
| `@MetadataValue` | yes | yes | yes | yes |
| `@MessageIdentifier` | yes | yes | yes | yes |
| `ProcessingContext` | yes | yes | yes | yes |
| Spring bean | yes | yes | yes | yes |
| `EventAppender` | yes | yes | yes (discouraged) | no |
| `CommandDispatcher` | yes | yes | yes (discouraged) | no |
| `QueryUpdateEmitter` | no | yes | no | no |
| `@Timestamp Instant` | no | yes | no | yes |
| `TrackingToken` | no | yes | no | no |
| `ReplayStatus` / `@ReplayContext` | no | yes | no | no |
| `@InjectEntity` | yes | no | no | no |
