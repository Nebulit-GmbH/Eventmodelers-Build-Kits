# Messages and the Processing Context in Axon Framework 5

Every interaction between components in AF5 is an explicit `Message`. This guide covers the anatomy of a message (payload, metadata, identifier, and `MessageType`), the three message flavors (command, event, query), the `ProcessingContext` that drives the unit-of-work lifecycle, and how correlation metadata propagates across the messages a handler produces.

For how handlers consume these messages see `foundations/annotations.md`; for cross-cutting logic that hooks into the lifecycle see `foundations/interceptors.md`. Command-specific dispatch is in `commands/stateless.md`; event publishing in `events/publishing.md`.

---

## Anatomy of a Message

The `Message` interface (`org.axonframework.messaging.core.Message`) is the common contract. A message carries four things:

| Element | Accessor | Description |
|---|---|---|
| Identifier | `identifier()` | Unique id of this specific message instance. Stays constant across representations. |
| Type | `type()` | A `MessageType` — the business name plus version. |
| Payload | `payload()` / `payloadAs(Class)` / `payloadType()` | The application data. |
| Metadata | `metadata()` | Immutable `Map<String, String>` of contextual information. |

```java
import org.axonframework.messaging.core.Message;
import org.axonframework.messaging.core.Metadata;

void inspect(Message message) {
    String id = message.identifier();
    Class<?> type = message.payloadType();
    Object payload = message.payload();
    CourseCreated event = message.payloadAs(CourseCreated.class);
    Metadata metadata = message.metadata();
}
```

> Two messages with the same `identifier()` are different representations of the same conceptual message — the payload may be expressed as different Java classes and the metadata may differ, but it is still "the same message."

### The three message types

Specializations of `Message` add type-specific accessors:

| Interface | Adds | Notes |
|---|---|---|
| `CommandMessage` | `routingKey()` → `Optional<String>`, `priority()` → `OptionalInt` | An imperative request to change state. |
| `EventMessage` | `timestamp()` → `Instant` | A factual notification that something happened. |
| `QueryMessage` | `priority()` → `OptionalInt` | A request for information. |

```java
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.commandhandling.CommandMessage;
import java.time.Instant;
import java.util.Optional;

Instant occurredAt = eventMessage.timestamp();
Optional<String> routingKey = commandMessage.routingKey();
```

---

## MessageType and QualifiedName

Axon does **not** use the Java class to identify what a message *is*. Instead every message carries a `MessageType` (`org.axonframework.messaging.core.MessageType`), a record of a `QualifiedName` plus a `version` string.

```java
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.core.QualifiedName;

// namespace + local name + version
MessageType type = new MessageType(
        new QualifiedName("faculty.enrollment", "StudentEnrolled"),
        "1.0"
);

QualifiedName name = type.qualifiedName();
String namespace = name.namespace();  // "faculty.enrollment"
String local = name.localName();      // "StudentEnrolled"
String full = name.fullName();        // "faculty.enrollment.StudentEnrolled"
```

The `QualifiedName` uses the **last** dot as the separator: everything before it is the namespace, everything after is the local name. The default version, when none is given, is `MessageType.DEFAULT_VERSION` (`"0.0.1"`).

### Deriving the type from annotations

The `MessageTypeResolver` decides the `MessageType` for a payload class. The default resolver reads the message-specific annotations `@Command`, `@Event`, and `@Query`:

```java
import org.axonframework.messaging.eventhandling.annotation.Event;

@Event(namespace = "com.university.faculty", name = "StudentEnrolled", version = "1.0")
public record StudentEnrolled(String studentId, String courseId) {}
```

| Annotation | Package | Applies to |
|---|---|---|
| `@Command` | `org.axonframework.messaging.commandhandling.annotation` | Command payloads |
| `@Event` | `org.axonframework.messaging.eventhandling.annotation` | Event payloads |
| `@Query` | `org.axonframework.messaging.queryhandling.annotation` | Query payloads |
| `@Namespace` | `org.axonframework.messaging.core.annotation` | Class / package / module level namespace default |

Each of `@Command`, `@Event`, `@Query` exposes the same three attributes:

* `namespace` — bounded context (defaults to the package name). **Set this explicitly** — relying on the package default couples the message identity to where the class lives, so moving the class silently changes its `QualifiedName`. Use a stable, hierarchical reverse-DNS-style name: `<company>.<application>.<domain>[.<subdomain>]`, e.g. `"com.university.faculty"`.
* `name` — business name (defaults to the simple class name).
* `version` — message version (defaults to `0.0.1`).

The full qualified name is always `namespace + "." + name`. If you omit the annotations entirely, Axon falls back to the fully-qualified class name and version `0.0.1`.

### Setting a namespace once with `@Namespace`

`@Namespace` (`org.axonframework.messaging.core.annotation.Namespace`) acts as a fallback for the `namespace` attribute. It can sit on the class, an enclosing class, a `package-info.java`, or a `module-info.java`:

```java
@Namespace("com.university.faculty.enrolment")
package io.axoniq.university.enrollment.api;

import org.axonframework.messaging.core.annotation.Namespace;
```

Resolution order for the namespace: `@Namespace` on the class → the `namespace` attribute on the message annotation → `@Namespace` on enclosing classes (inner to outer) → `@Namespace` on the package → `@Namespace` on the module → the package name of the class.

> Aligning the namespace with a DDD bounded context (via package-level `@Namespace`) makes it explicit which context every message belongs to. Declaring it once per package/module with `@Namespace` is the easiest way to give every message a stable, explicit namespace without repeating the `namespace` attribute on each `@Command`/`@Event`/`@Query`.

---

## Payload conversion at handling time

Because identity is decoupled from the Java class, payloads are converted to whatever type the handler asks for. The same `StudentEnrolled` event can reach one handler as the domain record and another as a `JsonNode`:

```java
@EventHandler
void on(StudentEnrolled event) { /* converted to the record */ }

@EventHandler(eventName = "faculty.enrollment.StudentEnrolled", payloadType = JsonNode.class)
void on(JsonNode event) { /* same message, converted to JsonNode */ }
```

> When the first parameter is not an `@Event`/`@Command`/`@Query` class (or its FQCN is not the message's qualified name), set the name attribute — `eventName` on `@EventHandler` (`commandName`/`queryName` on the others) — so Axon knows which messages to route to the method, and set `payloadType` to the representation the method expects.

For messages produced outside the JVM (Axon Server, a database, a store) Axon attaches a converter so `payloadAs(...)` works without you passing one. Supply a `Converter` explicitly only for messages you constructed yourself:

```java
import org.axonframework.conversion.Converter;

CourseCreated payload = message.payloadAs(CourseCreated.class, converter);

// Produce a new message with a converted payload (original unchanged)
EventMessage asJson = event.withConvertedPayload(JsonNode.class, converter);
```

This reduces the need for upcasters — instead of rewriting old formats into new classes, you can often just handle the format you receive.

---

## Metadata

`Metadata` (`org.axonframework.messaging.core.Metadata`) is an **immutable** `Map<String, String>`. Both keys and values must be `String`s; mutating methods return a new instance.

```java
import org.axonframework.messaging.core.Metadata;

Metadata metadata = Metadata.with("userId", "user-123")
                            .and("traceId", "trace-456");

// Non-String values must be converted first
Metadata counts = Metadata.with("seats", String.valueOf(42))
                          .and("waitlisted", String.valueOf(true));
```

Since messages are immutable, adding metadata yields a new message:

```java
// Replace all metadata
EventMessage replaced = event.withMetadata(Metadata.with("userId", "user-123"));

// Merge with existing entries (new keys win on conflict)
EventMessage merged = replaced.andMetadata(Metadata.with("correlationId", "corr-789"));
```

In a handler, pull a single value with `@MetadataValue` or take the whole map as a `Metadata` parameter:

```java
import org.axonframework.messaging.core.annotation.MetadataValue;

@CommandHandler
void handle(EnrollStudent command,
            @MetadataValue("userId") String actor,   // required = false by default
            EventAppender events) {
    events.append(new StudentEnrolled(command.studentId(), command.courseId()),
                  Metadata.with("enrolledBy", actor));
}
```

> `@MetadataValue` has a `required` attribute (default `false`). When the parameter is a primitive type, `required` is always treated as `true`.

---

## The Processing Context

`ProcessingContext` (`org.axonframework.messaging.core.unitofwork.ProcessingContext`) is the unit of work in AF5. Any message-handling component constructs one for you, so you rarely build it yourself. It makes processing **atomic** — everything commits or nothing does — and it:

* drives the processing lifecycle through ordered phases,
* stores typed resources for the duration of processing,
* coordinates cleanup, and
* gives access to configured framework components.

It is interface `ProcessingContext extends ProcessingLifecycle, ApplicationContext, Context`. Inject it as a handler parameter:

```java
import org.axonframework.messaging.core.unitofwork.ProcessingContext;

@CommandHandler
void handle(EnrollStudent command, ProcessingContext context) {
    context.runOnAfterCommit(ctx -> log.info("Student enrolled"));
    // ...
}
```

> You are unlikely to touch the `ProcessingContext` directly in everyday handlers — usually you just pass it along. Reach for it for custom resource management, lifecycle callbacks Axon doesn't already provide, or inside interceptors and custom infrastructure.

### Lifecycle phases

Phases run strictly in ascending order. The orders below come from `ProcessingLifecycle.DefaultPhases`.

| Phase | Order | Purpose |
|---|---|---|
| Pre-Invocation | -10000 | Setup before the handler runs (validation, security, resource prep). |
| Invocation | 0 | The handler executes. |
| Post-Invocation | 10000 | Work after the handler but before commit. |
| Prepare-Commit | 20000 | Final validation before persisting. |
| Commit | 30000 | Persist state, commit transactions, publish events. |
| After-Commit | 40000 | Notifications, follow-up triggers, logging. |

Rules: phases run lowest-to-highest; multiple actions in one phase may run in parallel; a phase fully completes before the next starts; if any action fails, later phases are skipped and error handlers fire.

### Registering lifecycle actions

Each phase has an async variant (`on*`, returning `CompletableFuture<?>`) and a sync variant (`runOn*`):

```java
@CommandHandler
void handle(CreateCourse command, ProcessingContext context) {
    // Async — return a CompletableFuture
    context.onCommit(ctx -> persist(command).thenApply(r -> null));

    // Sync — no return value
    context.runOnAfterCommit(ctx -> notifier.courseCreated(command.courseId()));
}
```

Full set of phase hooks: `onPreInvocation`/`runOnPreInvocation`, `onInvocation`/`runOnInvocation`, `onPostInvocation`/`runOnPostInvocation`, `onPrepareCommit`/`runOnPrepareCommit`, `onCommit`/`runOnCommit`, `onAfterCommit`/`runOnAfterCommit`.

### Error, completion, and finally handlers

```java
@EventHandler
void on(StudentEnrolled event, ProcessingContext context) {
    // Invoked when any phase fails
    context.onError((ctx, phase, error) ->
            log.error("Failed in phase {}: {}", phase, error.getMessage()));

    // Invoked only when all phases succeed
    context.whenComplete(ctx -> log.info("Processing completed"));

    // Invoked regardless of outcome (success or failure)
    context.doFinally(ctx -> releaseResources());
}
```

On **failure**: phases run until one fails → `onError` runs → `whenComplete` is skipped → `doFinally` runs.
On **success**: all phases run → `onError` is skipped → `whenComplete` runs → `doFinally` runs.

`doFinally` is a default method that simply registers the action on both `onError` and `whenComplete`.

### Querying lifecycle state

```java
context.isStarted();    // processing has started
context.isError();      // an error occurred
context.isCommitted();  // committed successfully
context.isCompleted();  // finished (success or failure)
```

---

## Resources

The context stores typed resources via `Context.ResourceKey<T>` (`org.axonframework.messaging.core.Context.ResourceKey`). Build keys with `ResourceKey.withLabel(...)`:

```java
import org.axonframework.messaging.core.Context.ResourceKey;

static final ResourceKey<Connection> DB_CONN = ResourceKey.withLabel("DatabaseConnection");
```

| Method | Effect |
|---|---|
| `putResource(key, value)` | Add or replace a resource. |
| `getResource(key)` | Retrieve (null if absent). |
| `containsResource(key)` | Test presence. |
| `putResourceIfAbsent(key, value)` | Add only if not present. |
| `computeResourceIfAbsent(key, supplier)` | Get or lazily create. |
| `updateResource(key, function)` | Transform the current value. |
| `removeResource(key)` | Remove and return. |
| `withResource(key, value)` | Return a branched context that also has this resource. |

```java
@CommandHandler
void handle(CreateCourse command, ProcessingContext context) {
    Connection conn = context.computeResourceIfAbsent(DB_CONN, () -> dataSource.getConnection());

    context.doFinally(ctx -> {
        Connection c = ctx.removeResource(DB_CONN);
        if (c != null) closeQuietly(c);
    });
}
```

### Accessing the current message

The handled message is itself a resource, retrievable with `Message.fromContext`:

```java
@CommandHandler
void handle(EnrollStudent command, ProcessingContext context) {
    Message message = Message.fromContext(context);
    String messageId = message.identifier();
    Metadata metadata = message.metadata();
}
```

### Accessing configured components

Because `ProcessingContext` extends `ApplicationContext`, it can resolve components from the configuration with `component(...)`:

```java
import org.axonframework.messaging.eventhandling.EventBus;
import org.axonframework.messaging.queryhandling.QueryBus;

EventBus eventBus = context.component(EventBus.class);
QueryBus named = context.component(QueryBus.class, "myQueryBus");
```

This is mainly useful inside interceptors and custom infrastructure — see `foundations/interceptors.md`.

---

## Correlation and metadata propagation

When a command yields events, or an event yields a follow-up command, Axon links those messages so you can trace a whole workflow. Two metadata keys carry the relationship:

* **`correlationId`** — the id of the original message that started the workflow (the root cause).
* **`causationId`** — the id of the immediate parent message.

```
Command A (id: cmd-1)
  └─> Event B   (id: evt-2, correlationId: cmd-1, causationId: cmd-1)
      └─> Command C (id: cmd-3, correlationId: cmd-1, causationId: evt-2)
          └─> Event D   (id: evt-4, correlationId: cmd-1, causationId: cmd-3)
```

> Terminology changed in AF5: the old `traceId` is now `correlationId`, and the old `correlationId` is now `causationId`.

### CorrelationDataProvider

A `CorrelationDataProvider` (`org.axonframework.messaging.core.correlation.CorrelationDataProvider`) computes the metadata to copy onto each new message. The active `ProcessingContext` invokes it automatically whenever a context-aware producer (`EventAppender`, `CommandDispatcher`) emits a message.

| Implementation | Behavior |
|---|---|
| `MessageOriginProvider` | Default. Propagates `correlationId` and `causationId`. |
| `SimpleCorrelationDataProvider` | Copies the named metadata keys verbatim. |
| `MultiCorrelationDataProvider` | Combines several providers. |

`MessageOriginProvider` keys are `MessageOriginProvider.DEFAULT_CORRELATION_KEY` (`"correlationId"`) and `DEFAULT_CAUSATION_KEY` (`"causationId"`). It sets `causationId` to the parent's identifier, and `correlationId` to the parent's existing `correlationId` (or the parent's identifier if it had none).

```java
@CommandHandler
void handle(EnrollStudent command, EventAppender events) {
    // command id "cmd-123", no correlationId yet (it is the root)
    events.append(new StudentEnrolled(command.studentId(), command.courseId()));
    // resulting event metadata: correlationId = "cmd-123", causationId = "cmd-123"
}
```

Because `EventAppender` and `CommandDispatcher` are context-aware, the propagation happens without any explicit wiring — see `events/publishing.md` and `commands/stateless.md`.

### Copying custom keys

To carry your own keys (e.g. `tenantId`, `userId`) down the chain, combine providers:

```java
import org.axonframework.messaging.core.correlation.MessageOriginProvider;
import org.axonframework.messaging.core.correlation.SimpleCorrelationDataProvider;
import org.axonframework.messaging.core.correlation.MultiCorrelationDataProvider;
import java.util.List;

CorrelationDataProvider provider = new MultiCorrelationDataProvider(List.of(
        new MessageOriginProvider(),
        new SimpleCorrelationDataProvider("tenantId", "userId")
));
```

### A custom provider

The interface is functional — implement `correlationDataFor(Message)`:

```java
import org.axonframework.messaging.core.correlation.CorrelationDataProvider;

public class TenantCorrelationDataProvider implements CorrelationDataProvider {

    @Override
    public Map<String, String> correlationDataFor(Message message) {
        Map<String, String> data = new HashMap<>();
        String tenant = message.metadata().get("tenantId");
        if (tenant != null) {
            data.put("tenantId", tenant);
        }
        return data; // never return null; return an empty map instead
    }
}
```

Exceptions thrown from `correlationDataFor` are caught and ignored by the framework so they cannot interfere with rollback.

### Registration

```java
import org.axonframework.messaging.core.configuration.MessagingConfigurer;

MessagingConfigurer.create()
        .registerCorrelationDataProvider(cfg -> new MessageOriginProvider())
        .registerCorrelationDataProvider(cfg -> new SimpleCorrelationDataProvider("tenantId", "userId"));
```

In Spring Boot, declare each provider as a `CorrelationDataProvider` bean. Note that defining your own beans **overrides** the default `MessageOriginProvider`, so include it explicitly if you still want correlation/causation propagation. See `foundations/annotations.md` for the broader configuration story.
