# Message Annotations in Axon Framework 5

This guide is a complete reference for all annotations that appear on message payload types and message handler methods in AF5. No attributes are omitted — use this guide as a single source rather than searching individual API docs.

---

## Message Payload Type Annotations

These annotations are placed on the class or record that represents the command, event, or query payload. They control the message's identity in the framework's type system. All three follow the same attribute shape.

### `@Command`

```java
import org.axonframework.messaging.commandhandling.annotation.Command;
```

Applied to a command payload class. Maps the class to a `CommandMessage` and declares its qualified name and routing key.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `namespace` | `String` | Package name of the annotated class | The namespace component of the `QualifiedName`. Override to decouple the wire name from the Java package. |
| `name` | `String` | Simple class name | The local name component of the `QualifiedName`. Override for schema evolution or bounded-context alignment. |
| `version` | `String` | `"0"` (`MessageType.DEFAULT_VERSION`) | Schema version. Increment when the payload structure changes incompatibly. |
| `routingKey` | `String` | `""` (no routing key) | Field name whose value is used to route the command in a distributed setup and to resolve the entity ID for `@InjectEntity`. Required when using `@InjectEntity` in the command handler. |

```java
// Best practice: always set namespace explicitly.
@Command(namespace = "com.university.faculty", routingKey = "courseId")
public record EnrollStudent(String courseId, String studentId) {}

// Override name and version too, e.g. for schema evolution:
@Command(namespace = "com.university.faculty", name = "EnrollStudent", version = "2", routingKey = "courseId")
public record EnrollStudentV2(String courseId, String studentId, String preferredSeat) {}
```

> **Best practice — always set `namespace` explicitly.** When omitted, the namespace defaults to the Java package of the class. That couples the message's wire identity to where the class physically lives, so moving or renaming the package silently changes the `QualifiedName` — breaking routing for in-flight commands and the mapping for already-stored events. Pin the namespace to a stable, hierarchical business name that does **not** track the Java package, using a reverse-DNS-style dotted form: `<company>.<application>.<domain>[.<subdomain>]` — e.g. `"com.university.faculty"` or `"com.university.faculty.enrolment"`. The same applies to `@Event` and `@Query`; to set one namespace for a whole package or module at once, use `@Namespace` (see the note under `@Query` below).

---

### `@Event`

```java
import org.axonframework.messaging.eventhandling.annotation.Event;
```

Applied to an event payload class. Maps the class to an `EventMessage` and declares its qualified name.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `namespace` | `String` | Package name of the annotated class | The namespace component of the `QualifiedName`. |
| `name` | `String` | Simple class name | The local name component of the `QualifiedName`. Override for schema stability across refactors. |
| `version` | `String` | `"0"` (`MessageType.DEFAULT_VERSION`) | Schema version. Increment when the payload structure changes incompatibly. |

```java
// Best practice: set namespace explicitly so the wire identity does not track the package.
@Event(namespace = "com.university.faculty")
public record StudentEnrolled(String courseId, String studentId) {}

// Stable wire name independent of Java class name or package:
@Event(namespace = "com.university.faculty", name = "StudentEnrolled", version = "1")
public record StudentEnrolledEvent(String courseId, String studentId, Instant enrolledAt) {}
```

`@Event` is optional, but recommended. Omitting it derives the qualified name from the Java package and class name — convenient, but it means moving or renaming the class/package changes the stored event's identity. Annotate events with at least an explicit `namespace` (and a stable `name`) so they can be refactored freely. See `events/versioning-upcasting.md`.

---

### `@Query`

```java
import org.axonframework.messaging.queryhandling.annotation.Query;
```

Applied to a query payload class. Maps the class to a `QueryMessage` and declares its qualified name.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `namespace` | `String` | Package name of the annotated class | The namespace component of the `QualifiedName`. |
| `name` | `String` | Simple class name | The local name component of the `QualifiedName`. |
| `version` | `String` | `"0"` (`MessageType.DEFAULT_VERSION`) | Schema version. |

```java
// Best practice: set namespace explicitly.
@Query(namespace = "com.university.faculty")
public record FindCourse(String courseId) {}

@Query(namespace = "com.university.faculty", name = "FindCourse")
public record FindCourseQuery(String courseId) {}
```

> **`@Query(namespace=...)` vs `@Namespace`**: the `namespace` attribute on `@Query` (and `@Command`/`@Event`) sets that single message's `QualifiedName` namespace. `@Namespace` is a *separate* annotation (`org.axonframework.messaging.core.annotation.Namespace`, since AF5.1) that declares the namespace for a whole type, package, or module at once — a catch-all for the per-type `namespace` attributes. On the event side, `@Namespace` also drives processor assignment via the `pooledStreamingMatching`/`subscribingMatching` selectors (see `configuration/spring-boot.md`).

---

## Handler Method Annotations

These annotations are placed on methods that handle the corresponding message type.

### `@CommandHandler`

```java
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
```

Marks a method as a command handler. The framework resolves its parameters automatically (see **Injectable Parameters** below).

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `commandName` | `String` | `""` — derived from the first parameter type | Overrides the command name this handler listens to. Use when the payload type name differs from the intended command name (rare). |
| `routingKey` | `String` | `""` — falls back to `@Command(routingKey)` on the payload | The routing-key field to use for this handler specifically. Normally set on the command class with `@Command(routingKey = ...)` instead. |
| `payloadType` | `Class<?>` | `Object.class` — derived from first parameter | Explicitly declares the payload type. Use when the first parameter is a raw `Message` or `CommandMessage` and the payload type cannot be inferred. |

```java
// Typical use — no attributes needed:
@CommandHandler
void handle(EnrollStudent command, EventAppender events) { ... }

// Override command name to route by name rather than type:
@CommandHandler(commandName = "education.EnrollStudent")
void handleLegacy(Map<String, Object> rawPayload, EventAppender events) { ... }
```

---

### `@EventHandler`

```java
import org.axonframework.messaging.eventhandling.annotation.EventHandler;
```

Marks a method as an event handler within an event-handling component (projection, reaction). The framework routes each incoming event to all matching handler methods.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `eventName` | `String` | `""` — derived from the first parameter type | Overrides the event name this handler listens to. Use for legacy event names or schema evolution. |
| `payloadType` | `Class<?>` | `Object.class` — derived from first parameter | Explicitly declares the payload type. Useful when accepting a raw `EventMessage<?>`. |

```java
// Typical use:
@EventHandler
void on(StudentEnrolled event) { ... }

// Accept a legacy event name (event was renamed):
@EventHandler(eventName = "education.StudentRegistered")
void onLegacy(StudentEnrolled event) { ... }

// Replay control (see @AllowReplay):
@EventHandler
@AllowReplay(false)
void onEnrolled(StudentEnrolled event) { ... }
```

Multiple `@EventHandler` methods can match the same event type — all matching methods are invoked. If two methods have identical parameter types, invocation order is undefined.

---

### `@QueryHandler`

```java
import org.axonframework.messaging.queryhandling.annotation.QueryHandler;
```

Marks a method as a query handler. The method's return value is sent back as the query response. For subscription queries, the return type may be a `SubscriptionQueryUpdateEmitter` or a `Flux`/reactive type.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `queryName` | `String` | `""` — derived from the first parameter type | Overrides the query name this handler listens to. |

```java
// Typical use:
@QueryHandler
CourseView handle(FindCourse query) { ... }

// List response:
@QueryHandler
List<CourseView> handle(FindAllCourses query) { ... }

// Override query name:
@QueryHandler(queryName = "education.FindCourse")
CourseView handleLegacy(Map<String, Object> rawQuery) { ... }
```

---

### `@EventSourcingHandler`

```java
import org.axonframework.eventsourcing.annotation.EventSourcingHandler;
```

Marks a method in an `@EventSourcedEntity` class that evolves state by applying an event. Called by the framework during sourcing (before the command handler runs) and has the same injectable parameters as `@EventHandler`.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `payloadType` | `Class<?>` | `Object.class` — derived from first parameter | Explicitly declares the event payload type when it cannot be inferred from the first parameter. |

```java
@EventSourcedEntity(tagKey = "course")
public class CourseState {

    @EventSourcingHandler
    private void on(CourseCreated event) {
        this.capacity = event.capacity();
    }

    @EventSourcingHandler
    private void on(StudentEnrolled event) {
        this.enrolled++;
    }
}
```

Keep `@EventSourcingHandler` methods free of side effects — they must only update fields. Business rules belong in the `@CommandHandler`.

---

## Injectable Parameters for Handler Methods

All handler methods (`@CommandHandler`, `@EventHandler`, `@QueryHandler`, `@EventSourcingHandler`) resolve their parameters automatically. The first parameter is always the message payload. All remaining parameters are resolved by type or annotation.

### `@MetadataValue`

```java
import org.axonframework.messaging.core.annotation.MetadataValue;
```

Injects a single value from the message metadata map.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `value` | `String` | — (required) | The metadata key to look up. |
| `required` | `boolean` | `false` | When `true`, the handler is not invoked if the key is absent. When `false`, `null` is injected for missing keys (primitives always behave as `required = true`). |

```java
@CommandHandler
void handle(EnrollStudent command,
            @MetadataValue("userId") String actorId,
            @MetadataValue(value = "requestId", required = true) String requestId,
            EventAppender events) { ... }
```

---

### `@Timestamp`

```java
import org.axonframework.messaging.eventhandling.annotation.Timestamp;
```

Injects the timestamp of the event message as an `Instant`. Only valid in `@EventHandler` and `@EventSourcingHandler` methods; has no attributes.

```java
@EventHandler
void on(StudentEnrolled event, @Timestamp Instant enrolledAt) { ... }
```

---

### Other resolvable parameter types (no annotation needed)

| Parameter type | What is injected |
|---|---|
| `EventAppender` | Appends events to the event store (command handlers only) |
| `ProcessingContext` | The active processing context (all handler types) |
| `Metadata` | The full metadata map of the message |
| `CommandMessage` / `EventMessage` / `QueryMessage` | The raw message |

---

## Entity Model Annotations

These annotations appear on event-sourced entity classes and their members. They are used with the **command-centric DCB pattern** — see `commands/decision-models-dcb.md` for how they fit together.

### `@EventSourcedEntity`

```java
import org.axonframework.eventsourcing.annotation.EventSourcedEntity;
```

Applied to a class that represents event-sourced state loaded before a command handler runs.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `tagKey` | `String` | `""` — defaults to the class simple name | The tag key used to look up events for this entity. Events must be tagged with this key (via `@EventTag`) for the entity to source them. |
| `concreteTypes` | `Class<?>[]` | `{}` | For polymorphic entities: list all concrete subtypes. The first event's payload determines which subtype to instantiate. |
| `criteriaResolverDefinition` | `Class<? extends CriteriaResolverDefinition>` | `AnnotationBasedEventCriteriaResolverDefinition.class` | Custom strategy to resolve `EventCriteria` from the entity ID. Override only when `tagKey` and `@EventCriteriaBuilder` are insufficient. |
| `entityFactoryDefinition` | `Class<? extends EventSourcedEntityFactoryDefinition>` | `AnnotationBasedEventSourcedEntityFactoryDefinition.class` | Custom strategy to instantiate the entity. Override only when `@EntityCreator` is insufficient. |
| `entityIdResolverDefinition` | `Class<? extends EntityIdResolverDefinition>` | `AnnotatedEntityIdResolverDefinition.class` | Custom strategy to extract the entity ID from a `CommandMessage`. Override only when `@Command(routingKey)` and `@TargetEntityId` are insufficient. |

```java
@EventSourcedEntity(tagKey = "course")
public class CourseState {
    // @EntityCreator constructor, @EventSourcingHandler methods, accessor methods
}
```

---

### `@EntityCreator`

```java
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;
```

Marks the constructor or static factory method that the framework calls to create an entity instance.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `payloadQualifiedNames` | `String[]` | `{}` — derived from first parameter type | Qualified names of the event payload types this creator handles. Use when the payload type cannot be determined by reflection (e.g., for generic or overloaded creators). |

```java
// No-arg constructor: always creates an instance (even when no events exist).
// Use when a command may target an entity that has not yet produced any events.
@EntityCreator
public CourseState() {}

// Event-parameterised constructor: created only when at least one event is found.
// The entity is null until the first event arrives — handlers for commands that create
// the entity must be declared as static @CommandHandler methods.
@EntityCreator
public CourseState(CourseCreated event) {
    this.capacity = event.capacity();
}
```

---

### `@EventTag`

```java
import org.axonframework.eventsourcing.annotation.EventTag;
```

Applied to a field or no-arg method on an event payload class. Declares which field(s) the framework should store as `Tag`s when the event is appended.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `key` | `String` | `""` — defaults to the field/method name | The tag key. Must match the `tagKey` on the `@EventSourcedEntity` that sources events by this key. |

Special handling:
- **`Iterable` fields/methods**: one tag is created per element, all sharing the same key.
- **`Map` fields/methods without `key`**: map keys become tag keys, map values become tag values.
- **`Map` fields/methods with `key`**: the provided key is used for all tags; one tag per map value.
- A `null` value produces no tag.

```java
record StudentEnrolled(
        @EventTag(key = "course") String courseId,
        @EventTag(key = "student") String studentId
) {}

// Method-level for computed or multi-valued tags:
record BidPlaced(UUID auctionId, String bidderId, String previousBidderId, BigDecimal amount) {
    @EventTag(key = "user")
    public List<String> taggedUsers() {
        var tags = new ArrayList<String>();
        tags.add(bidderId);
        if (previousBidderId != null) tags.add(previousBidderId);
        return tags;
    }
}
```

---

### `@EventCriteriaBuilder`

```java
import org.axonframework.eventsourcing.annotation.EventCriteriaBuilder;
```

Marks a static method on an `@EventSourcedEntity` class that returns the `EventCriteria` used to source events for a given entity ID. The method must be `static`, must accept the entity ID as its only parameter, and must return `EventCriteria`. No attributes.

```java
@EventSourcedEntity
public class CourseState {

    @EventCriteriaBuilder
    public static EventCriteria criteriaFor(String courseId) {
        return EventCriteria.havingTags("course", courseId)
                            .or(EventCriteria.havingTags("waitlist-course", courseId));
    }
}
```

Use `@EventCriteriaBuilder` when the criteria cannot be expressed with a single `tagKey` (e.g., OR conditions, multiple tag keys).

---

## Entity Injection Annotations

These appear on parameters of `@CommandHandler` methods to inject entity state built by `@EventSourcedEntity`.

### `@InjectEntity`

```java
import org.axonframework.modelling.annotation.InjectEntity;
```

Injects an entity loaded by the framework's `StateManager`. The parameter type must match the `@EventSourcedEntity` class (or `ManagedEntity<ID, EntityType>`).

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `idProperty` | `String` | `""` — falls back to `idResolver`, then `@TargetEntityId` | Name of the property on the command payload that holds the entity ID. The framework calls the corresponding getter to obtain the ID value. Preferred over `idResolver` for simple cases. |
| `idResolver` | `Class<? extends EntityIdResolver>` | `AnnotationBasedEntityIdResolver.class` | Custom strategy to extract the entity ID from the command message when `idProperty` is not set. The default resolver looks for `@TargetEntityId` on the command payload. |

ID resolution order:
1. `idProperty` (if set)
2. `idResolver` (if custom)
3. `@TargetEntityId` annotation on the command payload field/method

```java
// Resolve ID from a command field:
@CommandHandler
void handle(EnrollStudent command,
            @InjectEntity(idProperty = "courseId") CourseState course,
            EventAppender events) { ... }

// Multiple entities — different ID fields:
@CommandHandler
void handle(TransferBalance command,
            @InjectEntity(idProperty = "sourceAccountId") AccountState source,
            @InjectEntity(idProperty = "targetAccountId") AccountState target,
            EventAppender events) { ... }

// No idProperty — relies on @TargetEntityId on the command payload:
@CommandHandler
void handle(EnrollStudent command,
            @InjectEntity CourseState course,
            EventAppender events) { ... }
```

---

### `@TargetEntityId`

```java
import org.axonframework.modelling.annotation.TargetEntityId;
```

Applied to a field or accessor method on a command payload class. Identifies which field provides the entity ID for `@InjectEntity` when no `idProperty` is set. No attributes.

If multiple fields are annotated, exactly one must be non-null at runtime; if zero or more than one non-null value is found, `EntityIdResolutionException` is thrown.

```java
public record EnrollStudent(
        @TargetEntityId String courseId,
        String studentId
) {}
```

---

### `@InjectEntityId`

```java
import org.axonframework.eventsourcing.annotation.reflection.InjectEntityId;
```

Injects the entity's identifier into a parameter of an `@EntityCreator` constructor or factory method. Required to disambiguate when both the entity ID and the event payload are the same Java type (e.g., both `String`). No attributes.

```java
@EntityCreator
public CourseState(@InjectEntityId String courseId) {
    this.courseId = courseId;
}
```

---

## Replay and Exception Handling Annotations

### `@AllowReplay`

```java
import org.axonframework.messaging.eventhandling.replay.annotation.AllowReplay;
```

Controls whether an `@EventHandler` method (or all handlers in a class) are invoked during an event processor replay. Can be placed at method or class level; method-level overrides class-level.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `value` | `boolean` | `true` | `true` = the handler is invoked during replay. `false` = the handler is skipped during replay (but still runs normally during live processing). |

```java
// Class-level: opt all handlers in this class out of replay
@AllowReplay(false)
public class NotificationHandler {

    @EventHandler
    void on(StudentEnrolled event) { /* sends email — skip during replay */ }

    @EventHandler
    @AllowReplay(true)          // override: this one must run during replay
    void onForAudit(StudentEnrolled event) { /* audit log — must replay */ }
}
```

---

### `@ResetHandler`

```java
import org.axonframework.messaging.eventhandling.replay.annotation.ResetHandler;
```

Marks a method to be invoked when a replay is being prepared (before events are replayed). Use to clear or reset local state so the replay starts from a clean slate. The method can throw to veto the reset. No attributes.

```java
@ResetHandler
void onReset() {
    courseRepository.deleteAll();
}
```

---

### `@ExceptionHandler`

```java
import org.axonframework.messaging.core.interception.annotation.ExceptionHandler;
```

Marks a method in the same handler class as an interceptor for exception results from sibling handlers. Invoked after a handler throws, allowing translation or wrapping of exceptions.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `resultType` | `Class<? extends Exception>` | `Exception.class` | The exception type (or supertype) this interceptor matches. |
| `messageType` | `Class<? extends Message>` | `Message.class` | Restricts this interceptor to a specific message type (e.g., `CommandMessage.class`). |

```java
class CourseCommandHandler {

    @CommandHandler
    void handle(CreateCourse command, EventAppender events) {
        if (command.capacity() <= 0) throw new InvalidCapacityException("capacity must be positive");
        events.append(new CourseCreated(command.courseId(), command.name(), command.capacity()));
    }

    @ExceptionHandler(resultType = InvalidCapacityException.class)
    void on(InvalidCapacityException ex, CommandMessage msg) {
        throw new CommandExecutionException("Bad command: " + ex.getMessage(), ex);
    }
}
```

Works on entities since 5.0; on plain command/event/query handling components from 5.2.0. See `foundations/exception-handling.md`.

---

### `@CommandHandlerInterceptor` / `@EventHandlerInterceptor` / `@QueryHandlerInterceptor` (5.2.0+)

```java
import org.axonframework.messaging.commandhandling.interception.annotation.CommandHandlerInterceptor;
import org.axonframework.messaging.eventhandling.interception.annotation.EventHandlerInterceptor;
import org.axonframework.messaging.queryhandling.interception.annotation.QueryHandlerInterceptor;
```

Marks a method that intercepts every matching handler **in the same class**. No attributes (each is meta-annotated `@MessageHandlerInterceptor(messageType = ...)` for its message type). A method without a `MessageHandlerInterceptorChain` parameter returning `void` runs *before* the handlers (throwing blocks handling); a method declaring the chain parameter and returning `MessageStream` fully *surrounds* the handlers. See `foundations/interceptors.md`.

---

### `@MessageHandlerTimeout`

```java
import org.axonframework.messaging.core.annotation.MessageHandlerTimeout;
```

Placed on a `@CommandHandler`, `@QueryHandler`, or `@EventHandler` method to override the configured handler timeouts for that handler.

| Attribute | Type | Default | Meaning |
|---|---|---|---|
| `timeoutMs` | `int` | `-1` (use configured default) | Elapsed time after which the handler is interrupted. |
| `warningThresholdMs` | `int` | `-1` | Time after which a warning is logged. |
| `warningIntervalMs` | `int` | `-1` | Interval between subsequent warnings. |

See `foundations/exception-handling.md` for the `axon.timeout.*` defaults.
