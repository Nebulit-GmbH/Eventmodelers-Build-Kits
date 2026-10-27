# Interceptors in Axon Framework 5

AF5 provides two interception points for every message type (command, event, query):

| Level | Interface | When it runs | Has `ProcessingContext`? |
|---|---|---|---|
| **Dispatch** | `MessageDispatchInterceptor` | Before the message reaches the bus | No |
| **Handler** | `MessageHandlerInterceptor` | Around the handler invocation | Yes |

Both can transform, reject, enrich, or observe messages.

---

## MessageDispatchInterceptor

Runs before dispatch. Use it to enrich metadata, validate, or reject messages before they enter the bus. No `ProcessingContext` is active yet.

```java
import org.axonframework.messaging.core.MessageDispatchInterceptor;

public class CorrelationEnrichingInterceptor<M extends Message>
        implements MessageDispatchInterceptor<M> {

    @Override
    public MessageStream<?> interceptOnDispatch(M message,
                                                @Nullable ProcessingContext context,
                                                MessageDispatchInterceptorChain<M> chain) {
        var enriched = (M) message.andMetadata(Map.of(
                "correlationId", UUID.randomUUID().toString(),
                "sentAt", Instant.now().toString()));
        return chain.proceed(enriched, context);
    }
}
```

Register on a specific bus type:

```java
configurer
    .registerCommandDispatchInterceptor(c -> new CorrelationEnrichingInterceptor<>())
    .registerEventDispatchInterceptor(c -> new CorrelationEnrichingInterceptor<>())
    .registerQueryDispatchInterceptor(c -> new CorrelationEnrichingInterceptor<>());
```

---

## MessageHandlerInterceptor

Runs around the handler invocation with an active `ProcessingContext`. Use it for logging, metrics, transaction demarcation, or cross-cutting validation that needs framework resources.

```java
import org.axonframework.messaging.core.MessageHandlerInterceptor;

public class AuditLoggingInterceptor implements MessageHandlerInterceptor<CommandMessage> {

    private static final Logger log = LoggerFactory.getLogger(AuditLoggingInterceptor.class);

    @Override
    public MessageStream<?> interceptOnHandle(CommandMessage message,
                                              ProcessingContext context,
                                              MessageHandlerInterceptorChain<CommandMessage> chain) {
        log.info("Handling {} [{}]", message.payloadType().getSimpleName(), message.identifier());
        var result = chain.proceed(message, context);
        log.info("Handled  {} [{}]", message.payloadType().getSimpleName(), message.identifier());
        return result;
    }
}
```

Register on a specific bus type:

```java
configurer
    .registerCommandHandlerInterceptor(c -> new AuditLoggingInterceptor())
    .registerEventHandlerInterceptor(c -> new EventAuditInterceptor())
    .registerQueryHandlerInterceptor(c -> new QueryAuditInterceptor());
```

To scope an interceptor to a single handling module instead of the whole bus, use `intercepted(...)` on `CommandHandlingModule` / `QueryHandlingModule` (applies to that module's component) or on the event `EventHandlingComponentsConfigurer` (applies to all event handling components registered in that configurer).

---

## Annotated interceptor methods — within a handler class (5.2.0+)

From 5.2.0, declare an interceptor method directly on a command/event/query handling class with `@CommandHandlerInterceptor`, `@EventHandlerInterceptor`, or `@QueryHandlerInterceptor` (packages `org.axonframework.messaging.{commandhandling,eventhandling,queryhandling}.interception.annotation`). The method runs around every matching handler **in the same class**. Two method styles:

- **Before-interceptor** — no `MessageHandlerInterceptorChain` parameter, returns `void` (or `CompletableFuture<Void>`). Runs before the handler; the chain proceeds automatically when it returns normally. Throwing prevents the handler from being invoked.
- **Surround-interceptor** — declares a `MessageHandlerInterceptorChain` parameter and returns a `MessageStream`. It decides whether/when to call `chain.proceed(message, context)`, and can short-circuit by returning without proceeding.

```java
class EnrolmentCommandHandler {

    @CommandHandlerInterceptor
    void validate(CommandMessage command) {
        // Before-interceptor: runs before every @CommandHandler in this class;
        // throwing here prevents the handler from running.
    }

    @CommandHandlerInterceptor
    MessageStream<?> around(CommandMessage command,
                            ProcessingContext context,
                            MessageHandlerInterceptorChain chain) {
        log.debug("Handling {}", command.payloadType().getSimpleName());
        return chain.proceed(command, context);   // surround: full control
        // ...or short-circuit: return MessageStream.failed(new AccessDeniedException(...));
    }

    @CommandHandler
    void handle(EnrollStudent command, EventAppender events) { ... }

    @CommandHandler
    void handle(WithdrawStudent command, EventAppender events) { ... }
}
```

Interceptor methods may declare the message (`CommandMessage`/`EventMessage`/`QueryMessage`), `ProcessingContext`, and (surround style only) the chain. A non-void interceptor method **must** declare the chain parameter — this is validated at registration. Multiple before-interceptors in one class run in alphabetical method-name order.

---

## @ExceptionHandler — declarative exception translation

Intercept exceptions thrown by handlers in the same class and translate, log, or rethrow them:

```java
class EnrolmentCommandHandler {

    @CommandHandler
    void handle(EnrollStudent command, EventAppender events) {
        if (capacityExceeded()) throw new CapacityExceededException(command.courseId());
        events.append(new StudentEnrolled(command.courseId(), command.studentId()));
    }

    @ExceptionHandler(resultType = CapacityExceededException.class)
    void onCapacityExceeded(CapacityExceededException ex, CommandMessage cmd) {
        // Translate to a domain exception with a user-facing message
        throw new CourseFullException(
                "Course " + ex.courseId() + " has no remaining capacity");
    }

    @ExceptionHandler  // catches any exception not handled by a more specific handler
    void onUnexpected(Exception ex, CommandMessage cmd) {
        log.error("Unexpected failure handling {}", cmd.payloadType().getSimpleName(), ex);
        throw ex;   // rethrow — do not swallow
    }
}
```

`@ExceptionHandler` methods run as part of the interceptor chain — the exception is caught *after* the handler fails, giving you a clean translation layer without try/catch in handler code.

---

## CorrelationDataInterceptor

Automatically included in the default AF5 configuration. It reads correlation data from the current message (via registered `CorrelationDataProvider`s) and propagates it as metadata on all outgoing messages produced during that handler's execution.

To add custom correlation data, register a provider:

```java
configurer.componentRegistry(cr -> cr.registerComponent(
        CorrelationDataProvider.class,
        config -> message -> {
            // Extract whatever you want to propagate
            var meta = new HashMap<String, String>();
            message.metadata().getOrDefault("traceId", null);
            if (message.metadata().containsKey("traceId")) {
                meta.put("traceId", (String) message.metadata().get("traceId"));
            }
            return meta;
        }));
```

---

## BeanValidationInterceptor

Validates command (or query) payloads against Jakarta Bean Validation (`@NotNull`, `@NotBlank`, `@Positive`, etc.) before the handler runs. Violations throw a validation exception at the dispatch level.

```java
// Register on command dispatch
configurer.registerCommandDispatchInterceptor(
        config -> new BeanValidationInterceptor<>());
```

Annotate your command:

```java
public record EnrollStudent(
        @NotBlank String courseId,
        @NotBlank String studentId,
        @Positive int seatNumber
) {}
```

Any violation surfaces before the handler is called.

---

## RetryPolicy and RetryScheduler

Configure automatic retry for transient failures (e.g., `AppendEventsTransactionRejectedException` from concurrent DCB writes, or transient infrastructure errors):

```java
import org.axonframework.messaging.core.retry.RetryPolicy;
import org.axonframework.messaging.core.retry.AsyncRetryScheduler;

RetryPolicy policy = (message, failure, previousFailures) -> {
    boolean isTransient = failure instanceof AppendEventsTransactionRejectedException
                       || failure instanceof OptimisticLockException;
    if (isTransient && previousFailures.size() < 3) {
        // Exponential back-off: 50 ms, 100 ms, 200 ms
        long delay = 50L * (1L << previousFailures.size());
        return RetryPolicy.Outcome.rescheduleIn(delay, TimeUnit.MILLISECONDS);
    }
    return RetryPolicy.Outcome.doNotReschedule();
};

configurer.componentRegistry(cr -> cr.registerComponent(
        RetryScheduler.class,
        config -> new AsyncRetryScheduler(policy, Executors.newSingleThreadScheduledExecutor())));
```

From 5.2.0, registering a `RetryScheduler` component is the *only* step needed: the framework automatically wraps the `CommandBus` in the `RetryingCommandBus` decorator when one is present (and leaves the bus undecorated otherwise). Retried dispatches pass through the interceptor chain again. This is the recommended way to handle DCB conflicts at the infrastructure level rather than in handler code.
