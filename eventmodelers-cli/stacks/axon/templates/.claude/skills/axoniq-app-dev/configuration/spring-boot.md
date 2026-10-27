# Spring Boot Configuration in Axon Framework 5

AF5 auto-configures itself when `axon-spring-boot-starter` is on the classpath. Most components are discovered automatically from the Spring application context — you only need explicit configuration when you want non-default behaviour.

---

## What Spring Boot auto-detects

| What is detected | How | When required |
|---|---|---|
| Any singleton Spring bean whose methods carry `@CommandHandler`, `@EventHandler`, or `@QueryHandler` | `MessageHandlerLookup` (`BeanDefinitionRegistryPostProcessor`) scans the context at startup | No manual registration needed — just annotate and declare as a Spring bean |
| Classes annotated with `@EventSourced` | `SpringEventSourcedEntityLookup` detects all prototype-scoped beans bearing the annotation | Replaces manual `configurer.registerEntity(...)` calls |
| `CorrelationDataProvider` beans | Auto-collected and registered | Declare as `@Bean` to add correlation propagation |
| `EventProcessorDefinition` beans | Auto-collected and applied to the event processing configuration | Declare as `@Bean` to customise or create event processors |
| `CommandGateway`, `QueryGateway`, `EventGateway` | Auto-created as Spring beans | Inject directly; do not construct manually |
| `EventStore` | Auto-created (in-memory default; PostgreSQL when `axoniq-postgresql` is present) | Override by declaring an `EventStorageEngine` or `EventStore` `@Bean` |
| `TagResolver` | Auto-created as `AnnotationBasedTagResolver` | Override by declaring a `TagResolver` `@Bean` |

**Implication**: in a typical Spring Boot application you do not call `EventSourcingConfigurer` directly. Simply annotate your handler classes with `@Component` (or `@Service`, etc.) and declare entity classes with `@EventSourced`. Everything else is wired automatically.

---

## Declaring handlers — nothing extra required

```java
@Component
class CourseCommandHandler {

    @CommandHandler
    void handle(CreateCourse command, EventAppender events) {
        events.append(new CourseCreated(command.courseId(), command.name(), command.capacity()));
    }
}
```

```java
@Component
class CourseProjection {

    @EventHandler
    void on(CourseCreated event) {
        // update read model
    }
}
```

```java
@Component
class CourseQueryHandler {

    @QueryHandler
    CourseView handle(FindCourse query) {
        // return view
    }
}
```

No registration calls. `MessageHandlerLookup` detects any `@Component` singleton with these annotations and registers it automatically.

---

## `@EventSourced` — declaring event-sourced entities

`@EventSourced` is a Spring-specific composite stereotype that combines `@Component` + `@Scope("prototype")` + `@EventSourcedEntity`. Declare it on entity classes that are injected via `@InjectEntity`.

```java
import org.axonframework.extension.spring.stereotype.EventSourced;

@EventSourced
public class CourseState {

    private boolean closed;

    @EventSourcingHandler
    void on(CourseCreated event) { /* initialise */ }

    @EventSourcingHandler
    void on(CourseClosed event) { this.closed = true; }
}
```

`SpringEventSourcedEntityLookup` detects this class and registers it — no `configurer.registerEntity(...)` call needed.

### `@EventSourced` attributes

| Attribute | Type | Default | Purpose |
|---|---|---|---|
| `type` | `String` | Simple class name | Logical type name for the entity |
| `idType` | `Class<?>` | `String.class` | Java type of the entity's identifier; must match the routing key type |
| `tagKey` | `String` | Simple class name | Tag key used to source events for this entity (overridden if an `@EventCriteriaBuilder` method exists) |
| `concreteTypes` | `Class<?>[]` | `{}` | Concrete subclasses for polymorphic entities; required when the entity is abstract |
| `criteriaResolverDefinition` | `Class<? extends CriteriaResolverDefinition>` | `AnnotationBasedEventCriteriaResolverDefinition.class` | How sourcing criteria are resolved; override to use custom logic |
| `entityFactoryDefinition` | `Class<? extends EventSourcedEntityFactoryDefinition>` | `AnnotationBasedEventSourcedEntityFactoryDefinition.class` | How a new entity instance is created |
| `entityIdResolverDefinition` | `Class<? extends EntityIdResolverDefinition>` | `AnnotatedEntityIdResolverDefinition.class` | How the entity ID is extracted from the command; default uses `@TargetEntityId` |

```java
@EventSourced(idType = UUID.class, tagKey = "course")
public class CourseState { ... }
```

---

## Processor assignment — default naming and custom selectors

By default, `DefaultProcessorModuleFactory` assigns each event handler to a processor named after the **Java package** of the handler class. For example, a `@Component` in package `com.example.orders.projection` is assigned to a processor named `com.example.orders.projection`.

To override, declare an `EventProcessorDefinition` bean with a custom selector based on package name or bean name:

```java
@Configuration
class ProcessorConfig {

    @Bean
    EventProcessorDefinition ordersProcessor() {
        return EventProcessorDefinition.pooledStreaming("orders-processor")
                .assigningHandlers(descriptor ->
                        descriptor.beanType() != null
                        && descriptor.beanType().getPackageName().startsWith("com.example.orders"))
                .notCustomized();
    }
}
```

> **Assigning by namespace with `@Namespace` (since AF5.1)**: annotate a handler type — or an entire package/module via `package-info.java` — with `@Namespace("orders")` (`org.axonframework.messaging.core.annotation.Namespace`) to declare its bounded context. You can then assign every handler in that namespace to a processor with `pooledStreamingMatching(name)` / `subscribingMatching(name)`, which match on the type's namespace via `EventHandlerSelector.matchesNamespaceOnType(name)`:

```java
@Bean
EventProcessorDefinition ordersProcessor() {
    return EventProcessorDefinition.pooledStreamingMatching("orders").notCustomized();
}
```

The manual package-/bean-name selector shown above remains available, and is the only option on AF5.0 (where `@Namespace` does not yet exist).

---

## `EventProcessorDefinition` — custom event processor configuration

Declare an `EventProcessorDefinition` bean to control which event handlers go into which processor and how that processor is configured. Auto-configuration collects all `EventProcessorDefinition` beans at startup.

### Factory methods

| Method | Processor type | Handler selection |
|---|---|---|
| `pooledStreaming(name)` | `PooledStreamingEventProcessor` | Manual — supply a selector |
| `pooledStreamingMatching(name)` | `PooledStreamingEventProcessor` | Auto — matches handlers whose `@Namespace` equals `name` |
| `subscribing(name)` | `SubscribingEventProcessor` | Manual — supply a selector |
| `subscribingMatching(name)` | `SubscribingEventProcessor` | Auto — matches handlers whose `@Namespace` equals `name` |

`pooledStreamingMatching` and `subscribingMatching` are shorthands for calling `assigningHandlers(EventHandlerSelector.matchesNamespaceOnType(name))` automatically.

### Fluent API flow

```
EventProcessorDefinition.pooledStreaming("myProcessor")   // 1. choose type + name
    .assigningHandlers(selector)                           // 2. assign handlers
    .customized(config -> config.batchSize(10))            // 3. configure (or .notCustomized())
```

`pooledStreamingMatching` / `subscribingMatching` skip step 2:

```
EventProcessorDefinition.pooledStreamingMatching("courses")  // assigns by @Namespace("courses")
    .customized(config -> config.maxClaimedSegments(4))
```

### `EventHandlerSelector` — the selector predicate

`EventHandlerSelector` is a functional interface (`Predicate<EventHandlerDescriptor>`). Use a lambda or the built-in factory:

```java
// Lambda — match by bean name prefix
EventHandlerSelector selector = descriptor -> descriptor.beanName().startsWith("order");

// Built-in — match by @Namespace value
EventHandlerSelector selector = EventHandlerSelector.matchesNamespaceOnType("orders");
```

`EventHandlerDescriptor` provides:
- `beanName()` — Spring bean name
- `beanType()` — Java type (`null` if Spring cannot resolve it)
- `beanDefinition()` — Spring `BeanDefinition`
- `resolveBean()` — actual bean instance

`matchesNamespaceOnType(namespace)` searches for `@Namespace` in this order: class → enclosing classes → package → module. Returns `false` if the type cannot be resolved.

### Full example

```java
@Configuration
class ProcessorConfig {

    @Bean
    EventProcessorDefinition coursesProcessor() {
        return EventProcessorDefinition.pooledStreamingMatching("courses")
                .customized(config -> config
                        .initialSegmentCount(8)
                        .maxClaimedSegments(4)
                        .batchSize(10));
    }

    @Bean
    EventProcessorDefinition notificationsProcessor() {
        return EventProcessorDefinition.subscribing("notifications")
                .assigningHandlers(descriptor ->
                        descriptor.beanType() != null
                        && descriptor.beanType().getPackageName().startsWith("com.example.notifications"))
                .notCustomized();
    }
}
```

---

## `PooledStreamingEventProcessorConfiguration` reference

All methods return `PooledStreamingEventProcessorConfiguration` for fluent chaining.

| Method | Default | Purpose |
|---|---|---|
| `initialSegmentCount(int)` | `16` | Segments created at first startup (no-op if tokens already exist) |
| `maxClaimedSegments(int)` | unlimited | Maximum segments a single instance will claim |
| `batchSize(int)` | `1` | Events processed per transaction — increase for throughput when handlers are idempotent |
| `tokenClaimInterval(long ms)` | `5000` | Wait time after a failed claim attempt before retrying |
| `claimExtensionThreshold(long ms)` | `5000` | How often a work package extends its token claim while idle |
| `enableCoordinatorClaimExtension()` | off | Lets the coordinator extend claims on behalf of work packages (useful when batch processing is long) |
| `eventSource(StreamableEventSource)` | from config | Override the event source (e.g. for multi-source streaming) |
| `tokenStore(TokenStore)` | from config | Override the token store |
| `coordinatorExecutor(ScheduledExecutorService)` | from config | Thread pool for the coordinator |
| `workerExecutor(ScheduledExecutorService)` | from config | Thread pool for work packages |
| `errorHandler(ErrorHandler)` | `PropagatingErrorHandler` | Override error handling strategy |
| `initialToken(Function<TrackingTokenSource, CompletableFuture<TrackingToken>>)` | replay from head | Override where processing starts on first run |
| `eventCriteria(Function<Set<QualifiedName>, EventCriteria>)` | `havingAnyTag().andBeingOneOfTypes(...)` | Override event filtering criteria |
| `withInterceptor(MessageHandlerInterceptor<EventMessage>)` | none | Add a handler interceptor for this processor |

---

## `SubscribingEventProcessorConfiguration` reference

| Method | Purpose |
|---|---|
| `eventSource(SubscribableEventSource)` | Override the event bus/source |
| `errorHandler(ErrorHandler)` | Override error handling |
| `unitOfWorkFactory(UnitOfWorkFactory)` | Override unit of work lifecycle |
| `withInterceptor(MessageHandlerInterceptor<EventMessage>)` | Add a handler interceptor |

---

## Connecting to Axon Server

With the `io.axoniq.framework:axon-server-connector` dependency on the classpath, Spring Boot auto-detects it and uses Axon Server as the event store and message broker. With no properties set it connects to **`localhost:8124`** (gRPC) on context **`default`**; the dashboard is at `http://localhost:8024`.

Configure the connection under the `axon.axonserver` prefix:

```yaml
axon:
  axonserver:
    enabled: true                              # default true when the connector is present
    servers: axonserver-1:8124,axonserver-2:8124   # comma-separated host[:grpcPort] list; default localhost:8124
    context: university                        # default "default"
    token: ${AXONSERVER_TOKEN:}                # only when access control is enabled
```

As Spring relaxed-binding properties, these also bind from environment variables — e.g. `AXON_AXONSERVER_SERVERS`, `AXON_AXONSERVER_CONTEXT`, `AXON_AXONSERVER_TOKEN`. (Axon Server's *own* server-side settings use a different `axoniq.axonserver.*` / `AXONIQ_AXONSERVER_*` prefix — for example `AXONIQ_AXONSERVER_HOSTNAME` — and are unrelated to the client properties above.)

Property-based connection configuration is still being rounded out across the 5.x line; if a property does not take effect on your version, configure the connection by declaring an `AxonServerConfiguration` bean, which always works:

```java
import org.axonframework.axonserver.connector.AxonServerConfiguration;

@Bean
AxonServerConfiguration axonServerConfiguration() {
    var config = new AxonServerConfiguration();
    config.setServers("axonserver-1:8124,axonserver-2:8124");
    config.setContext("university");
    config.setToken(System.getenv("AXONSERVER_TOKEN"));
    return config;
}
```

> **DCB requires a DCB-enabled context.** Dynamic Consistency Boundary features only work against an Axon Server context created as DCB-enabled; a plain context rejects tag-based sourcing/append conditions.

> **`axon.axonserver.enabled=false` does not reliably keep the application off Axon Server with this connector.** The connector registers its event store through a `ServiceLoader`-discovered `ConfigurationEnhancer` (`ServerConnectorConfigurationEnhancer`) that still initialises and connects regardless of the flag. To guarantee the in-memory engine (e.g. in a test or local run), disable that enhancer or keep the connector off the test classpath — see `testing/advanced.md`.

---

## `application.yml` processor properties

`@ConfigurationProperties("axon.eventhandling")` binds processor settings by name. These are overridden by programmatic `EventProcessorDefinition.customized(...)` settings when both are present.

```yaml
axon:
  eventhandling:
    processors:
      courses:
        mode: POOLED                   # POOLED (default) or SUBSCRIBING
        initial-segment-count: 16      # segments on first run
        max-claimed-segments: 4        # max segments per instance (optional)
        batch-size: 1                  # events per transaction
        token-claim-interval: 5000     # ms between claim retries
        token-claim-interval-time-unit: MILLISECONDS
        thread-count: 4                # worker threads
        token-store: tokenStore        # Spring bean name of the TokenStore
        source:                        # Spring bean name of the event source (optional)
        sequencing-policy:             # Spring bean name of SequencingPolicy (optional)
      notifications:
        mode: SUBSCRIBING
```

Valid values for `mode`: `POOLED`, `SUBSCRIBING`.

> **`POOLED` is the default**. If the only thing you would configure for a processor is `mode: POOLED`, you can omit the entry entirely — no YAML is needed.

> **Processor names with hyphens** must be quoted in YAML:
> ```yaml
> axon:
>   eventhandling:
>     processors:
>       "auction-projection":
>         mode: POOLED
> ```

---

## Correlation data providers

Declare any number of `CorrelationDataProvider` beans — all are auto-registered:

```java
@Bean
CorrelationDataProvider traceIdProvider() {
    return message -> {
        var carry = new java.util.HashMap<String, Object>();
        if (message.metadata().containsKey("traceId")) {
            carry.put("traceId", message.metadata().get("traceId"));
        }
        return carry;
    };
}
```

---

## `@EntityScan` and Axon's JPA entities

If your application uses `@EntityScan` to control which packages Hibernate scans for `@Entity` classes, always include `"org.axonframework"` in the base packages:

```java
@EntityScan(basePackages = {"com.example.myapp", "org.axonframework"})
```

`@EntityScan` overrides Spring Boot's default scanning entirely. Without `"org.axonframework"`, Axon's own JPA entities — such as `TokenEntry` (used by `JpaTokenStore`) — are no longer found, causing a `"Could not resolve root entity 'TokenEntry'"` error at startup.

---

## Common configuration overrides via `@Bean`

| Bean type | Effect |
|---|---|
| `TagResolver` | Override tag resolution (default: `AnnotationBasedTagResolver`) |
| `EventStorageEngine` | Replace the in-memory default (e.g. `PostgresqlEventStorageEngine`) |
| `TransactionManager` | Provide JPA or custom transaction management |
| `TokenStore` | Provide a durable token store for pooled streaming processors |
| `CorrelationDataProvider` | Add metadata propagation (multiple beans supported) |
| `EventProcessorDefinition` | Define or customise event processors (multiple beans supported) |

When you declare any of these, Spring Boot auto-configuration backs off and uses your bean instead.
