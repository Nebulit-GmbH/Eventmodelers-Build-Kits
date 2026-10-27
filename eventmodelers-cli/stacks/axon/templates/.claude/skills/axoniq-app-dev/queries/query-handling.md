# Query Handling in Axon Framework 5

Query handlers serve read requests. The query bus routes a query to a registered handler by matching the query payload's `QualifiedName` to the handler's registered name.

---

## Writing a query handler

Annotate any method with `@QueryHandler`. The first parameter type determines which query is matched. The return value is the response.

```java
import org.axonframework.messaging.queryhandling.annotation.QueryHandler;

class CoursesQueryHandler {

    @QueryHandler
    CourseView handle(GetCourseById query) {
        return repository.findById(query.courseId())
                         .orElseThrow(() -> new CourseNotFoundException(query.courseId()));
    }

    @QueryHandler
    List<CourseView> handle(FindAllCourses query) {
        return repository.findAll();
    }

    @QueryHandler
    Page<CourseView> handle(FindCoursesPaged query) {
        return repository.findAll(PageRequest.of(query.page(), query.size()));
    }
}
```

### Resolved parameters

| Parameter | What you get |
|---|---|
| First param (any type) | Query payload — determines routing |
| `@MetadataValue("key") String` | A single value from the query's metadata |
| `Metadata` | The full metadata map |
| `ProcessingContext` | The active processing context |

```java
@QueryHandler
List<CourseView> handle(FindAllCourses query,
                        @MetadataValue("tenantId") String tenant) {
    return repository.findByTenant(tenant);
}
```

---

## Dispatching queries

Obtain `QueryGateway` (`org.axonframework.messaging.queryhandling.gateway.QueryGateway`) from the framework configuration. In Spring Boot it is auto-configured as a bean — inject it directly.

### Point query — one handler, one result

```java
import org.axonframework.messaging.queryhandling.gateway.QueryGateway;

// Async
CompletableFuture<CourseView> future = queryGateway.query(
        new GetCourseById(courseId), CourseView.class);

// Blocking
CourseView view = queryGateway.query(new GetCourseById(courseId), CourseView.class)
                              .orTimeout(30, TimeUnit.SECONDS)
                              .join();
```

### Scatter-gather — all handlers, collected results

Use `queryMany` when the query handler returns `List<T>`. The gateway collects results from all matching handlers into one list. This is the correct method for `@QueryHandler` methods that return `List<T>`:

```java
// Handler returns List<CourseView> — use queryMany on the caller side:
CompletableFuture<List<CourseView>> all = queryGateway.queryMany(
        new FindAllCourses(), CourseView.class);

// Block with timeout:
List<CourseView> views = queryGateway.queryMany(new FindAllCourses(), CourseView.class)
        .orTimeout(10, TimeUnit.SECONDS)
        .join();
```

### Streaming query — large result sets

```java
Publisher<CourseView> stream = queryGateway.streamingQuery(
        new FindAllCourses(), CourseView.class);

Flux.from(stream)
    .doOnNext(view -> process(view))
    .blockLast();
```

---

## Subscription queries — initial result + live updates

A subscription query returns the current result immediately, then streams updates as the underlying data changes.

### Subscriber side

```java
Publisher<CourseStats> updates = queryGateway.subscriptionQuery(
        new GetCourseStats(courseId), CourseStats.class);

Flux.from(updates)
    .doOnNext(stats -> ui.refresh(stats))
    .doOnComplete(() -> log.info("subscription closed"))
    .subscribe();
```

The first emission is the current query result. Subsequent emissions are updates pushed by the server via `QueryUpdateEmitter`. (`subscriptionQuery` is the bare `Publisher<R>` form — there is no `SubscriptionQueryResult` wrapper in AF5; the initial result and updates arrive on the same stream.)

`subscriptionQuery` has overloads that add a `mapper` and an `int updateBufferSize` to bound the backpressure buffer (default `Queues.SMALL_BUFFER_SIZE`). The mapper is a `Function<QueryResponseMessage, R>` — it receives the raw response *message* (not the payload), so you can read metadata as well as the payload:

```java
import org.axonframework.messaging.queryhandling.QueryResponseMessage;

Publisher<CourseStatsDto> updates = queryGateway.subscriptionQuery(
        new GetCourseStats(courseId), CourseStatsDto.class,
        (QueryResponseMessage response) -> toDto(response.payload()),   // Function<QueryResponseMessage, R>
        256);                                                           // updateBufferSize
```

For a native `Flux` API (rather than wrapping with `Flux.from(...)`), use the **axon-reactor** extension's `ReactorQueryGateway`.

### Bridging to Server-Sent Events on the servlet stack — keep-alive required

The Axon subscription query lives as long as its reactive subscription does: cancelling the `Flux` (client gone, `dispose()`, completion) propagates up `Flux.from(subscriptionQuery)` and closes the query server-side. On **Spring MVC (servlet stack)** that cancellation is only triggered by a **failed write** — there is no client-disconnect callback. When a browser closes its `EventSource`, Spring doesn't notice until it next writes and gets a broken-pipe `IOException`. So an idle stream whose client has silently disconnected keeps its subscription query open indefinitely (and the projection keeps emitting updates nobody consumes). `SseEmitter.onTimeout`/`onCompletion`/`onError` don't help — without a write, nothing fires them.

Mitigate by merging a periodic keep-alive (an SSE comment, ignored by `EventSource`) into the stream. The heartbeat write fails on a dead connection, triggering cancellation within one interval:

```java
@GetMapping(value = "/{id}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<CourseStats>> stream(@PathVariable String id) {
    return Flux.from(queryGateway.subscriptionQuery(new GetCourseStats(id), CourseStats.class))
            .filter(Objects::nonNull)
            .map(stats -> ServerSentEvent.builder(stats).build())
            .mergeWith(Flux.interval(Duration.ofSeconds(15))
                    .map(t -> ServerSentEvent.<CourseStats>builder().comment("keep-alive").build()));
}
```

The interval is the upper bound on how long a closed stream's subscription lingers. This applies equally to the `SseEmitter` form and to returning `Flux<ServerSentEvent<T>>` (which works in MVC via `ReactiveTypeHandler` with Reactor on the classpath, and lets Spring own cancellation — but disconnect detection is still write-triggered). On **WebFlux/Netty** the runtime is notified of connection close, so the keep-alive is not needed there.

### Publisher side — pushing updates from an event handler

When an event changes data that a subscription query is serving, push the new state to open subscribers:

```java
import org.axonframework.messaging.queryhandling.QueryUpdateEmitter;

class CoursesProjection {

    @EventHandler
    void on(StudentEnrolled event, QueryUpdateEmitter emitter) {
        var updated = repository.incrementEnrolment(event.courseId());

        // Push to subscribers of GetCourseStats where courseId matches
        emitter.emit(
                GetCourseStats.class,
                query -> query.courseId().equals(event.courseId()),
                updated);

        // Push to all FindAllCourses subscribers
        emitter.emit(FindAllCourses.class, q -> true, updated);
    }

    @EventHandler
    void on(CourseDeleted event, QueryUpdateEmitter emitter) {
        repository.delete(event.courseId());

        // Signal that subscriptions for this course are done
        emitter.complete(GetCourseStats.class,
                         q -> q.courseId().equals(event.courseId()));
    }
}
```

### QueryUpdateEmitter API

```java
// Emit update to matching subscribers (by query type + predicate)
emitter.emit(QueryType.class, predicate, updatePayload)

// Emit via lazy supplier (only evaluated if there are subscribers)
emitter.emit(QueryType.class, predicate, () -> computeUpdate())

// Close all matching subscriptions — no more updates
emitter.complete(QueryType.class, predicate)

// Close matching subscriptions with an error
emitter.completeExceptionally(QueryType.class, predicate, new SomeException("reason"))
```

---

## Registering query handlers

```java
MessagingConfigurer.create()
    .queries(q -> q
        .module(QueryHandlingModule
            .named("courses-queries")
            .queryHandlers()
            .autodetectedQueryHandlingComponent(
                config -> new CoursesQueryHandler(repository)))
    );
```

`autodetectedQueryHandlingComponent` wraps the object in `AnnotatedQueryHandlingComponent`, which discovers all `@QueryHandler` methods and registers them.

---

## Multiple handlers for the same query

By default, having two handlers registered for the same query name is an error. For scatter-gather scenarios where each node contributes a partial result, multiple handlers are intentional — configure the bus to allow it when setting up `QueryHandlingModule`.

---

## No-handler behaviour

If no handler is registered for a query, the bus throws `NoHandlerForQueryException`. Callers can catch this to return a sensible default:

```java
try {
    return queryGateway.query(new GetCourseById(id), CourseView.class)
                       .orTimeout(30, TimeUnit.SECONDS)
                       .join();
} catch (CompletionException e) {
    if (e.getCause() instanceof NoHandlerForQueryException) return Optional.empty();
    throw e;
}
```
