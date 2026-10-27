# Maven Dependencies for Axon Framework 5

This guide covers the Maven coordinates, current versions, and purpose of every AF5 artifact. Use the BOM whenever possible — it keeps all module versions consistent.

Only Axon Framework 5.0 and later is covered here.

---

## Version overview

| Framework | GroupId | Latest stable | Notes |
|---|---|---|---|
| Axon Framework (open source) | `org.axonframework` | `5.2.0` | Apache 2.0 license |
| Axoniq Framework (commercial) | `io.axoniq.framework` | tracks AF5 version | Free for non-production; paid subscription for production |

Both frameworks use the same version numbering line (e.g., `5.2.0`). Axoniq Framework's BOM imports the matching AF5 BOM, so a single BOM import covers everything.

---

## Which BOM should I use?

Pick **one** BOM based on which modules you intend to use. Importing both is unnecessary — the Axoniq BOM already imports the AF5 BOM.

| Your plan | Use this BOM |
|---|---|
| Only open-source AF5: in-memory event store, or your own JPA/JDBC storage, single node, no Axon Server | `org.axonframework:axon-framework-bom` |
| Any commercial Axoniq module: `axoniq-postgresql`, `axon-server-connector`, `axoniq-distributed-messaging`, `axoniq-event-streaming`, `axoniq-dead-letter`, or `axoniq-message-transformation` | `io.axoniq.framework:axoniq-framework-bom` |

The Axoniq BOM is a superset — it manages versions for every `org.axonframework` artifact **and** every `io.axoniq.framework` artifact. If you're unsure whether you'll need a commercial module later (e.g., you'll move from in-memory to PostgreSQL, or add Axon Server), start with the Axoniq BOM: it imports the matching AF5 BOM transitively, so all the `org.axonframework` dependencies below still resolve with no `<version>`, and you can add commercial modules later without touching `dependencyManagement`.

Choosing the Axoniq BOM does **not** pull in any commercial code or licensing obligation on its own — a BOM only manages versions. You only depend on commercial artifacts when you declare them explicitly. See the [licensing notes](#axoniq-framework-commercial) below.

---

## Axon Framework 5 (open source)

### Using the BOM (recommended)

Import the BOM in `dependencyManagement`. This sets all `org.axonframework` module versions consistently — you omit `<version>` from each subsequent dependency.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.axonframework</groupId>
      <artifactId>axon-framework-bom</artifactId>
      <version>5.2.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### Spring Boot starter (recommended entry point)

For Spring Boot applications, pull in one starter — it transitively includes `axon-messaging`, `axon-modelling`, `axon-eventsourcing`, `axon-spring`, `axon-spring-boot-autoconfigure`, and `axon-common`.

```xml
<dependency>
  <groupId>org.axonframework.extensions.spring</groupId>
  <artifactId>axon-spring-boot-starter</artifactId>
  <!-- version managed by BOM -->
</dependency>
```

### Individual modules

Use individual modules when you are not using Spring Boot or when you need fine-grained control.

| ArtifactId | GroupId | Purpose |
|---|---|---|
| `axon-messaging` | `org.axonframework` | Core command/event/query buses, gateway, handler annotations (`@CommandHandler`, `@EventHandler`, `@QueryHandler`), `EventAppender`, `ProcessingContext`, `Metadata`, `CommandHandlingModule`, `QueryHandlingModule`, `EventProcessingConfigurer`, `MessagingConfigurer` |
| `axon-modelling` | `org.axonframework` | Entity modelling: `@InjectEntity`, `@TargetEntityId`, `ModellingConfigurer` |
| `axon-eventsourcing` | `org.axonframework` | Event store, DCB: `EventStore`, `EventSourcingConfigurer`, `@EventSourcedEntity`, `@EventSourcingHandler`, `@EntityCreator`, `@EventTag`, `EventSourcedEntityModule`, `SourcingCondition`, `AppendCondition`, `EventCriteria`, `Tag`, `AnnotationBasedTagResolver` |
| `axon-common` | `org.axonframework` | Shared utilities: `AxonConfiguration`, `ComponentRegistry`, `QualifiedName`, `MessageType`, `Metadata` |
| `axon-conversion` | `org.axonframework` | Message serialisation and conversion (Jackson by default) |
| `axon-test` | `org.axonframework` | `AxonTestFixture`, `GenericTaggedEventMessage`, test matchers. Use in `test` scope. |
| `axon-spring` | `org.axonframework.extensions.spring` | Core Spring integration (component scanning, bean wiring) |
| `axon-spring-boot-autoconfigure` | `org.axonframework.extensions.spring` | Spring Boot auto-configuration for all AF5 components |
| `axon-spring-boot-starter` | `org.axonframework.extensions.spring` | Convenience starter: includes all of the above |
| `axon-spring-boot-starter-test` | `org.axonframework.extensions.spring` | Spring Boot test support for AF5 (`@SpringBootTest` + fixture integration). Use in `test` scope. |
| `axon-metrics-micrometer` | `org.axonframework.extensions.metrics` | Micrometer metrics for message processing rates, latencies |
| `axon-metrics-dropwizard` | `org.axonframework.extensions.metrics` | Dropwizard Metrics integration (alternative to Micrometer) |
| `axon-update` | `org.axonframework` | Update checker: reports anonymous usage data and logs available upgrades/vulnerabilities in the Axon libraries used |

> The OpenTelemetry tracing extension (`axon-tracing-opentelemetry`) was removed from open-source AF5 in 5.2.0. As of 5.2.0 neither framework ships an OpenTelemetry module — do not add this dependency.

### Typical plain Java setup

```xml
<dependencies>
  <!-- Core framework -->
  <dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-messaging</artifactId>
  </dependency>
  <dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-modelling</artifactId>
  </dependency>
  <dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-eventsourcing</artifactId>
  </dependency>

  <!-- Testing -->
  <dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

### Typical Spring Boot setup

```xml
<dependencies>
  <dependency>
    <groupId>org.axonframework.extensions.spring</groupId>
    <artifactId>axon-spring-boot-starter</artifactId>
  </dependency>

  <!-- Testing -->
  <dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

---

## Axoniq Framework (commercial)

Axoniq Framework adds production infrastructure on top of AF5. Its BOM imports `axon-framework-bom`, so a single BOM covers both.

### Using the BOM

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.axoniq.framework</groupId>
      <artifactId>axoniq-framework-bom</artifactId>
      <version>5.2.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

This transitively imports `axon-framework-bom` at the matching version, so you do not need to declare both BOMs.

### Modules

| ArtifactId | GroupId | Purpose |
|---|---|---|
| `axoniq-postgresql` | `io.axoniq.framework` | Production-grade PostgreSQL event store (`PostgresqlEventStorageEngine`) with optimised DCB tag indexing. Since 5.2.0 it is also a `SnapshotStore` (snapshots co-located with the events). Replaces the in-memory default. |
| `axoniq-distributed-messaging` | `io.axoniq.framework` | `DistributedCommandBus` and `DistributedQueryBus` for spreading message load across multiple application instances. |
| `axoniq-event-streaming` | `io.axoniq.framework` | `MultiStreamableEventSource` — consumes events from multiple independent event stores simultaneously in a single event processor. |
| `axoniq-dead-letter` | `io.axoniq.framework` | Dead-letter queue implementations: in-memory, JDBC, JPA, and PostgreSQL backends for event processors. |
| `axoniq-message-transformation` | `io.axoniq.framework` | Message transformation (since 5.2.0): rewrite, rename, or drop stored events on read — the AF5 successor to upcasters. See `events/versioning-upcasting.md`. |
| `axon-server-connector` | `io.axoniq.framework` | Connector for Axon Server as the event store and message broker. Auto-detected on the classpath (connects to `localhost:8124` by default). Since 5.2.0 also provides persistent streams (server-managed event streams) — see `events/processors.md`. Connection/disable config: see `configuration/spring-boot.md` and `configuration/plain-java.md`. |
| `axoniq-testcontainer` | `io.axoniq.framework` | Testcontainers support for running Axon Server in integration tests. Use in `test` scope. |
| `axoniq-data-protection` | `io.axoniq.framework` | Data protection (field-level encryption / crypto-shredding). Version managed by the BOM since 5.2.0; maintained in a separate repository. |
| `axoniq-spring-boot-autoconfigure` | `io.axoniq.framework` | Spring Boot auto-configuration for all Axoniq Framework modules. |
| `axoniq-spring-boot-starter` | `io.axoniq.framework` | Convenience starter: includes all Axoniq Framework modules and the AF5 Spring Boot starter. |

### Typical Axoniq Framework setup (Spring Boot)

```xml
<dependency>
  <groupId>io.axoniq.framework</groupId>
  <artifactId>axoniq-spring-boot-starter</artifactId>
</dependency>

<!-- Choose the storage backend you need: -->
<dependency>
  <groupId>io.axoniq.framework</groupId>
  <artifactId>axoniq-postgresql</artifactId>
</dependency>

<!-- Distributed messaging (if running multiple nodes): -->
<dependency>
  <groupId>io.axoniq.framework</groupId>
  <artifactId>axoniq-distributed-messaging</artifactId>
</dependency>
```

---

## Dependency relationships

```
axon-spring-boot-starter
  └── axon-spring-boot-autoconfigure
      └── axon-spring
          └── axon-eventsourcing
              └── axon-modelling
                  └── axon-messaging
                      └── axon-common

axoniq-spring-boot-starter
  └── axoniq-spring-boot-autoconfigure
      ├── axon-spring-boot-starter  (all of above)
      ├── axoniq-postgresql
      ├── axoniq-distributed-messaging
      └── axoniq-event-streaming
```

`axon-test` and `axoniq-dead-letter` are separate opt-in dependencies not included in any starter.

---

## Gradle

```kotlin
// BOM (Axon Framework only):
implementation(platform("org.axonframework:axon-framework-bom:5.2.0"))

// BOM (Axoniq Framework, includes AF5 BOM):
implementation(platform("io.axoniq.framework:axoniq-framework-bom:5.2.0"))

// Spring Boot:
implementation("org.axonframework.extensions.spring:axon-spring-boot-starter")
testImplementation("org.axonframework:axon-test")

// Plain Java:
implementation("org.axonframework:axon-messaging")
implementation("org.axonframework:axon-modelling")
implementation("org.axonframework:axon-eventsourcing")
testImplementation("org.axonframework:axon-test")
```
