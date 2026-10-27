# Exception Handling in Axon Framework 5

When a command or query handler fails, the framework decides what the caller sees. This guide covers how exceptions propagate from handlers to callers, how they are wrapped in `CommandExecutionException` / `QueryExecutionException`, how to translate them locally with `@ExceptionHandler`, and how handler timeouts work. For dispatching and reading results see `commands/dispatching.md` and `queries/query-handling.md`; for cross-cutting handling across many handlers see `foundations/interceptors.md`.

---

## Results vs. exceptions

Reserve exceptions for *truly exceptional* cases: programming errors, infrastructure failures, missing configuration. For *expected* failures — validation errors, business-rule violations, authorization failures, "not found" — prefer returning a structured **result object**. Exceptions lose most of their value across application or language boundaries (stack traces and class names may be meaningless to the receiver), so a result is easier to act on.

```java
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;
import org.axonframework.modelling.annotation.InjectEntity;

class EnrollmentCommandHandler {

    // Expected failure -> result object, not an exception
    @CommandHandler
    EnrollmentResult handle(EnrollStudent command,
                            @InjectEntity Course course,
                            EventAppender events) {
        if (course.isFull()) {
            return EnrollmentResult.rejected("Course is full");
        }
        events.append(new StudentEnrolled(command.courseId(), command.studentId()));
        return EnrollmentResult.accepted();
    }
}
```

> Before throwing, ask whether a result object would serve the caller better. Throw only when normal processing cannot continue.

---

## How exceptions reach the caller

Because the command and query sides may run in separate applications that do not share exception classes, Axon **generifies** failures from message handling. The base type is `HandlerExecutionException` (`org.axonframework.messaging.core`), with two concrete subtypes:

| Exception | Package | Raised for |
|---|---|---|
| `CommandExecutionException` | `org.axonframework.messaging.commandhandling` | A failed command handler |
| `QueryExecutionException` | `org.axonframework.messaging.queryhandling` | A failed query handler |

Since an event message is unidirectional and produces no return value, these execution exceptions apply to **commands and queries only** — not to event handling.

### Query side

The annotated query-handling component wraps any handler failure that is not already a `QueryExecutionException`:

```java
// AnnotatedQueryHandlingComponent, simplified
if (handlingException.isPresent()
        && !(handlingException.get() instanceof QueryExecutionException)) {
    return MessageStream.failed(new QueryExecutionException(
            "Handling query with identifier [" + query.identifier() + "] failed.",
            handlingException.get()));
}
```

The caller therefore always observes a `QueryExecutionException` whose `getCause()` is the original failure.

### Command side

When you block on a result with `CommandGateway.sendAndWait(...)` (or `CommandResult.wait(...)`), the framework rethrows the cause:

- A `RuntimeException` cause is rethrown **as-is** (not re-wrapped), so your own unchecked exception type reaches the caller directly.
- An `Error` is rethrown as-is.
- A *checked* exception is wrapped in a `CommandExecutionException` (`"Checked exception while handling command."`).
- A thread interrupt while waiting also surfaces as a `CommandExecutionException`.

```java
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.axonframework.messaging.commandhandling.CommandExecutionException;

try {
    commands.sendAndWait(new EnrollStudent(courseId, studentId), Void.class);
} catch (CourseFullException ex) {        // your RuntimeException, rethrown as-is
    // handle the business failure
} catch (CommandExecutionException ex) {  // wrapped checked/infrastructure failure
    Throwable original = ex.getCause();
    // log, retry, present an error...
}
```

> The non-blocking `CommandGateway.send(...)` returns a `CommandResult`; use `onError(Consumer<Throwable>)` to react to failures without blocking. See `commands/dispatching.md`.

---

## Carrying structured detail across boundaries

`HandlerExecutionException` (and both subtypes) can carry an application-specific `details` object. This survives transmission across a distributed boundary even when the original exception class does not, letting the receiver make decisions (retry, error presentation, recovery) without depending on the sender's types.

```java
import org.axonframework.messaging.commandhandling.CommandExecutionException;
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.modelling.annotation.InjectEntity;

import java.util.Map;

class EnrollmentCommandHandler {

    @CommandHandler
    void handle(EnrollStudent command, @InjectEntity Course course) {
        if (registrarSystemDown()) {
            throw new CommandExecutionException(
                    "Registrar unavailable",
                    null,                               // cause
                    Map.of("errorCode", "REGISTRAR_DOWN",
                           "retryable", "true"));        // details (any Object)
        }
    }
}
```

The `details` may be any `Object` — a `Map`, a domain failure record, or a status enum. On the receiving end, read it back from the exception:

```java
import org.axonframework.messaging.core.HandlerExecutionException;

catch (CommandExecutionException ex) {
    Optional<Map<String, String>> details = ex.getDetails();
    // or, walking the cause chain for the nearest detail-carrying exception:
    Optional<Map<String, String>> resolved =
            HandlerExecutionException.resolveDetails(ex);
}
```

`getDetails()` returns the details attached to this exception; the static `resolveDetails(Throwable)` walks the `cause` chain and returns the first `HandlerExecutionException` details it finds.

> Constructors for `CommandExecutionException` / `QueryExecutionException`: `(message, cause)`, `(message, cause, details)`, and `(message, cause, details, writableStackTrace)`. By default these exceptions **do not** generate a stack trace; pass `writableStackTrace = true` to force one.

---

## Handler-local translation with `@ExceptionHandler`

`@ExceptionHandler` (`org.axonframework.messaging.core.interception.annotation`) marks a method that reacts to exceptions thrown by **message handlers in the same class**. It is a component-level interceptor specialized for exceptional results: it runs *after* a handler throws and can either suppress the exception (by returning normally) or translate it (by throwing a different one).

```java
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.commandhandling.CommandExecutionException;
import org.axonframework.messaging.commandhandling.CommandMessage;
import org.axonframework.messaging.core.interception.annotation.ExceptionHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;

class CourseCommandHandler {

    @CommandHandler
    void handle(CreateCourse command, EventAppender events) {
        if (command.capacity() <= 0) {
            throw new InvalidCapacityException("capacity must be positive");
        }
        events.append(new CourseCreated(command.courseId(), command.name(), command.capacity()));
    }

    // Translate a domain exception into a detail-carrying execution exception
    @ExceptionHandler
    void on(InvalidCapacityException ex, CommandMessage command) {
        throw new CommandExecutionException("Bad command: " + ex.getMessage(), ex);
    }
}
```

### Selecting which exceptions a handler sees

A method matches when its parameters fit the combination of the handled message and the thrown exception. Narrow the scope in two ways:

- **By the exception parameter type** — declare the exception type you want as a parameter.
- **By the `resultType` attribute** — defaults to `Exception.class` (all exceptions).
- **By message type** — declare a `CommandMessage` / `QueryMessage` / `EventMessage` parameter, or set the `messageType` attribute.

```java
// Reacts to every exception from handlers in this class
@ExceptionHandler
void onAny(Exception ex) { /* ... */ }

// Only IllegalStateException, via the attribute
@ExceptionHandler(resultType = IllegalStateException.class)
void onIllegalState() { /* ... */ }

// Only when the failing message was a command for this payload type
@ExceptionHandler
void onSomeCommand(EnrollStudent command, IllegalStateException ex) { /* ... */ }
```

Do not rely on a guaranteed invocation order between *multiple matching* `@ExceptionHandler` methods — most-specific-first prioritization is not finalized in 5.2.0. Keep matching unambiguous by narrowing with `resultType` and parameter types.

> `@ExceptionHandler` works on entities since 5.0; support on plain command, event, and query handling components (as shown above) is available **from 5.2.0**.

### Suppress vs. propagate

The method body decides the outcome:

```java
// Suppress: returning normally swallows the exception; the handler result completes successfully
@ExceptionHandler
void onException() {
    // log and recover — caller sees no error
}

// Propagate / translate: throwing sends a (possibly different) exception onward
@ExceptionHandler
void onException(RuntimeException ex) {
    throw ex;                       // rethrow unchanged
}
```

If no `@ExceptionHandler` matches (for example, `resultType` does not match the thrown type), the original exception propagates unchanged.

> An `@ExceptionHandler` is a result handler and **cannot** also declare a `MessageHandlerInterceptorChain` parameter — combining the two is a configuration error. For chain-aware, cross-handler interception use a regular interceptor (`foundations/interceptors.md`).

| Parameter you declare | What you receive |
|---|---|
| `Exception` (or a subtype) | The thrown exception, filtered by type |
| `CommandMessage` / `QueryMessage` / `EventMessage` | The message being handled when it failed |
| Command/query payload type | Matches only that message, gives the payload |

### Declarative exception handlers (5.2.0+)

To attach an exception handler without annotations — for example one reusable logger across modules — implement `MessageHandlingExceptionHandler` (`org.axonframework.messaging.core`) or one of its specializations (`CommandHandlingExceptionHandler`, `EventHandlingExceptionHandler`, `QueryHandlingExceptionHandler`):

```java
MessageStream<? extends Message> handle(M message, ProcessingContext context, Throwable error);
```

Return `MessageStream.empty()` to suppress, `MessageStream.failed(throwable)` to propagate (the same or a translated exception); a `CommandHandlingExceptionHandler` may also return `MessageStream.just(resultMessage)` to substitute a result. Register with `withExceptionHandler(...)` on `CommandHandlingModule`, `QueryHandlingModule`, or the event `EventHandlingComponentsConfigurer`:

```java
CommandHandlingModule.named("enrollment")
        .commandHandlers()
        .autodetectedCommandHandlingComponent(c -> new EnrollmentCommandHandler())
        .withExceptionHandler(c -> (cmd, ctx, error) -> {
            log.error("Command {} failed", cmd.payloadType().getSimpleName(), error);
            return MessageStream.failed(error);
        });
```

Multiple calls accumulate; later-registered handlers run closer to the handler and see exceptions first.

---

## Handler timeouts

Axon can interrupt handlers that run too long and log warnings as they approach the limit. Two thresholds govern this:

- `timeoutMs` — after this elapsed time the handler (or transaction) is interrupted.
- `warningThreshold` — after this time a warning is logged; another is logged every `warningInterval` thereafter.

Both warnings and the interruption are logged at `WARN`, including the handler/component name, time spent, time remaining, and a stack trace of the running thread — useful for spotting a handler blocked on, say, an HTTP call that never returns.

### Per-handler override with `@MessageHandlerTimeout`

Place `@MessageHandlerTimeout` (`org.axonframework.messaging.core.annotation`) on a `@CommandHandler`, `@QueryHandler`, or `@EventHandler` method to override the configured defaults for that handler:

```java
import org.axonframework.messaging.core.annotation.MessageHandlerTimeout;
import org.axonframework.messaging.eventhandling.annotation.EventHandler;

class EnrollmentProjection {

    @EventHandler
    @MessageHandlerTimeout(timeoutMs = 10000, warningThresholdMs = 5000, warningIntervalMs = 1000)
    void on(StudentEnrolled event) {
        // ... work that should finish well within 10s
    }
}
```

Each attribute defaults to `-1`, meaning "use the configured default". Set `timeoutMs = -1` to fall back to the global timeout, or set `warningThresholdMs` higher than the timeout to disable warnings for that handler.

### Configuring defaults

The timeout configuration types live in `org.axonframework.messaging.core.timeout` — chiefly `HandlerTimeoutConfiguration`, which holds separate `TaskTimeoutSettings` for events, commands, queries, and deadlines (all disabled by default when constructed directly). On timeout the handler thread is interrupted and an `AxonTimeoutException` is raised.

**Plain Java:** no timeouts are applied by default — register a `HandlerTimeoutHandlerEnhancerDefinition` (built from a `HandlerTimeoutConfiguration`) yourself; it is not ServiceLoader-registered.

**Spring Boot:** timeouts are **enabled by default** and configured via `axon.timeout.*` properties:

```properties
# Disable all timeouts and warnings (also disables annotation-based timeouts)
axon.timeout.enabled=false

# Per-message-handler timeouts (defaults: timeout-ms=30000, warning-threshold-ms=10000, warning-interval-ms=1000)
axon.timeout.handler.events.timeout-ms=10000
axon.timeout.handler.commands.warning-threshold-ms=5000
# also: axon.timeout.handler.queries.*, axon.timeout.handler.deadlines.*

# Whole-transaction (unit-of-work) timeouts (defaults: 60000 / 10000 / 1000)
axon.timeout.transaction.command-bus.timeout-ms=30000
axon.timeout.transaction.event-processors.timeout-ms=120000        # all processors
axon.timeout.transaction.event-processor.my-projection.timeout-ms=300000  # one named processor
# also: axon.timeout.transaction.query-bus.*, axon.timeout.transaction.deadline.*
```

---

## When this guide does not apply

For consistent handling across *many* handlers — logging every failure, converting exceptions to results, adding correlation IDs — use a message interceptor rather than per-class `@ExceptionHandler` methods; see `foundations/interceptors.md`. For dispatch-side handling of command results (`onError`, blocking vs. non-blocking) see `commands/dispatching.md`, and for query result and subscription handling see `queries/query-handling.md`.
