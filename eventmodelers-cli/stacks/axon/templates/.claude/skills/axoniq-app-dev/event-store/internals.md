# Event Store Internals in Axon Framework 5

This guide covers the storage layer behind event sourcing: the `EventStore` and
`EventStorageEngine` abstractions, how events flow from a command handler down to storage,
and which engine implementations ship with AF5. For the condition/criteria APIs you actually
touch inside a decision model, see the **`event-store/primitives.md` guide**. For the DCB
sourcing pattern see **`commands/decision-models-dcb.md`**, and for wiring it all together see
**`configuration/plain-java.md`**.

Most applications never touch these classes directly — `@EventSourcedEntity` and the
`EventStore` transaction handle everything. Read this when customizing storage, swapping
engines, or debugging append/conflict behavior.

---

## The two layers: `EventStore` vs `EventStorageEngine`

AF5 splits event storage into two collaborating abstractions:

| Abstraction | Package | Role |
|---|---|---|
| `EventStore` | `org.axonframework.eventsourcing.eventstore` | High-level, transaction-oriented facade used by application code. Extends `EventBus` and `StreamableEventSource`. |
| `EventStorageEngine` | `org.axonframework.eventsourcing.eventstore` | Low-level, `@Internal` SPI that actually persists and retrieves events. One per backing store (in-memory, JPA, ...). |

`EventStore` is what command handlers see. It does **not** persist anything itself — it
delegates to an `EventStorageEngine`. Because `EventStore` also implements `EventBus` /
`EventSink`, the same component both *stores* events durably and *distributes* them to
subscribed event handlers, removing the need for a separate event bus in event-sourcing setups.

```java
import org.axonframework.eventsourcing.eventstore.EventStore;
import org.axonframework.eventsourcing.eventstore.EventStoreTransaction;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;

// EventStore is injected; obtain (or create) the transaction bound to this unit of work
EventStoreTransaction tx = eventStore.transaction(processingContext);
```

`transaction(ProcessingContext)` is idempotent per context: it stores the transaction as a
resource on the `ProcessingContext` and returns the same instance on repeated calls within one
unit of work.

---

## `EventStoreTransaction` — the application-facing handle

The transaction is where sourcing and appending happen. It is described fully in
`event-store/primitives.md`; the key methods are:

```java
// Source a finite stream of events for a decision model
MessageStream<? extends EventMessage> source(SourcingCondition condition);

// Stage an event for atomic append at commit
void appendEvent(EventMessage eventMessage);

// Position of the last appended event (ConsistencyMarker.ORIGIN if nothing appended yet)
ConsistencyMarker appendPosition();
```

The transaction tracks every `SourcingCondition` you pass to `source(...)`. At commit time it
derives an `AppendCondition` from those sources automatically — you never build one by hand in
normal use. To override that derivation (e.g. uniqueness checks without prior sourcing, or
narrowing the conflict criteria) use:

```java
import org.axonframework.eventsourcing.eventstore.AppendCondition;

// Append without sourcing: enforce a uniqueness constraint against the whole store
tx.overrideAppendCondition(current -> AppendCondition.withCriteria(uniquenessCriteria));
```

> `overrideAppendCondition` composes — each call receives the output of the previous one — and
> is applied at commit, after all `source(...)` calls. Returning `AppendCondition.none()`
> bypasses conflict detection entirely.

---

## The `EventStorageEngine` SPI

`EventStorageEngine` is marked `@Internal`. You implement it only to integrate a new backing
store; most users select an existing implementation. Its contract:

```java
public interface EventStorageEngine extends DescribableComponent {

    // Append events, validating `condition`. Returns a two-phase AppendTransaction.
    CompletableFuture<AppendTransaction<?>> appendEvents(AppendCondition condition,
                                                         ProcessingContext context,
                                                         List<TaggedEventMessage<?>> events);

    // FINITE stream for sourcing a model; terminal entry carries the ConsistencyMarker
    MessageStream<EventMessage> source(SourcingCondition condition);

    // INFINITE stream for event processors
    MessageStream<EventMessage> stream(StreamingCondition condition);

    // Tracking-token factories for streaming processors
    CompletableFuture<TrackingToken> firstToken();
    CompletableFuture<TrackingToken> latestToken();
    CompletableFuture<TrackingToken> tokenAt(Instant at);
}
```

Two things to internalize:

1. **`source` returns a finite stream**, **`stream` returns an infinite one.** Sourcing
   rebuilds a model and stops at the end of the matching sequence; streaming feeds
   event processors and blocks waiting for new events.
2. **The final entry of a sourced stream always carries a `ConsistencyMarker`** in its
   resources, paired with a `TerminalEventMessage`. That marker is what later becomes the
   `AppendCondition` for conflict detection (see `event-store/primitives.md`).

### Tagged events, not raw events

The engine appends `TaggedEventMessage` instances — an `EventMessage` paired with its resolved
`Tag` set. The `EventStore` resolves tags via a `TagResolver` (default:
`AnnotationBasedTagResolver`, which reads `@EventTag`) just before handing events to the engine:

```java
import org.axonframework.eventsourcing.eventstore.GenericTaggedEventMessage;
import org.axonframework.eventsourcing.eventstore.TagResolver;

TaggedEventMessage<EventMessage> tagged =
        new GenericTaggedEventMessage<>(event, tagResolver.resolve(event));
```

### `AppendTransaction` — two-phase append

`appendEvents(...)` does not store immediately; it returns an `AppendTransaction<R>` driven by
the unit-of-work lifecycle:

```java
interface AppendTransaction<R> {
    CompletableFuture<R> commit();                       // COMMIT phase — make events visible
    void rollback();                                     // discard appended events
    CompletableFuture<ConsistencyMarker> afterCommit(R commitResult); // AFTER_COMMIT phase
}
```

`appendEvents` runs in the `PREPARE_COMMIT` phase, `commit()` in `COMMIT`, and `afterCommit()`
in `AFTER_COMMIT`. Implementations may detect conflicts early (failing the
`appendEvents` future) or defer the check to `commit()`. On an empty transaction, the marker
returned by `afterCommit` is always `ConsistencyMarker.ORIGIN`.

---

## `StorageEngineBackedEventStore` — the default `EventStore`

The default `EventStore` implementation is `StorageEngineBackedEventStore`. It composes three
collaborators and is what `transaction(...)` builds `DefaultEventStoreTransaction` instances on
top of:

```java
import org.axonframework.eventsourcing.eventstore.StorageEngineBackedEventStore;

EventStore eventStore = new StorageEngineBackedEventStore(
        eventStorageEngine,   // EventStorageEngine — where events are stored
        eventBus,             // EventBus — how events reach subscribers
        tagResolver           // TagResolver — resolves @EventTag tags at append time
);
```

When events are appended through a transaction, the store publishes them to `eventBus`
subscribers after the engine commits, fulfilling its dual storage-and-distribution role.

---

## Available storage engine implementations

| Engine | Module / package | Use for |
|---|---|---|
| `InMemoryEventStorageEngine` | `eventsourcing` · `...eventstore.inmemory` | Tests, demos, prototyping. The **default** when nothing else is registered. |
| `AggregateBasedJpaEventStorageEngine` | `eventsourcing` · `...eventstore.jpa` | Relational/JPA-backed persistence using an aggregate-based schema. |
| `SnapshotCapableEventStorageEngine` | `eventsourcing` · `...eventstore` | A **decorator** adding snapshot sourcing to an engine that lacks it natively. |

> A production Axoniq Platform deployment uses Axon Server as the event store. The
> `io.axoniq.framework:axon-server-connector` wires that engine in automatically; it is not
> constructed by hand and is not part of the `eventsourcing` module covered here. For its
> connection properties (`axon.axonserver.servers`/`context`/`token`, default `localhost:8124`)
> and how to disable it, see `configuration/spring-boot.md` and `configuration/plain-java.md`.

### `InMemoryEventStorageEngine`

Thread-safe, stores events in a `ConcurrentSkipListMap`. Empty on construction.

```java
import org.axonframework.eventsourcing.eventstore.inmemory.InMemoryEventStorageEngine;

EventStorageEngine engine = new InMemoryEventStorageEngine();

// Optional offset for the first token (useful to align streaming processors in tests)
EventStorageEngine offsetEngine = new InMemoryEventStorageEngine(0L);
```

It detects conflicts eagerly: if appended events match an existing `AppendCondition` after the
marker, `appendEvents(...)` fails immediately with the cause produced by
`AppendEventsTransactionRejectedException` (see `event-store/primitives.md`).

### `AggregateBasedJpaEventStorageEngine`

Persists events through JPA, storing each event payload as a converted byte blob alongside
metadata columns (aggregate identifier, sequence number, global index, timestamp). Constructed
with a transactional executor provider, an `EventConverter`, and a configuration customizer:

```java
import org.axonframework.eventsourcing.eventstore.jpa.AggregateBasedJpaEventStorageEngine;
import org.axonframework.eventsourcing.eventstore.jpa.AggregateBasedJpaEventStorageEngineConfiguration;

EventStorageEngine engine = new AggregateBasedJpaEventStorageEngine(
        transactionalExecutorProvider,  // TransactionalExecutorProvider<EntityManager>
        eventConverter,                  // EventConverter
        config -> config.batchSize(200)  // customize AggregateBasedJpaEventStorageEngineConfiguration
);
```

Tunable via `AggregateBasedJpaEventStorageEngineConfiguration` (use the `DEFAULT` constant as a
base). Notable defaults: `batchSize` = 100 (events fetched per read), `gapTimeout` = 60000 ms,
`gapCleaningThreshold` = 250, `maxGapOffset` = 10000.

### `SnapshotCapableEventStorageEngine`

A decorator (not a standalone store). When a `SourcingCondition` carries a
`SourcingStrategy.Snapshot` strategy, it loads the latest snapshot from a `SnapshotStore`,
prepends it as a synthetic leading message, then appends the events after the snapshot's
position. If no snapshot exists it falls back to full sourcing. All append and streaming calls
pass straight through to the wrapped engine.

---

## Configuring the engine

The `EventSourcingConfigurer` registers, by default:

- `AnnotationBasedTagResolver` for `TagResolver`
- `InMemoryEventStorageEngine` for `EventStorageEngine`
- `StorageEngineBackedEventStore` for `EventStore`

It then decorates the engine with `SnapshotCapableEventStorageEngine` (when a `SnapshotStore`
is present) and the store with `InterceptingEventStore` (when event interceptors exist).

To swap in a different engine or store, register your own factory:

```java
import org.axonframework.eventsourcing.configuration.EventSourcingConfigurer;
import org.axonframework.eventsourcing.eventstore.inmemory.InMemoryEventStorageEngine;

EventSourcingConfigurer configurer = EventSourcingConfigurer.create();

configurer
    // Provide a custom EventStorageEngine — the default EventStore will wrap it
    .registerEventStorageEngine(config -> new InMemoryEventStorageEngine())
    // Or replace the entire EventStore facade
    .registerEventStore(config -> new StorageEngineBackedEventStore(
            config.getComponent(EventStorageEngine.class),
            config.getComponent(EventBus.class),
            config.getComponent(TagResolver.class)));
```

`registerEventStorageEngine` is the usual extension point: provide the engine and let AF5 build
the `EventStore`, tag resolution, and interceptor decoration around it. See
`configuration/plain-java.md` for the full configuration model.

---

## Summary

- `EventStore` is the transactional facade application code uses; `EventStorageEngine` is the
  internal SPI that actually persists events. The default store
  (`StorageEngineBackedEventStore`) wires them together with a `TagResolver` and `EventBus`.
- Appending goes through a two-phase `AppendTransaction` (`appendEvents` → `commit` →
  `afterCommit`), driven by the unit-of-work lifecycle; sourcing yields a finite stream whose
  terminal entry carries the `ConsistencyMarker` used for conflict detection.
- Ship-with engines: `InMemoryEventStorageEngine` (default, tests),
  `AggregateBasedJpaEventStorageEngine` (relational), and the
  `SnapshotCapableEventStorageEngine` decorator for snapshot sourcing.
- Customize via `EventSourcingConfigurer.registerEventStorageEngine(...)` /
  `registerEventStore(...)`.
