# Distributed Messaging — Axoniq Framework

> **Requires Axoniq Framework** (`io.axoniq.framework`) — commercial license, free for non-production use.
> This is NOT part of Axon Framework 5 open source. If the user wants to stay on open source only, there is no built-in distributed command/query bus in AF5 — each application node runs its own local bus.

The Axoniq Framework provides `DistributedCommandBus` and `DistributedQueryBus` for spreading load across multiple instances of an application. Each instance runs a **local segment** of the bus; a **connector** routes messages between segments.

---

## Dependencies

```xml
<dependency>
    <groupId>io.axoniq.framework</groupId>
    <artifactId>axoniq-distributed-messaging</artifactId>
</dependency>
```

---

## DistributedCommandBus

```java
import io.axoniq.framework.messaging.commandhandling.distributed.DistributedCommandBus;
import io.axoniq.framework.messaging.commandhandling.distributed.DistributedCommandBusConfiguration;

var distributedCommandBus = new DistributedCommandBus(
    localCommandBus,           // CommandBus — handles commands routed to this node
    commandBusConnector,       // CommandBusConnector — routes to/from other nodes
    DistributedCommandBusConfiguration.DEFAULT
        .loadFactor(100)       // relative weight for routing decisions
        .commandThreads(10)    // executor threads for incoming commands
);
```

### CommandBusConnector

`CommandBusConnector` is the integration point between `DistributedCommandBus` and your transport layer (Axon Server, gRPC, etc.). It is not included in this module; it is provided by a transport-specific connector implementation.

```java
import io.axoniq.framework.messaging.commandhandling.distributed.CommandBusConnector;

// Implementing your own connector (e.g., for a custom transport):
public class MyConnector implements CommandBusConnector {

    @Override
    public CompletableFuture<CommandResultMessage> dispatch(
            CommandMessage command, ProcessingContext context) {
        // route to the appropriate segment
    }

    @Override
    public CompletableFuture<Void> subscribe(QualifiedName commandName, int loadFactor) {
        // register this segment as a handler for the given command type
    }

    @Override
    public boolean unsubscribe(QualifiedName commandName) {
        // deregister
    }

    @Override
    public void onIncomingCommand(CommandBusConnector.Handler handler) {
        // store the handler; call handler.handle(command, callback) when a command arrives
    }
}
```

### DistributedCommandBusConfiguration

```java
DistributedCommandBusConfiguration config = DistributedCommandBusConfiguration.DEFAULT
    .loadFactor(100)        // this node's weight relative to peers (default: 100)
    .commandThreads(10)     // executor thread pool size for incoming commands (default: 10)
    .executorService(myExecutor);  // override executor entirely
```

---

## DistributedQueryBus

```java
import io.axoniq.framework.messaging.queryhandling.distributed.DistributedQueryBus;
import io.axoniq.framework.messaging.queryhandling.distributed.DistributedQueryBusConfiguration;

var distributedQueryBus = new DistributedQueryBus(
    localQueryBus,
    queryBusConnector,
    DistributedQueryBusConfiguration.DEFAULT
        .queryThreads(10)
        .preferLocalQueryHandler(true)   // route to local handler first if available
);
```

### DistributedQueryBusConfiguration

```java
DistributedQueryBusConfiguration config = DistributedQueryBusConfiguration.DEFAULT
    .queryThreads(10)               // executor thread pool size (default: 10)
    .queryQueueCapacity(1000)       // work queue capacity (default: 1000)
    .preferLocalQueryHandler(true)  // prefer local node for queries it can handle (default: true)
    .executorService(myExecutor);   // override executor entirely
```

---

## Spring Boot (Axoniq Framework auto-configuration)

When `axoniq-distributed-messaging` and a connector are on the classpath, Spring Boot auto-configuration registers the distributed buses automatically. The local `CommandBus`/`QueryBus` beans are decorated with their distributed counterparts. Declare the connector bean to activate:

```java
@Bean
CommandBusConnector commandBusConnector(/* your transport deps */) {
    return new MyConnector(...);
}
```

---

## When to use distributed messaging

Use `DistributedCommandBus` / `DistributedQueryBus` when:
- Multiple instances of the same service must share command handler subscriptions (active-active scaling)
- You need load-factor-based routing across nodes
- You need centralised routing through Axon Server or a custom transport

For single-node applications or applications using Axon Server's built-in routing, you do not need this module — Axon Server handles distribution at the infrastructure level without `DistributedCommandBus`.
