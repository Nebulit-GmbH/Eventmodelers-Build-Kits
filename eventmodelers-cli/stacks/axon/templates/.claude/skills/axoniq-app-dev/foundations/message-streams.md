# MessageStream — AF5 Reference

`MessageStream<M>` (`org.axonframework.messaging.core.MessageStream`) is the unified, pull-based stream abstraction AF5 uses wherever a handler or infrastructure component yields zero, one, or many messages. You meet it in two roles:

- **As something you consume** — `EventStoreTransaction.source(...)` returns a `MessageStream<? extends EventMessage>` that you fold into decision state (see `commands/decision-models-dcb.md` and `event-store/primitives.md`).
- **As something you produce** — low-level command/query handlers and interceptors return a `MessageStream<?>` (see `foundations/interceptors.md`, `foundations/handler-customization.md`, `foundations/exception-handling.md`, and the `MessagingConfigurer` examples in `configuration/plain-java.md`).

> **Not reactive by itself.** `MessageStream` is a pull model (`next()`/`reduce()`), *not* a `Flux`, and has no `asFlux()`/`asMono()` — don't reach for Reactor types in ordinary handler/interceptor code. If you genuinely need a bridge, it's static helpers on `FluxUtils` (`of` / `asMessageStream` / `streamToPublisher`) in the **core** `messaging` module, gated on an optional `reactor-core` dependency — *not* a separate extension. (The **axon-reactor** extension is a separate thing: native-reactive *gateways*, not this stream bridge.)

---

## Entries, not bare messages

A `MessageStream` yields `MessageStream.Entry<M>` items, not `M` directly. An `Entry` wraps the message together with a context (`Entry extends Context`), which is how out-of-band data such as the `ConsistencyMarker` rides along on the terminal entry of a sourced stream.

```java
import org.axonframework.messaging.core.MessageStream;

// Inside a reduce/map callback you receive an Entry — call message() to get the payload-carrying Message:
(state, entry) -> state.apply(entry.message())
```

| `Entry<M>` method | Returns | Purpose |
|---|---|---|
| `message()` | `M` | The contained `Message` (then `.payload()`, `.type()`, `.getMetaData()`, …) |
| `map(Function<M, RM>)` | `Entry<RM>` | Replace the contained message |
| `getResource(ResourceKey<T>)` | `T` | Read a context resource (inherited from `Context`) — e.g. `ConsistencyMarker.RESOURCE_KEY` |
| `withResource(ResourceKey<T>, T)` | `Entry<M>` | Attach a context resource |

---

## Creating a stream (static factories)

Use these when a handler or interceptor must *return* a `MessageStream`.

```java
import org.axonframework.messaging.core.MessageStream;

MessageStream.fromItems(messageA, messageB)   // varargs of Messages          → MessageStream<M>
MessageStream.fromIterable(listOfMessages)     // Iterable<? extends M>         → MessageStream<M>
MessageStream.fromStream(javaStream)           // java.util.stream.Stream       → MessageStream<M>
MessageStream.just(singleMessage)              // 0..1 message (null allowed)   → Single<M>
MessageStream.fromFuture(completableFuture)    // resolves to one message       → Single<M>
MessageStream.empty()                          // completes with no entries     → Empty<M>
MessageStream.failed(throwable)                // completes exceptionally        → Empty<M>
```

`fromIterable`, `fromStream`, `fromFuture`, and `just` each have an overload taking a context supplier when entries need attached resources. `fromStream` also has a 3-arg form `(Stream<T>, messageMapper, contextSupplier)` to wrap arbitrary objects as messages.

```java
// A low-level handler that produces one result message:
(command, context) -> MessageStream.fromItems(resultMessage);

// A handler/interceptor that produces nothing — cast the Empty to the expected element type:
(command, context) -> MessageStream.empty().cast();

// Signal failure from a handler:
return MessageStream.failed(new QueryExecutionException("no data", cause));
```

---

## Consuming a stream

### `reduce` — fold a bounded stream (the DCB workhorse)

`reduce(identity, accumulator)` folds every entry into a single value and returns a `CompletableFuture<R>`. The accumulator receives `(R, Entry<M>)`. **Bounded streams only** — it throws `UnsupportedOperationException` on an unbounded stream, and processing is strictly sequential (no parallelism).

```java
EnrolmentState state = tx.source(SourcingCondition.conditionFor(criteria))
        .reduce(EnrolmentState.empty(),
                (s, entry) -> s.apply(entry.message()))   // note entry.message()
        .orTimeout(30, TimeUnit.SECONDS)
        .join();
```

### `collect` — mutable reduction (5.2.0+)

`collect(containerSupplier, accumulator)` folds a bounded stream into a mutable container, like `Stream.collect`. The accumulator receives the **message** (not the `Entry`); mutate the container in place.

```java
CompletableFuture<List<EventMessage>> events =
        someStream.collect(ArrayList::new, List::add);
```

Like `reduce`, it throws `UnsupportedOperationException` on unbounded streams and runs strictly sequentially.

### `first` and `Single.asCompletableFuture`

`first()` returns a `Single<M>` carrying only the first entry (then closing the source). On a `Single`, `asCompletableFuture()` drives full consumption and completes with the first observed `Entry<M>` (or `null` if none).

```java
CompletableFuture<MessageStream.Entry<EventMessage>> firstEntry =
        someStream.first().asCompletableFuture();
```

> `asCompletableFuture()` lives on `Single<M>`, not on the base `MessageStream`, and yields a `CompletableFuture<Entry<M>>` (an `Entry`, not a bare payload). To narrow to a single result first, call `.first()`.

### Imperative pull

For infrastructure code, drain the stream by hand. These never block:

| Method | Returns | Notes |
|---|---|---|
| `next()` | `Optional<Entry<M>>` | Take the next entry, advancing the stream |
| `peek()` | `Optional<Entry<M>>` | Look at the next entry without advancing |
| `hasNextAvailable()` | `boolean` | Is an entry ready now? |
| `isCompleted()` | `boolean` | Has the stream completed (normally or with error)? |
| `error()` | `Optional<Throwable>` | The failure, if it completed exceptionally |
| `setCallback(Runnable)` | `void` | Invoked when entries become available or the stream completes |
| `close()` | `void` | Release the stream early |

---

## Transforming a stream

All of these return a new `MessageStream` (lazy; the source completes the returned stream the same way it completes itself):

| Method | Effect |
|---|---|
| `map(Function<Entry<M>, Entry<RM>>)` | Transform each entry |
| `mapMessage(Function<M, RM>)` | Transform the contained message of each entry |
| `filter(Predicate<Entry<M>>)` | Drop entries that fail the predicate |
| `flatMap(Function<Entry<M>, MessageStream<N>>)` | 5.2.0+ — map each entry to an inner stream, concatenated in order (next inner stream starts only after the current completes; an inner error propagates) |
| `mapMulti(BiConsumer<Entry<M>, Consumer<Entry<N>>>)` | 5.2.0+ — synchronous 0-to-N expansion per entry; cheaper than `flatMap` when no inner stream is needed |
| `concatWith(MessageStream<? extends M>)` | Continue with another stream after this one completes normally |
| `onNext(Consumer<Entry<M>>)` | Side-effect per entry |
| `onComplete(Runnable)` | Side-effect on normal completion |
| `onErrorContinue(Function<Throwable, MessageStream<? extends M>>)` | Switch to a replacement stream on error |
| `onClose(Runnable)` | Side-effect when the stream is closed |
| `cast()` | Reinterpret the element type (use after `empty()`/`ignoreEntries()`) |
| `ignoreEntries()` | Consume and discard all entries, completing as an `Empty<M>` (still runs upstream callbacks) |

---

## The `Single` and `Empty` subtypes

- **`Single<M>`** — at most one entry. Returned by `just`, `fromFuture`, and `first()`. Adds `asCompletableFuture()`; its `map`/`filter`/etc. return `Single`.
- **`Empty<M>`** (extends `Single<M>`) — completes with no entries. Returned by `empty()`, `failed()`, and `ignoreEntries()`. `map`/`reduce` on it do nothing.

Returning the narrowest type that fits (`Single`/`Empty`) communicates intent and lets callers skip needless consumption logic.

---

## Where this shows up

| Context | Stream role | Guide |
|---|---|---|
| Sourcing events in a DCB handler | consume via `reduce` + `entry.message()` | `commands/decision-models-dcb.md`, `event-store/primitives.md` |
| Extracting the `ConsistencyMarker` | `entry.getResource(ConsistencyMarker.RESOURCE_KEY)` on the terminal entry | `event-store/primitives.md` |
| Low-level command/query handler | produce via `fromItems`/`empty().cast()`/`failed` | `configuration/plain-java.md`, `commands/stateless.md` |
| Interceptors | return `MessageStream<?>` from `interceptOnHandle`/`interceptOnDispatch` | `foundations/interceptors.md` |
| Handler enhancers | `handle(...)` returns `MessageStream<?>` | `foundations/handler-customization.md` |
| Translating handler errors | `MessageStream.failed(...)` | `foundations/exception-handling.md` |
