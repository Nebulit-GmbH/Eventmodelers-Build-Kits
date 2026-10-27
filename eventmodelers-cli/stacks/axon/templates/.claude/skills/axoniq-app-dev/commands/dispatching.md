# Dispatching Commands in Axon Framework 5

This is the deeper reference for the command-sending side: the `CommandGateway`, the `CommandDispatcher`, the underlying `CommandBus`, routing keys, and how command results flow back. For *writing* handlers, see `commands/stateless.md` (stateless) and `commands/decision-models-dcb.md` (state-sourced). For configuring the command bus and registering handlers, see `configuration/plain-java.md`. For translating handler exceptions, see `foundations/exception-handling.md`.

There are three sending APIs, from highest to lowest level:

| Component | Use when | Provides `ProcessingContext` |
|---|---|---|
| `CommandGateway` | Dispatching from *outside* a handler (HTTP endpoint, scheduler, `main`) | You pass it (or `null`) |
| `CommandDispatcher` | Dispatching from *inside* a message handler | Automatically, from the current context |
| `CommandBus` | Low-level infrastructure; you build the `CommandMessage` yourself | You pass it (or `null`) |

Prefer the gateway or the dispatcher in application code. Each accepts a plain command object (POJO) and wraps it in a `CommandMessage` for you.

---

## The `CommandGateway`

Obtain `CommandGateway` from the framework `Configuration`; in Spring Boot inject it as a bean. Never construct it manually.

```java
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.axonframework.messaging.commandhandling.gateway.CommandResult;
import org.axonframework.messaging.core.Metadata;

public class EnrollmentService {

    private final CommandGateway commands;

    public EnrollmentService(CommandGateway commands) {
        this.commands = commands;
    }
}
```

### Asynchronous dispatch with `send`

`send` returns immediately with a `CommandResult` — it does not block for the handler.

```java
// Fire-and-forget; attach reactions to the CommandResult
CommandResult result = commands.send(new CreateCourse(courseId, name, capacity));

result.onSuccess(String.class, courseRef -> log.info("Created {}", courseRef))
      .onError(error -> log.error("Create failed", error));
```

`send` has overloads for metadata and an (optional) `ProcessingContext`:

| Call | Returns | Notes |
|---|---|---|
| `send(command)` | `CommandResult` | Empty metadata, no context |
| `send(command, Metadata)` | `CommandResult` | Attaches metadata |
| `send(command, ProcessingContext)` | `CommandResult` | Propagates correlation data |
| `send(command, Metadata, ProcessingContext)` | `CommandResult` | Both |
| `send(command, Class<R>)` | `CompletableFuture<R>` | Result converted to `R` |
| `send(command, Class<R>, ProcessingContext)` | `CompletableFuture<R>` | Both |

```java
// With metadata
commands.send(new CreateCourse(courseId, name, capacity),
              Metadata.with("userId", actorId));

// Get a typed CompletableFuture directly
CompletableFuture<String> future = commands.send(new CreateCourse(courseId, name, capacity),
                                                  String.class);
```

> When dispatching from outside a handler (an HTTP endpoint, `main`, a scheduler), use the variants without a `ProcessingContext`, or pass `null`. Only supply a context when you have one from a surrounding handler — and in that case prefer the `CommandDispatcher` below.

### Synchronous dispatch with `sendAndWait`

`sendAndWait` blocks the calling thread until handling completes, then returns the result payload (or rethrows the failure).

```java
import org.axonframework.messaging.commandhandling.CommandExecutionException;

// Typed result
String courseRef = commands.sendAndWait(new CreateCourse(courseId, name, capacity), String.class);

// Untyped result (Object); null if the handler returns nothing
Object ignored = commands.sendAndWait(new RenameCourse(courseId, newName));
```

| Call | Returns | Notes |
|---|---|---|
| `sendAndWait(command)` | `Object` | Result discarded-friendly; `null` if no return value |
| `sendAndWait(command, Class<R>)` | `R` | Result converted to `R` |
| `sendAndWait(command, Class<R>, ProcessingContext)` | `R` | With a context |

> `sendAndWait` blocks a thread. Use it only when you genuinely need the result before continuing (for example, a request/response HTTP handler). For everything else prefer `send`.

---

## The `CommandDispatcher` (from inside a handler)

When you need to dispatch a command from *within* another message handler, inject a `CommandDispatcher` as a handler parameter. It is bound to the current `ProcessingContext`, so correlation data (trace IDs, metadata) automatically flows to the new command. Because of that binding, its methods have no `ProcessingContext` parameter.

```java
import org.axonframework.messaging.commandhandling.gateway.CommandDispatcher;
import org.axonframework.messaging.eventhandling.annotation.EventHandler;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;
import java.util.concurrent.CompletableFuture;

class WhenAllCoursesFullyBookedThenNotify {

    @EventHandler
    CompletableFuture<?> on(StudentSubscribedToCourse event,
                            CommandDispatcher dispatcher,
                            ProcessingContext context) {
        // ... decide whether to react ...
        return dispatcher.send(new SendAllCoursesFullyBookedNotification(facultyId), Object.class);
    }
}
```

`CommandDispatcher` exposes a trimmed set of `send` methods:

| Call | Returns |
|---|---|
| `send(command)` | `CommandResult` |
| `send(command, Metadata)` | `CommandResult` |
| `send(command, Class<R>)` | `CompletableFuture<R>` |

> The dispatcher is `ProcessingContext`-scoped: it is not retrievable from the `Configuration`. Inject it as a handler parameter (or build one with `CommandDispatcher.forContext(context)` if you already hold a context).

---

## Command results

### `CommandResult`

`send` returns a `CommandResult` — a handle over the eventual outcome. You can attach reactions or convert it to a `CompletableFuture`.

```java
import org.axonframework.messaging.core.Message;

CommandResult result = commands.send(new EnrollStudent(studentId, courseId));

// Convert to a typed CompletableFuture
CompletableFuture<String> future = result.resultAs(String.class);

// React to the raw result message
result.onSuccess((Message message) -> log.info("payload: {}", message.payload()));

// React to a typed payload (with or without the message)
result.onSuccess(String.class, enrollmentId -> log.info("enrolled: {}", enrollmentId));
result.onSuccess(String.class, (enrollmentId, message) -> audit(enrollmentId, message.type()));

// React to a failure
result.onError(throwable -> log.error("enroll failed", throwable));
```

| `CommandResult` method | Purpose |
|---|---|
| `getResultMessage()` | The eventual result as `CompletableFuture<? extends Message>` |
| `resultAs(Class<R>)` | The result payload converted to `R`, as `CompletableFuture<R>` |
| `onSuccess(Consumer<Message>)` | Run on success with the raw result message |
| `onSuccess(Class<R>, Consumer<R>)` | Run on success with the typed payload |
| `onSuccess(Class<R>, BiConsumer<R, Message>)` | Run on success with payload and message |
| `onError(Consumer<Throwable>)` | Run on failure |

The `onSuccess`/`onError` methods return the same `CommandResult`, so they chain.

### What handlers return, and when

A `@CommandHandler` method's return value becomes the command result. Commands express *intent to change state*; returning data is the exception, not the rule. Legitimate return values are entity identifiers of newly created entities, generated reference numbers, or confirmation data needed for a synchronous flow. If the *primary* purpose of a message is to fetch information, model it as a query instead (see the query guides). When a handler returns nothing, the result payload is `null`.

```java
@CommandHandler
String handle(EnrollStudent command, EventAppender events) {
    String enrollmentId = UUID.randomUUID().toString();
    events.append(new StudentEnrolled(command.studentId(), command.courseId(), enrollmentId));
    return enrollmentId;
}
// Caller:
String enrollmentId = commands.sendAndWait(command, String.class);
```

### Failures

If a handler throws, that failure surfaces to the caller. With `sendAndWait`, runtime exceptions are rethrown as-is and checked exceptions are wrapped in `CommandExecutionException` (`org.axonframework.messaging.commandhandling.CommandExecutionException`). With `send`, the failure resolves the `CompletableFuture`/`CommandResult` exceptionally — observe it via `onError` or the future's completion. See `foundations/exception-handling.md` for translating handler exceptions with `@ExceptionHandler`.

---

## Command routing

Commands are routed to exactly one handler. Two routing decisions matter:

1. **Which handler** — by the command's name (`QualifiedName`). Each command name has exactly one subscribed handler per bus; if none exists, `NoHandlerForCommandException` is thrown.
2. **Which instance / which entity** — by the *routing key*. Commands carrying the same routing key are routed consistently to the same destination, which avoids optimistic-locking conflicts when several commands touch the same entity, and is what `@InjectEntity` uses to identify the entity to load.

### Declaring a routing key with `@Command`

```java
import org.axonframework.messaging.commandhandling.annotation.Command;

@Command(namespace = "com.university.faculty", routingKey = "courseId")
public record EnrollStudent(String courseId, String studentId) {}
```

The framework extracts the named property's value as the routing key. The name may match a field or an accessor — `courseId`, `getCourseId`, or `isCourseId` all resolve. (`@Command` also carries `name` and `version` attributes that, together with `namespace`, shape the command's `QualifiedName`.)

> **Always set `namespace` explicitly.** It defaults to the Java package of the class, so moving or renaming the package silently changes the command's `QualifiedName` and breaks routing. Pin it to a stable, hierarchical business name in reverse-DNS-style dotted form, `<company>.<application>.<domain>[.<subdomain>]` (here `"com.university.faculty"`), independent of the Java package. See `foundations/annotations.md`.

> In Axon 4 routing keys were declared with `@TargetAggregateIdentifier`. In Axon 5 that is replaced by the `routingKey` attribute on `@Command`. The routing key value's `toString()` must be consistent — an inconsistent one can split commands that should reach the same instance.

### Routing strategies

A `RoutingStrategy` turns a `CommandMessage` into a routing-key string. The default is `AnnotationRoutingStrategy`, which reads `@Command(routingKey = ...)`. The framework also ships `MetadataRoutingStrategy`, which derives the key from a metadata entry.

```java
import org.axonframework.messaging.commandhandling.RoutingStrategy;
import org.axonframework.messaging.commandhandling.MetadataRoutingStrategy;
import org.axonframework.messaging.commandhandling.CommandMessage;

// Register a different strategy via the Configuration API
configurer.componentRegistry(cr ->
    cr.registerComponent(RoutingStrategy.class,
                         config -> new MetadataRoutingStrategy("tenantId")));
```

Implement `RoutingStrategy` for fully custom logic:

```java
public class TenantRoutingStrategy implements RoutingStrategy {
    @Override
    public String getRoutingKey(CommandMessage command) {
        EnrollStudent payload = (EnrollStudent) command.payload();
        return payload.courseId();   // or compose a composite key
    }
}
```

In Spring Boot, exposing a `RoutingStrategy` `@Bean` is enough — auto-configuration detects it.

---

## The `CommandBus` (low-level)

The `CommandBus` is the infrastructure component the gateway and dispatcher delegate to. It is async-native: a single `dispatch` method returns a `CompletableFuture`.

```java
import org.axonframework.messaging.commandhandling.CommandBus;
import org.axonframework.messaging.commandhandling.CommandMessage;
import org.axonframework.messaging.commandhandling.CommandResultMessage;
import org.axonframework.messaging.commandhandling.GenericCommandMessage;
import org.axonframework.messaging.core.MessageType;
import java.util.concurrent.CompletableFuture;

// You must build the CommandMessage yourself when using the bus directly.
CommandMessage command = new GenericCommandMessage(
        new MessageType(EnrollStudent.class),
        new EnrollStudent(courseId, studentId));

CompletableFuture<CommandResultMessage> future = commandBus.dispatch(
        command,
        null);   // ProcessingContext: null when dispatching from outside a handler

future.whenComplete((resultMessage, exception) -> {
    if (exception != null) {
        // dispatch/handling failed
    } else {
        Object payload = resultMessage.payload();
        // handle the result payload
    }
});
```

`dispatch(CommandMessage, ProcessingContext)` takes an optional `ProcessingContext` (pass `null` from outside a handler) and resolves with a `CommandResultMessage`. Because building messages and handling raw futures is verbose, reserve direct bus use for infrastructure code; application code should use the gateway or dispatcher.

### `SimpleCommandBus`

`SimpleCommandBus` is the standard single-JVM implementation: low overhead, one handler per command name, and it cannot distribute commands across instances. Spring Boot configures one automatically (unless Axon Server is in use). To register one manually:

```java
import org.axonframework.messaging.commandhandling.SimpleCommandBus;
import org.axonframework.messaging.core.unitofwork.UnitOfWorkFactory;

configurer.messaging(mc -> mc.registerCommandBus(
        config -> new SimpleCommandBus(config.getComponent(UnitOfWorkFactory.class))));
```

The command bus transparently includes a sequencing mechanism: commands sharing a routing key are processed sequentially (avoiding optimistic-locking failures), while commands for *different* keys keep full concurrency. This needs no configuration. The bus also supports dispatch interceptors (run before routing) and handler interceptors (run after routing, before the handler) — see `foundations/exception-handling.md` and the message-interception guides for details.
