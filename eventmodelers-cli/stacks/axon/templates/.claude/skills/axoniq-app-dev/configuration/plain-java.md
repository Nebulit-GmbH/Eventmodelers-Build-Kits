# Configuration in Axon Framework 5

AF5 uses a builder-style configuration API. You compose a configurer, register your modules and components, then call `start()` to produce a running `AxonConfiguration`.

---

## Configurer hierarchy

Three configurers exist at increasing levels of capability. Each wraps (and exposes the API of) the one below it:

| Configurer | Package | Use when |
|---|---|---|
| `MessagingConfigurer` | `org.axonframework.messaging.core.configuration` | You only need messaging (command/event/query buses) with no event store |
| `ModellingConfigurer` | `org.axonframework.modelling.configuration` | You need entity injection (`@InjectEntity`) but no event store |
| `EventSourcingConfigurer` | `org.axonframework.eventsourcing.configuration` | You need an event store — i.e., DCB command handlers, `@EventTag` tagging, or `PooledStreamingEventProcessor` |

**Default for most applications: `EventSourcingConfigurer`**. It wraps the other two and exposes their full API. Defaults to an in-memory event store; swap in a durable engine for production (see **Event store backends** below).

Each configurer implements `ApplicationConfigurer`, which provides:
- `build()` → returns a fully initialised `AxonConfiguration` (not yet started)
- `start()` → convenience: calls `build()` then `AxonConfiguration.start()`; returns the live config
- `componentRegistry(Consumer<ComponentRegistry>)` → low-level escape hatch to register anything
- `lifecycleRegistry(Consumer<LifecycleRegistry>)` → register start/stop lifecycle hooks

---

## Plain Java — minimal application

```java
import org.axonframework.eventsourcing.configuration.EventSourcingConfigurer;
import org.axonframework.messaging.commandhandling.configuration.CommandHandlingModule;
import org.axonframework.messaging.queryhandling.configuration.QueryHandlingModule;

public class Application {

    public static void main(String[] args) {
        var config = EventSourcingConfigurer.create()
                // Command handlers
                .registerCommandHandlingModule(
                    CommandHandlingModule.named("courses")
                        .commandHandlers()
                        .autodetectedCommandHandlingComponent(
                            c -> new CourseCommandHandler()))
                // Event handlers (projections)
                .eventProcessing(ep -> ep
                    .pooledStreaming(ps -> ps
                        .processor("courses-projection",
                            components -> components.declarative(
                                "courses-handler",
                                c -> new CoursesProjection(repository)))))
                // Query handlers
                .registerQueryHandlingModule(
                    QueryHandlingModule.named("courses-queries")
                        .queryHandlers()
                        .autodetectedQueryHandlingComponent(
                            c -> new CoursesQueryHandler(repository)))
                .start();

        var commands = config.getComponent(CommandGateway.class);
        var queries  = config.getComponent(QueryGateway.class);

        // ... run your application ...

        config.shutdown();
    }
}
```

`start()` is a convenience shorthand for `build()` + `AxonConfiguration.start()`. Use `build()` explicitly if you need to defer startup.

---

## `EventSourcingConfigurer` API reference

All methods return `EventSourcingConfigurer` for fluent chaining.

### Command handlers

```java
configurer.registerCommandHandlingModule(
    CommandHandlingModule.named("courses")
        .commandHandlers()
        // Annotation-based (recommended): scans for @CommandHandler methods
        .autodetectedCommandHandlingComponent(c -> new CourseCommandHandler())
        // Programmatic: single lambda handler
        .commandHandler(
            new QualifiedName("faculty.ArchiveCourse"),
            c -> (cmd, ctx) -> { /* handle */ return MessageStream.fromItems(resultMessage); })
);
```

### Query handlers

```java
configurer.registerQueryHandlingModule(
    QueryHandlingModule.named("courses-queries")
        .queryHandlers()
        // Annotation-based (recommended): scans for @QueryHandler methods
        .autodetectedQueryHandlingComponent(c -> new CoursesQueryHandler(repository))
);
```

### Event-sourced entities (for `@InjectEntity` / DCB command-centric handlers)

```java
// Shorthand (preferred):
configurer.registerEntity(
    EventSourcedEntityModule.autodetected(String.class, CourseState.class)
);

// Equivalent low-level form:
configurer.componentRegistry(cr -> cr.registerModule(
    EventSourcedEntityModule.autodetected(String.class, CourseState.class)
));
```

`EventSourcedEntityModule.autodetected(IdType.class, EntityType.class)` reads the `@EventSourcedEntity` annotation on `EntityType` to infer sourcing criteria, ID resolver, and entity factory. The `IdType` must match the Java type of the routing-key field.

Register each entity type separately, before registering any command handler that injects it.

### Event store

```java
// Shorthand for EventStorageEngine (most common):
configurer.registerEventStorageEngine(
    c -> new PostgresqlEventStorageEngine(dataSource, eventConverter, entitlementManager)
);

// Shorthand for a fully custom EventStore:
configurer.registerEventStore(c -> new MyCustomEventStore());

// Equivalent low-level form (EventStorageEngine):
configurer.componentRegistry(cr -> cr.registerComponent(
    EventStorageEngine.class,
    c -> new PostgresqlEventStorageEngine(dataSource, eventConverter, entitlementManager)
));
```

### Tag resolver (required for `@EventTag` / DCB)

```java
// Shorthand (preferred):
configurer.registerTagResolver(c -> new AnnotationBasedTagResolver());

// Equivalent low-level form:
configurer.componentRegistry(cr -> cr.registerComponent(
    TagResolver.class, c -> new AnnotationBasedTagResolver()
));
```

Without a `TagResolver`, events are stored without tags and DCB sourcing finds nothing.

### Delegation to inner configurers

When you need API that lives on `ModellingConfigurer` or `MessagingConfigurer`, use the delegation helpers:

```java
// Access MessagingConfigurer API (interceptors, buses, etc.):
configurer.messaging(mc -> mc
    .registerCommandDispatchInterceptor(c -> new BeanValidationInterceptor<>())
    .registerCommandHandlerInterceptor(c -> new AuditLoggingInterceptor())
    .registerCorrelationDataProvider(c -> message -> Map.of("traceId", ...))
);

// Access ModellingConfigurer API (rarely needed directly):
configurer.modelling(mc -> mc.registerEntity(
    EventSourcedEntityModule.autodetected(String.class, CourseState.class)
));
```

---

## `MessagingConfigurer` API reference

Useful when you start from `MessagingConfigurer.create()` (no event store needed) or access it via `EventSourcingConfigurer.messaging(...)`.

### Key methods (all return `MessagingConfigurer` for chaining)

| Method | Purpose |
|---|---|
| `registerCommandHandlingModule(ModuleBuilder<CommandHandlingModule>)` | Register annotated command handlers |
| `registerQueryHandlingModule(ModuleBuilder<QueryHandlingModule>)` | Register annotated query handlers |
| `eventProcessing(Consumer<EventProcessingConfigurer>)` | Configure event processors (subscribing or pooled streaming) |
| `registerCommandDispatchInterceptor(ComponentBuilder)` | Intercept outgoing commands (dispatch side) |
| `registerCommandHandlerInterceptor(ComponentBuilder)` | Intercept incoming commands (handler side) |
| `registerEventDispatchInterceptor(ComponentBuilder)` | Intercept outgoing events |
| `registerEventHandlerInterceptor(ComponentBuilder)` | Intercept incoming events |
| `registerQueryDispatchInterceptor(ComponentBuilder)` | Intercept outgoing queries |
| `registerQueryHandlerInterceptor(ComponentBuilder)` | Intercept incoming queries |
| `registerCorrelationDataProvider(ComponentBuilder)` | Propagate metadata across messages |
| `registerMessageTypeResolver(ComponentBuilder)` | Override how message type names are resolved |
| `registerUnitOfWorkFactory(ComponentBuilder)` | Custom unit-of-work lifecycle |
| `componentRegistry(Consumer<ComponentRegistry>)` | Register arbitrary components |
| `build()` | Produce a configured `AxonConfiguration` |
| `start()` | Build and start immediately |

---

## Event processing

### Subscribing processor — synchronous, in-transaction

```java
configurer.eventProcessing(ep -> ep
    .subscribing(sub -> sub
        .processor("notifications",
            components -> components.declarative(
                "notification-handler",
                c -> new NotificationHandler(emailService)))));
```

### Pooled streaming processor — async, trackable, replayable

```java
configurer.eventProcessing(ep -> ep
    .pooledStreaming(pool -> pool
        .processor("courses-projection",
            components -> components.declarative(
                "courses-handler",
                c -> new CoursesProjection(repository)))));
```

### Dead Letter Queue on a pooled streaming processor

```java
import org.axonframework.messaging.eventhandling.deadletter.DeadLetterQueueConfiguration;

configurer.eventProcessing(ep -> ep
    .pooledStreaming(pool -> pool
        .processor("courses-projection",
            components -> components.declarative(
                "courses-handler",
                c -> new CoursesProjection(repository)))
        .customized((cfg, c) -> c
            .extend(DeadLetterQueueConfiguration.class,
                    () -> new DeadLetterQueueConfiguration().enabled().clearOnReset(true)))));
```

See the **`events/handling-projections.md` guide** for full DLQ configuration details including JDBC and JPA backends.

---

## Transaction management

```java
import org.axonframework.messaging.core.unitofwork.transaction.TransactionManager;

// JPA
configurer.componentRegistry(cr -> cr.registerComponent(
    TransactionManager.class,
    config -> new EntityManagerTransactionManager(entityManagerFactory)));

// No-op (default — suitable for in-memory/testing)
configurer.componentRegistry(cr -> cr.registerComponent(
    TransactionManager.class,
    config -> NoTransactionManager.INSTANCE));
```

---

## Correlation data propagation

Metadata to copy automatically from incoming messages to all outgoing messages:

```java
configurer.messaging(mc -> mc.registerCorrelationDataProvider(c -> message -> {
    var carry = new HashMap<String, String>();
    if (message.metadata().containsKey("traceId")) {
        carry.put("traceId", (String) message.metadata().get("traceId"));
    }
    return carry;
}));
```

---

## Accessing components at runtime

After `start()`, retrieve any registered component from the live configuration:

```java
var config         = configurer.start();
var commandGateway = config.getComponent(CommandGateway.class);
var queryGateway   = config.getComponent(QueryGateway.class);
var eventGateway   = config.getComponent(EventGateway.class);
var eventStore     = config.getComponent(EventStore.class);
```

---

## Event store backends

`EventSourcingConfigurer` defaults to **`InMemoryEventStorageEngine`** — convenient for testing and local development, not suitable for production.

### PostgreSQL (Axoniq Framework — commercial)

The Axoniq Framework PostgreSQL connector provides a production-grade `EventStorageEngine` with optimised DCB tag indexing. Add the dependency:

```xml
<dependency>
    <groupId>io.axoniq.framework</groupId>
    <artifactId>axoniq-postgresql</artifactId>
</dependency>
```

Then register it:

```java
import io.axoniq.framework.postgresql.PostgresqlEventStorageEngine;

configurer.registerEventStorageEngine(
    c -> new PostgresqlEventStorageEngine(dataSource, eventConverter, entitlementManager)
);
```

With Spring Boot and `axoniq-postgresql` on the classpath, `PostgresqlAutoConfiguration` wires this automatically. Configure the datasource via standard Spring Boot datasource properties.

Axoniq Framework is free for non-production use; production deployments require a paid subscription.

### Axon Server (via the connector)

Add the Axon Server connector and the framework uses Axon Server as the event store and message broker instead of the in-memory engine:

```xml
<dependency>
    <groupId>io.axoniq.framework</groupId>
    <artifactId>axon-server-connector</artifactId>
</dependency>
```

**Auto-detection**: the framework detects the connector on the classpath and wires it automatically — no configuration code is needed for the defaults. It connects to **`localhost:8124`** (gRPC) and uses the context **`default`**. The Axon Server dashboard is at `http://localhost:8024`.

To point at a different server, context, or to pass an access token, register an `AxonServerConfiguration` component:

```java
import org.axonframework.axonserver.connector.AxonServerConfiguration;

configurer.componentRegistry(r -> r.registerComponent(AxonServerConfiguration.class, c -> {
    var axonServerConfig = new AxonServerConfiguration();
    axonServerConfig.setServers("axonserver-1:8124,axonserver-2:8124"); // comma-separated host[:grpcPort] list; default localhost:8124
    axonServerConfig.setContext("university");                          // default "default"
    axonServerConfig.setToken("<access-token>");                        // only when access control is enabled
    return axonServerConfig;
}));
```

> **DCB requires a DCB-enabled context.** To use Dynamic Consistency Boundary features, the Axon Server context must be created as DCB-enabled — a plain context will not accept tag-based sourcing/append conditions.

**Disabling the connector (e.g. to force the in-memory engine for a test or local run)** — setting it off via a property is unreliable with this connector; the connector registers its event store through a `ConfigurationEnhancer` discovered by the JVM `ServiceLoader`, so it initialises even when `axon.axonserver.enabled=false`. Disable the enhancer explicitly instead:

```java
import org.axonframework.axonserver.connector.ServerConnectorConfigurationEnhancer;

configurer.componentRegistry(r -> r.disableEnhancer(ServerConnectorConfigurationEnhancer.class));
```

Alternatively, simply keep the connector off the classpath in test scope. See `testing/advanced.md` for the testing implications.

---

## Interceptors

Register interceptors via the `messaging()` delegate or directly on the fluent chain (see the **`interceptors` guide** for implementation patterns):

```java
configurer.messaging(mc -> mc
    .registerCommandDispatchInterceptor(c -> new BeanValidationInterceptor<>())
    .registerCommandHandlerInterceptor(c -> new AuditLoggingInterceptor())
    .registerEventDispatchInterceptor(c -> new CorrelationEnrichingInterceptor<>()));
```

---

## Spring Boot

When `extensions/spring` is on the classpath, Spring Boot auto-configuration wires `CommandGateway`, `QueryGateway`, `EventGateway`, and the command/event/query buses automatically. Annotate handler classes with `@Component` (or `@Service`) and they are discovered and registered automatically.

Customise via `application.yml` properties or by declaring `@Bean`s of `MessagingConfigurer`, `EventProcessingConfigurer`, etc. — Spring auto-configuration backs off when you provide your own.

```yaml
axon:
  event-processing:
    processors:
      courses-projection:
        mode: pooled-streaming
```

```java
@Configuration
class AxonConfig {

    @Bean
    TagResolver tagResolver() {
        return new AnnotationBasedTagResolver();
    }

    @Bean
    CorrelationDataProvider traceIdProvider() {
        return message -> Map.of("traceId",
                (String) message.metadata().getOrDefault("traceId", "unknown"));
    }
}
```

With Spring Boot, `@EventSourcedEntity` classes and `@Component`-annotated command handler classes that use `@InjectEntity` are auto-detected — no manual `registerEntity()` call needed.

---

## Shutdown

Always shut down cleanly to flush in-flight event processors and release resources:

```java
Runtime.getRuntime().addShutdownHook(new Thread(config::shutdown));
```
