# Multi-Source Event Streaming — Axoniq Framework

> **Requires Axoniq Framework** (`io.axoniq.framework`) — commercial license, free for non-production use.
> This is NOT part of Axon Framework 5 open source. If the user wants to stay on open source only, each `PooledStreamingEventProcessor` can only consume from a single event source.

`MultiStreamableEventSource` lets a `PooledStreamingEventProcessor` consume events from **multiple independent event sources simultaneously** — merging them into a single ordered stream. Typical use cases:
- Consuming from two separate event stores (e.g., two bounded contexts each with their own store)
- Consuming from multiple Axon Server contexts
- Mixed storage backends (e.g., an AF5 event store + a Kafka topic via an adapter)

---

## Dependency

```xml
<dependency>
    <groupId>io.axoniq.framework</groupId>
    <artifactId>axoniq-event-streaming</artifactId>
</dependency>
```

---

## Building a MultiStreamableEventSource

```java
import io.axoniq.framework.messaging.eventstreaming.MultiStreamableEventSource;

MultiStreamableEventSource combined = MultiStreamableEventSource
    .combining("orders", orderEventStore)      // first source — name must be stable
    .and("inventory", inventoryEventStore)     // second source
    .comparingTimestamps();                    // merge oldest-first by event timestamp
```

The `name` passed to `combining()` and `and()` is persisted in the tracking token. **Never change a source name after events have been processed** — doing so will cause tracking position loss.

### Custom merge order

```java
import io.axoniq.framework.messaging.eventstreaming.MultiStreamableEventSource;

MultiStreamableEventSource combined = MultiStreamableEventSource
    .combining("primary", primarySource)
    .and("secondary", secondarySource)
    .comparingUsing((a, b) -> {
        // Return < 0 to process `a` first, > 0 to process `b` first
        // Use SOURCE_ID_RESOURCE to identify which source each entry comes from
        String aSource = a.context().getResource(MultiStreamableEventSource.SOURCE_ID_RESOURCE);
        String bSource = b.context().getResource(MultiStreamableEventSource.SOURCE_ID_RESOURCE);
        if ("primary".equals(aSource) && !"primary".equals(bSource)) return -1;
        if (!"primary".equals(aSource) && "primary".equals(bSource)) return 1;
        return a.message().timestamp().compareTo(b.message().timestamp());
    });
```

---

## Wiring with a PooledStreamingEventProcessor

Pass the `MultiStreamableEventSource` as the event source for the processor:

```java
configurer.eventProcessing(ep -> ep
    .pooledStreaming(ps -> ps
        .defaults(d -> d.eventSource(combined))   // use for all pooled streaming processors
        .processor("cross-context-projection",
            components -> components.declarative(
                "projection-handler",
                c -> new CrossContextProjection(repository)))
    )
);
```

Or per processor:

```java
.processor("cross-context-projection",
    components -> components.declarative("projection-handler",
                                         c -> new CrossContextProjection(repository)))
.customized((cfg, c) -> c.eventSource(combined))
```

---

## MultiSourceTrackingToken

`MultiSourceTrackingToken` tracks the read position for each individual source independently. It is serialized to JSON and stored in the token store alongside other tracking tokens — no special handling needed.

```java
import io.axoniq.framework.messaging.eventstreaming.MultiSourceTrackingToken;

// Inspect token in tests or tooling:
MultiSourceTrackingToken token = ...;
TrackingToken ordersToken    = token.getTokenForStream("orders");
TrackingToken inventoryToken = token.getTokenForStream("inventory");
Map<String, TrackingToken> all = token.getTrackingTokens();
```

---

## Identifying the source inside an event handler

When a handler needs to know which source an event came from (uncommon, but useful for debugging or routing):

```java
@EventHandler
void on(OrderPlaced event, ProcessingContext ctx) {
    String sourceId = ctx.getResource(MultiStreamableEventSource.SOURCE_ID_RESOURCE);
    // sourceId will be "orders" or "inventory" etc.
}
```

---

## Caveats

- **Clock skew**: `comparingTimestamps()` relies on event timestamps being approximately in sync across sources. Significant clock skew can cause events to be processed out of causal order.
- **Replay**: when replaying, all sources are replayed from the start. Ensure each source supports replay (i.e., it's a durable event store, not a Kafka consumer group with no offset reset).
- **Token stability**: source names are part of the serialised token. Renaming a source after tracking has started requires a token migration.
