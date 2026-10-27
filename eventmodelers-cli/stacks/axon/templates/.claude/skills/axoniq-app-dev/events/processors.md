# Event Processors in Axon Framework 5

Event processors are the technical components that invoke your event handlers — they start a unit of work, attach correlation data, manage threading, sequencing, error handling, and transactions. This is the deep reference; for writing handlers, replay annotations, sequencing policies, and the dead letter queue see events/handling-projections.md, and for emitting events see events/publishing.md.

---

## The two processor types

Every event handler belongs to an **event handling component**, and every component belongs to exactly one processor. A processor is identified by name; two processors with the same name across JVMs are treated as instances of the same logical processor.

| | `SubscribingEventProcessor` | `PooledStreamingEventProcessor` (PSEP) |
|---|---|---|
| Event source | `SubscribableEventSource` (e.g. `EventBus`) | `StreamableEventSource` (e.g. `EventStore`) |
| Thread | Publishing thread | Own coordinator + worker thread pools |
| Transaction | Same TX as the publisher | Independent, slight lag |
| Tracking token | None | Yes — resumable, resilient |
| Replay / reset | No | Yes |
| Parallelism / segments | No (unless source provides it) | Yes |
| Dead letter queue | No | Yes |
| Default? | Only when no `StreamableEventSource` exists | **Yes** when an event store is present |

> **Which is the default?** It depends on the available event source. When an `EventStore` (a `StreamableEventSource`) is present — the common case — the PSEP is the default. With only an `EventBus`, the framework falls back to the `SubscribingEventProcessor`.

> **CQRS caution**: a `SubscribingEventProcessor` updating a projection runs in the publishing thread and transaction. That couples your read model to the command side — generally undesirable. Prefer the PSEP for query-model projections; reserve the subscribing processor for in-process, must-be-consistent reactions.

---

## SubscribingEventProcessor

The subscribing processor registers with a `SubscribableEventSource` and is invoked by the publishing thread, in the publishing order. With an `EventBus` source it only ever sees *current* events — no historical replay is possible.

```java
import org.axonframework.messaging.core.configuration.MessagingConfigurer;
import org.axonframework.messaging.eventhandling.EventBus;
import org.axonframework.messaging.eventhandling.configuration.EventHandlingComponentsConfigurer;
import org.axonframework.messaging.eventhandling.processing.subscribing.SubscribingEventProcessorsConfigurer;

public class AxonConfig {

    public void configureEventProcessing(MessagingConfigurer configurer) {
        configurer.eventProcessing(ep -> ep.subscribing(this::configureProcessor));
    }

    private SubscribingEventProcessorsConfigurer configureProcessor(
            SubscribingEventProcessorsConfigurer subscribing) {
        return subscribing.processor(
                "course-notifications",
                config -> config.eventHandlingComponents(this::components)
                                .customized((c, sub) -> sub.eventSource(c.getComponent(EventBus.class))));
    }

    private EventHandlingComponentsConfigurer.AdditionalComponentPhase components(
            EventHandlingComponentsConfigurer.RequiredComponentPhase component) {
        return component.autodetected(c -> new CourseNotificationHandler());
    }
}
```

> The `eventSource(...)` is **required** for a subscribing processor — without it the processor has nothing to subscribe to. In Spring Boot (5.2.0+), an `EventProcessorDefinition` bean may supply it (`.customized(cfg -> cfg.eventSource(...))`); when the `source` property is unset, Spring only applies a default source if a unique `SubscribableEventSource` resolves, leaving room for the definition to provide one. With Axon Server, a persistent stream can be the source — see [Persistent streams](#persistent-streams-axoniq-framework--axon-server-520) below.

**Error mode**: when the configured `ErrorHandler` rethrows, the subscribing processor lets the exception bubble back to the component that published the event, so the publisher can react.

---

## PooledStreamingEventProcessor

The PSEP pulls events from a `StreamableEventSource` using a tracking token, processing them on its own threads. It is the recommended processor for the vast majority of applications: decoupled, parallelizable, resilient across restarts, and replayable.

```java
import org.axonframework.messaging.core.configuration.MessagingConfigurer;
import org.axonframework.messaging.eventhandling.configuration.EventHandlingComponentsConfigurer;
import org.axonframework.messaging.eventhandling.processing.streaming.pooled.PooledStreamingEventProcessorsConfigurer;
import org.axonframework.messaging.eventstreaming.StreamableEventSource;

import java.time.Duration;

public class AxonConfig {

    public void configureEventProcessing(MessagingConfigurer configurer) {
        configurer.eventProcessing(ep -> ep.pooledStreaming(this::configureProcessor));
    }

    private PooledStreamingEventProcessorsConfigurer configureProcessor(
            PooledStreamingEventProcessorsConfigurer pooled) {
        return pooled
                // Defaults applied to every pooled streaming processor
                .defaults((config, psep) -> psep
                        .eventSource(config.getComponent(StreamableEventSource.class))
                        .initialSegmentCount(4)
                        .batchSize(100)
                        .claimExtensionThreshold(Duration.ofSeconds(5)))
                // A specific processor overriding a default
                .processor(
                        "courses-projection",
                        config -> config.eventHandlingComponents(this::components)
                                        .customized((c, psep) -> psep.initialSegmentCount(8)));
    }

    private EventHandlingComponentsConfigurer.AdditionalComponentPhase components(
            EventHandlingComponentsConfigurer.RequiredComponentPhase component) {
        return component.autodetected(c -> new CoursesProjection());
    }
}
```

When no customization is needed, replace `customized(...)` with `notCustomized()`.

### Configurable options

| Option | Meaning | Default |
|---|---|---|
| `eventSource(...)` | The `StreamableEventSource` to read from | the configured event store |
| `initialSegmentCount(int)` | Number of segments created on first start | 16 |
| `batchSize(int)` | Events processed per transaction per worker | 1 |
| `tokenStore(...)` | Where tracking tokens are persisted | `InMemoryTokenStore` |
| `tokenClaimInterval(...)` | Wait between attempts to claim/steal a segment | 5000 ms |
| `claimExtensionThreshold(...)` | Extend the token claim when no events arrive | 5000 ms |
| `initialToken(source -> ...)` | Where to start on first run | first token |
| `coordinatorExecutor(...)` | Thread pool that claims segments and fetches events | single thread |
| `workerExecutor(...)` | Thread pool that runs the handlers | single thread |
| `maxClaimedSegments(int)` | Cap on segments one instance will claim | (unbounded) |

**Error mode**: when the `ErrorHandler` rethrows, the PSEP aborts the failed segment and retries with an incremental back-off — starting at 1 second, doubling up to a 60-second maximum per attempt. The released segment is likely picked up quickly by another worker thread (or, in a multi-node setup, by another instance that ignores the local back-off).

---

## Tracking tokens

A `TrackingToken` marks a position on the event stream. It accompanies every event the PSEP receives and lets the processor (1) reopen the stream where it left off after a restart and (2) replay by repositioning. The processor persists tokens in a `TokenStore` after each batch.

You can inject the current token into a handler, or pull it from the processing context:

```java
import org.axonframework.messaging.eventhandling.annotation.EventHandler;
import org.axonframework.messaging.eventhandling.processing.streaming.token.TrackingToken;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;

@EventHandler
void on(CourseCreated event, TrackingToken token) {
    // token marks this event's position on the stream
}

// Or from the ProcessingContext directly:
Optional<TrackingToken> token = TrackingToken.fromContext(processingContext);
```

### Initial token

On its very first start (no token persisted yet), the PSEP builds an *initial token*. By default it starts at the **first** position, replaying the whole stream. Configure a different start position through the `TrackingTokenSource` handed to `initialToken(...)`:

| `TrackingTokenSource` method | Start position |
|---|---|
| `firstToken(context)` | Beginning of the stream (process everything) |
| `latestToken(context)` | Tip of the stream (only new events) |
| `tokenAt(Instant, context)` | A specific point in time |

You may pass `null` for the `ProcessingContext` argument when none is available. Predefined constants `TrackingToken.FIRST` and `TrackingToken.LATEST` are also available.

```java
config -> config.eventHandlingComponents(this::components)
                .customized((c, psep) -> psep.initialToken(source -> source.latestToken(null)));
```

> The initial token is **only** consulted on first start. If a token already exists, this setting has no effect. Beware: an unexpected initial token (cleared token store, accidental `InMemoryTokenStore`, fresh environment, or wrong database) is the usual cause of events being silently reprocessed or skipped.

### Token store

| Implementation | Package | Use |
|---|---|---|
| `InMemoryTokenStore` | `...token.store.inmemory` | Tests and short-lived tools — loses progress on shutdown |
| `JpaTokenStore` | `...token.store.jpa` | JPA-backed, auto-configurable in Spring Boot |
| `JdbcTokenStore` | `...token.store.jdbc` | Plain JDBC-backed |

> **Keep tokens and projections in the same database.** When the token update and the view-model write share one transaction, they commit atomically — giving you *exactly-once* processing semantics and making token stealing harmless (see below).

In Spring Boot the token store is chosen automatically: any `TokenStore` bean wins; otherwise a `JpaTokenStore` if an `EntityManager` is present; otherwise the `InMemoryTokenStore`. To configure it for all pooled processors via the API:

```java
import org.axonframework.messaging.eventhandling.processing.streaming.token.store.TokenStore;

pooled.processor("courses-projection",
        config -> config.eventHandlingComponents(this::components).notCustomized())
      .defaults((config, psep) -> psep.tokenStore(config.getComponent(TokenStore.class)));
```

### Token claims and stealing

A worker must hold a *claim* on a token before processing its segment, and extends that claim as it commits batches. If a claim is not extended within the `TokenStore`'s `claimTimeout` (default 10 seconds; Spring property `axon.eventhandling.tokenstore.claim-timeout`), another thread or node may **steal** it — surfacing internally as an `UnableToClaimTokenException`. Stealing keeps a stalled processor from blocking forever (slow handlers, blocking calls, deadlocks).

Consequence of a steal: an event may be handled more than once. Axon commits the handler work together with the token update, so the original (now claim-less) thread fails its update and rolls back. If projection and token live in the same database, the rollback discards the duplicate write and you only waste cycles. Otherwise — different database, a dispatched command, an outbound message, an email — **make the handler idempotent** or rely on compensating actions.

---

## Segments and parallel processing

To parallelize, a processor needs several tokens; each token owns a **segment** of the stream, identified by a number. The `initialSegmentCount` (default 16) fixes how many segments exist — but only on first start, because each segment is a token and tokens are only initialized once.

The PSEP uses a **two-pool architecture**: a single-threaded `Coordinator` opens the stream, claims as many segments as it can, and hands events to `WorkPackage`s running on the worker pool. Increasing throughput means adding **worker** threads (and matching segment count and sequencing policy):

```java
import org.axonframework.common.AxonThreadFactory;
import java.util.concurrent.Executors;

config -> config.eventHandlingComponents(this::components)
                .customized((c, psep) -> psep
                        .coordinatorExecutor(Executors.newScheduledThreadPool(
                                1, new AxonThreadFactory("Coordinator - courses-projection")))
                        .workerExecutor(Executors.newScheduledThreadPool(
                                16, new AxonThreadFactory("Worker - courses-projection")))
                        .initialSegmentCount(16));
```

> Adding threads alone does **not** parallelize anything. A thread needs a segment claim to do work, and the sequencing policy decides how events spread across segments. Tune thread count, segment count, and sequencing policy together.

### Sequencing within segments

Events that must stay in order have to land in the same segment. That is decided by the `SequencingPolicy` — see events/handling-projections.md for the policy table and the `@SequencingPolicy` annotation. In short: equal sequence identifiers ⇒ sequential handling; differing identifiers ⇒ may run concurrently; `Optional.empty()` ⇒ may run in parallel with anything.

```java
public interface SequencingPolicy<M extends Message> {
    Optional<Object> sequenceIdentifierFor(M message, ProcessingContext context);
}
```

The PSEP default is a `HierarchicalSequencingPolicy` that tries `SequentialPerAggregatePolicy` first and falls back to `SequentialPolicy`. In a DCB context, events carry tags rather than an aggregate identifier, so `SequentialPerAggregatePolicy` returns `Optional.empty()` for every event and the fallback `SequentialPolicy` always applies — the processor effectively runs single-threaded in one segment until you set an explicit policy.

### Splitting and merging segments

Segment count is fixed at first start, but you can change it at runtime with `splitSegment` / `mergeSegment` on the `StreamingEventProcessor`. The processor must hold (or be able to claim) the segment(s) involved; a merge needs both the given segment and its mergeable partner.

```java
import org.axonframework.common.configuration.Configuration;
import org.axonframework.messaging.eventhandling.processing.streaming.StreamingEventProcessor;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

class SegmentService {

    private Configuration configuration;

    CompletableFuture<Boolean> split(String processorName, int segmentId) {
        Map<String, StreamingEventProcessor> processors =
                configuration.getComponents(StreamingEventProcessor.class);
        return processors.get(processorName).splitSegment(segmentId);
    }

    CompletableFuture<Boolean> merge(String processorName, int segmentId) {
        Map<String, StreamingEventProcessor> processors =
                configuration.getComponents(StreamingEventProcessor.class);
        return processors.get(processorName).mergeSegment(segmentId);
    }
}
```

> For fair balancing, split the **largest** segment and merge the **smallest**. Axoniq Platform or Axon Server pick the right segment for you and support automatic scaling; prefer them over the raw API.

### Multi-node processing

Two instances of a same-named PSEP on different machines are one logical processor; their threads compete for the same segments. Each instance writes a `nodeId` (the JVM name by default, configurable on the `TokenStore`) into the token when it claims a segment. Balance the load via Axoniq Platform / the Axon Server dashboard, or by calling `releaseSegment(int)` / `releaseSegment(int, long, TimeUnit)` on the processor.

---

## Replay / reset

> **Availability**: replay/reset is available from **Axon Framework 5.1** onward (it was not present in 5.0).

Replaying re-runs handlers by repositioning the token. The processor must be **inactive** during a reset, so the sequence is: shut down, reset, start. In a multi-node setup *every* node must shut down its instance first, or another node re-claims the released segments.

The `StreamingEventProcessor` exposes several `resetTokens` overloads:

| Method | Effect |
|---|---|
| `resetTokens()` | Reset to the configured initial token |
| `resetTokens(R resetContext)` | As above, passing a context to `@ResetHandler`/`@ReplayContext` |
| `resetTokens(Function<TrackingTokenSource, CompletableFuture<TrackingToken>> supplier)` | Reset to a supplier-built token |
| `resetTokens(TrackingToken startPosition)` | Reset to an explicit position |
| `resetTokens(TrackingToken startPosition, R resetContext)` | Explicit position plus reset context |

```java
import org.axonframework.common.configuration.Configuration;
import org.axonframework.messaging.eventhandling.processing.streaming.StreamingEventProcessor;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

class ReplayService {

    private Configuration configuration;

    CompletableFuture<Void> reset(String processorName) {
        Map<String, StreamingEventProcessor> processors =
                configuration.getComponents(StreamingEventProcessor.class);
        StreamingEventProcessor processor = processors.get(processorName);
        return processor.shutdown()
                        .thenCompose(r -> processor.resetTokens())
                        .thenCompose(r -> processor.start());
    }
}
```

Use `supportsReset()` to check whether a processor allows it. For a **partial replay**, pass a `tokenAt(Instant, ...)`-derived token or an explicit `TrackingToken` — but be aware handlers may then see events mid-model and must tolerate missing prior state.

The handler-side replay annotations — `@AllowReplay` / `@DisallowReplay` and the `@ResetHandler` method — are documented in events/handling-projections.md. In addition, a handler may declare a `ReplayStatus` parameter (`REGULAR` / `REPLAY`) to branch on whether it is being replayed, and a `@ReplayContext` parameter to receive the reset context passed to `resetTokens(R)`. For declarative (non-annotated) components, wrap the component in a `ReplayBlockingEventHandlingComponent` to suppress all its handlers during a replay.

---

## Error handling

By default, handler exceptions reach the `ErrorHandler`, which defaults to `PropagatingErrorHandler` (it rethrows). Rethrow behaviour differs per processor: the subscribing processor bubbles the error to the publisher, the PSEP aborts and retries the segment with back-off (see each type's error-mode note above).

```java
public interface ErrorHandler {
    void handleError(ErrorContext errorContext) throws Exception;
}
```

`ErrorContext` (a record) exposes `eventProcessor()`, `error()`, and `failedEvents()`. Register a handler for all processors, or per processor:

```java
import org.axonframework.messaging.eventhandling.processing.errorhandling.PropagatingErrorHandler;

// Default for every processor
configurer.eventProcessing(ep -> ep.defaults(d -> d.errorHandler(new CustomErrorHandler())));

// Specific processor
subscribing.processor("course-notifications",
        config -> config.eventHandlingComponents(this::components)
                        .customized((c, sub) -> sub.errorHandler(PropagatingErrorHandler.INSTANCE)));
```

For finer control, annotated `@ExceptionHandler` methods on the handler class catch exceptions from `@EventHandler` methods on the same component (return normally to suppress and continue; rethrow to propagate). See the message-interception material for `@ExceptionHandler` and `@EventHandlerInterceptor` details.

> **Dead letter queue**: parking poison events instead of halting the processor is covered in events/handling-projections.md. The DLQ is a PSEP-only feature.

---

## Lifecycle and state

Every `EventProcessor` exposes `start()` and `shutdown()` (both return `CompletableFuture<Void>`), plus synchronous `isRunning()` and `isError()`. You rarely call these directly — Axon manages the lifecycle on application start/stop. Reach for them only for programmatic replays or conditional pausing.

```java
import org.axonframework.common.configuration.AxonConfiguration;
import org.axonframework.messaging.eventhandling.processing.EventProcessor;

EventProcessor processor = configuration.getComponent(EventProcessor.class, "courses-projection");
boolean running = processor.isRunning();
boolean errored = processor.isError(); // true after an unhandled exception put it in error mode
```

For the PSEP, `start()` first resolves the token-store identifier (`getTokenStoreIdentifier()`) and then starts the `Coordinator`. Await the future before touching state that depends on a running processor.

---

## Configuration entry points

Processors are configured under `MessagingConfigurer#eventProcessing(...)`, choosing `subscribing(...)` or `pooledStreaming(...)`, then registering handling components and (optionally) customizing. In Spring Boot you can instead declare `EventProcessorDefinition` beans (`EventProcessorDefinition.pooledStreaming("name")` / `.subscribing("name")`, with `.pooledStreamingMatching(...)` / `.subscribingMatching(...)` shortcuts for namespace-based selection) or set `axon.eventhandling.processors.<name>.*` properties (`mode`, `source`, `initial-segment-count`, `batch-size`, `thread-count`). See configuration/plain-java.md and configuration/spring-boot.md for the full wiring patterns.

> `EventProcessorDefinition` beans take precedence over property-based assignment; a handler matched by two definitions throws an `AxonConfigurationException` at startup; unmatched handlers fall back to a processor named after their package.

---

## Persistent streams (Axoniq Framework + Axon Server, 5.2.0+)

With Axon Server, the commercial `axon-server-connector` module offers **persistent streams**: event streams managed server-side, where Axon Server tracks the position, segmentation, and sequencing, and pushes event batches to the application. The stream's `name` identifies it on the server — two sources with the same name join the same stream. A `PersistentStreamEventSource` (`io.axoniq.framework.axonserver.connector.event`) implements `SubscribableEventSource`, so a **subscribing** processor gets streaming-processor benefits (server-tracked position, parallel segments) without a client-side token store.

Spring Boot: declare streams under `axon.axonserver.persistent-streams.<name>.*` and point a processor at the stream by name:

```yaml
axon:
  axonserver:
    persistent-streams:
      course-projection-stream:
        initial-segment-count: 4
        sequencing-policy: SequentialPerAggregatePolicy
        initial-position: TAIL
        batch-size: 10
  eventhandling:
    processors:
      course-projection:
        source: course-projection-stream
```

Per-stream settings: `name` (defaults to the map key), `initial-segment-count` (default 1), `thread-count` (1), `sequencing-policy` (default `SequentialPolicy`; also `SequentialPerAggregatePolicy`, `MetadataSequencingPolicy`, `FullConcurrencyPolicy`, `PropertySequencingPolicy`), `sequencing-policy-parameters`, `filter` (Axon Server query language; fixed once the stream is created), `batch-size` (1), `initial-position` (`TAIL`). Segment count, policy, filter, and initial position only apply when the stream is first created on the server.

Setting `axon.axonserver.auto-persistent-streams-enabled=true` instead auto-creates one persistent stream per processor (named `<processorName>-stream`, using the `axon.axonserver.auto-persistent-streams-settings.*` template) and switches the default processor mode to subscribing.
