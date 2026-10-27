# Conversion and Serialization in Axon Framework 5

AF5 converts message payloads when storing events, sending commands/queries over the network, and passing messages between application parts. This is handled by the `Converter` abstraction. You mostly configure it once and never call it directly — the framework invokes it at exactly the right moment: before a handler runs and before a message leaves the application (to storage or the wire).

This guide covers the `Converter` layering, the Jackson/Avro/CBOR implementations, content-type conversion, and how to configure converters in plain Java and Spring Boot. For how converted payloads end up in the store, see `event-store/primitives.md`. For configuration mechanics, see `configuration/plain-java.md` and `configuration/spring-boot.md`. For how events change shape over time, see `events/versioning-upcasting.md`.

---

## Message type vs. Java class

AF5 decouples a message's identity from its Java class. A message is identified by its `MessageType` — a `QualifiedName` (namespace + local name) plus a `version`. The namespace defaults to the package name and the local name to the simple class name, but **set the namespace explicitly** so the stored identity does not track the Java package. Declare these with `@Event` (events) so the framework can map the serialized form back to a handler:

```java
package com.university.events;

import org.axonframework.messaging.eventhandling.annotation.Event;

// Set namespace explicitly (reverse-DNS-style), independent of the Java package:
@Event(namespace = "com.university.faculty", name = "StudentEnrolled", version = "1")
// fully qualified name: "com.university.faculty.StudentEnrolled"
public record StudentEnrolledEvent(String studentId, String courseId) {}
```

Because identity is the `MessageType`, the same logical event can be deserialized into different Java classes in different services, as long as both declare the same qualified name and version. This reduces the need for upcasters and eases gradual migration.

> The `@Event` annotation has only `namespace`, `name`, and `version` attributes. The fully qualified name is `namespace + "." + name`. Were `namespace` omitted here it would default to the package `"com.university.events"` — moving the class to another package would then change the event's identity, which is exactly why it should be set explicitly.

---

## Conversion at handling time

Messages keep their serialized form (JSON, CBOR, Avro binary) plus their `MessageType`. When a handler is ready, the framework converts the payload to *that handler's* expected parameter type — independently per handler. Two handlers can receive the same event in different representations:

```java
import org.axonframework.messaging.eventhandling.annotation.EventHandler;
import tools.jackson.databind.JsonNode;

@EventHandler
void on(StudentEnrolledEvent event) {
    // Receives the fully deserialized object
    repository.save(new Enrollment(event.studentId(), event.courseId()));
}

@EventHandler(eventName = "com.university.events.StudentEnrolled")
void on(JsonNode event) {
    // Same event, delivered as a JsonNode tree
    String studentId = event.get("studentId").asText();
}
```

> When a handler parameter is a generic representation like `JsonNode`, set `@EventHandler(eventName = "...")` with the fully qualified name, since the parameter type no longer identifies the event.

### Converter attachment when loading

So handler code never references a converter, AF5 attaches the appropriate `Converter` to each message the moment it is loaded from a serialized state (read from the store, received over the wire). Calling `payloadAs(...)` then converts on demand:

```java
@EventHandler
void on(EventMessage event) {
    // The converter was attached at load time — no need to pass one
    StudentEnrolledEvent payload = event.payloadAs(StudentEnrolledEvent.class);
    repository.save(new Enrollment(payload.studentId(), payload.courseId()));
}
```

`Message#payloadAs` is overloaded: `payloadAs(Class<T>)`, `payloadAs(TypeReference<T>)` (for generics), and overloads accepting an explicit `Converter`. When building custom infrastructure that produces messages, attach a converter before the message reaches a handler:

```java
GenericEventMessage withConverter = rawMessage.withConverter(eventConverter);
```

---

## The converter layering

AF5 builds three converter interfaces on top of the base `Converter`. The base contract is minimal:

```java
package org.axonframework.conversion;

public interface Converter extends DescribableComponent {
    <T> T convert(Object input, Class<T> targetType);  // default → convert(input, (Type) targetType)
    <T> T convert(Object input, Type targetType);
}
```

| Interface | Package | Operates on | Used for |
|---|---|---|---|
| `Converter` | `org.axonframework.conversion` | any object | base contract |
| `GeneralConverter` | `org.axonframework.conversion` | non-`Message` objects | snapshots, internal data |
| `MessageConverter` | `org.axonframework.messaging.core.conversion` | `Message` payloads | command & query messages |
| `EventConverter` | `org.axonframework.messaging.eventhandling.conversion` | `EventMessage` payloads | event store & event processors |

`MessageConverter` adds `convertPayload(message, targetType)` and `convertMessage(message, targetType)` (returns a new message with a converted payload). `EventConverter` adds `convertPayload(event, ...)` and `convertEvent(event, ...)`.

There is an implicit fallback ordering: if no `EventConverter` is configured, the `MessageConverter` is used; if no `MessageConverter` is configured, the `GeneralConverter` is used.

If you configure nothing, AF5 registers by default:

- a `DelegatingGeneralConverter` wrapping a `JacksonConverter` as the **general** converter,
- a `DelegatingMessageConverter` wrapping the general converter as the **message** converter,
- a `DelegatingEventConverter` wrapping the message converter as the **event** converter.

---

## Converter implementations

| Implementation | Class | Format | Notes |
|---|---|---|---|
| Jackson (default) | `org.axonframework.conversion.jackson.JacksonConverter` | JSON (Jackson 3) | human-readable, interoperable |
| Jackson 2 | `org.axonframework.conversion.jackson2.Jackson2Converter` | JSON (Jackson 2) | for not-yet-migrated projects |
| Avro | `org.axonframework.conversion.avro.AvroConverter` | binary single-object encoding | message/event converter only |
| CBOR | (Spring property `cbor`) | binary CBOR | compact; requires BLOB columns |

For most new applications, the default `JacksonConverter` with JSON is recommended. Choose Avro when storage size, schema enforcement, and high-throughput performance matter and you run a schema registry.

### JacksonConverter (default)

`JacksonConverter` uses Jackson 3 (`tools.jackson.databind.ObjectMapper`). The no-arg constructor builds a default mapper via `JsonMapper.builder().findAndAddModules().build()`. Customize by passing your own mapper:

```java
import org.axonframework.conversion.Converter;
import org.axonframework.conversion.jackson.JacksonConverter;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

Converter customJacksonConverter() {
    ObjectMapper mapper = JsonMapper.builder()
            .findAndAddModules()
            .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false)
            .build();
    return new JacksonConverter(mapper);
}
```

> If you have not migrated to Jackson 3, use `Jackson2Converter` from `org.axonframework.conversion.jackson2`. It uses `com.fasterxml.jackson` and behaves identically. Its no-arg constructor is supported: `new Jackson2Converter()`.

> **Jackson 3 + `final` fields.** Jackson 3 no longer deserializes `final` fields by default, which affects Kotlin `val` payloads (final by default). Either set the Jackson 3 feature `ALLOW_FINAL_FIELDS_AS_MUTATORS` to `true`, or adjust the payload representation.

### AvroConverter

`AvroConverter` serializes to Avro single-object-encoded binary. It is a message/event converter **only** — it cannot serve as the general converter. It needs a `SchemaStore` to resolve schemas, and is configured through an `AvroConverterConfiguration` customizer (a `UnaryOperator`):

```java
import org.apache.avro.message.SchemaStore;
import org.axonframework.conversion.avro.AvroConverter;

AvroConverter buildAvroConverter(SchemaStore schemaStore) {
    return new AvroConverter(
            schemaStore,
            config -> config  // customize AvroConverterConfiguration here
    );
}
```

In Spring Boot, auto-configuration can build a `SchemaStore` that scans the classpath for schemas. Without Spring, construct the `SchemaStore` yourself. For multiple services, back it with a central schema registry and add caching.

### Custom converters

Implement the `Converter` interface — the contract is `convert(...)` plus `describeTo(...)` (inherited from `DescribableComponent`). Note: there is no `canConvert(...)` on `Converter` itself; that method lives on `ChainingContentTypeConverter`.

```java
import org.axonframework.conversion.Converter;
import org.axonframework.common.infra.ComponentDescriptor;
import java.lang.reflect.Type;

public class MyCustomConverter implements Converter {

    @Override
    public <T> T convert(Object input, Type targetType) {
        // perform conversion
        return /* ... */;
    }

    @Override
    public void describeTo(ComponentDescriptor descriptor) {
        descriptor.describeProperty("someCustomProperty", "SomeValue");
    }
}
```

---

## Content-type conversion

A `Converter` accepts certain input ("content") types as the start of a conversion. To bridge gaps, AF5 inserts `ContentTypeConverter` instances and finds the shortest conversion path from type X to type Y, feeding the result to the requesting converter.

| Converter | Content types it bridges |
|---|---|
| `JacksonConverter` | `JsonNode` and `ObjectNode` |
| `AvroConverter` | `GenericRecord` |
| all | generic conversions like `String` → `byte[]`, `byte[]` → `InputStream` |

The `ContentTypeConverter<S, T>` contract:

```java
package org.axonframework.conversion;

public interface ContentTypeConverter<S, T> {
    Class<S> expectedSourceType();
    Class<T> targetType();
    T convert(S input);
}
```

`ChainingContentTypeConverter` composes these into chains and auto-detects implementations from `/META-INF/services/org.axonframework.conversion.ContentTypeConverter` files on the classpath. Register a custom one explicitly and hand it to your main converter:

```java
import org.axonframework.conversion.ChainingContentTypeConverter;
import org.axonframework.conversion.DelegatingGeneralConverter;
import org.axonframework.conversion.GeneralConverter;
import org.axonframework.conversion.jackson.JacksonConverter;
import tools.jackson.databind.ObjectMapper;

GeneralConverter converterWithCustomContentTypeConverter() {
    ChainingContentTypeConverter contentTypeConverter = new ChainingContentTypeConverter();
    contentTypeConverter.registerConverter(new MyContentTypeConverter());
    return new DelegatingGeneralConverter(
            new JacksonConverter(new ObjectMapper(), contentTypeConverter));
}
```

> A converter registered *last* is inspected *first*. `ChainingContentTypeConverter` only works when both source and target are a `Class` (not a parameterized `Type`).

---

## Configuring converters

### Plain Java

Register the three converter components on the `MessagingConfigurer` component registry. Each level wraps the previous one:

```java
import org.axonframework.conversion.DelegatingGeneralConverter;
import org.axonframework.conversion.GeneralConverter;
import org.axonframework.conversion.jackson.JacksonConverter;
import org.axonframework.messaging.core.configuration.MessagingConfigurer;
import org.axonframework.messaging.core.conversion.DelegatingMessageConverter;
import org.axonframework.messaging.core.conversion.MessageConverter;
import org.axonframework.messaging.eventhandling.conversion.DelegatingEventConverter;
import org.axonframework.messaging.eventhandling.conversion.EventConverter;

void converterConfiguration(MessagingConfigurer configurer) {
    configurer
        .componentRegistry(cr -> cr.registerComponent(
                GeneralConverter.class,
                config -> new DelegatingGeneralConverter(new JacksonConverter())))
        .componentRegistry(cr -> cr.registerComponent(
                MessageConverter.class,
                config -> new DelegatingMessageConverter(config.getComponent(GeneralConverter.class))))
        .componentRegistry(cr -> cr.registerComponent(
                EventConverter.class,
                config -> new DelegatingEventConverter(config.getComponent(MessageConverter.class))));
}
```

> `DelegatingEventConverter` accepts either a `MessageConverter` or a plain `Converter`. The minimal override — registering only `GeneralConverter` with `DelegatingGeneralConverter(new Jackson2Converter())`, for example — is enough, because the message and event converters default to wrapping the level below.

### Spring Boot — Java configuration

```java
import org.axonframework.conversion.Converter;
import org.axonframework.conversion.DelegatingGeneralConverter;
import org.axonframework.conversion.GeneralConverter;
import org.axonframework.conversion.jackson.JacksonConverter;
import org.axonframework.messaging.core.conversion.DelegatingMessageConverter;
import org.axonframework.messaging.core.conversion.MessageConverter;
import org.axonframework.messaging.eventhandling.conversion.DelegatingEventConverter;
import org.axonframework.messaging.eventhandling.conversion.EventConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ConverterConfiguration {

    @Bean
    public GeneralConverter converter() {
        return new DelegatingGeneralConverter(new JacksonConverter());
    }

    @Bean
    public MessageConverter messageConverter(Converter converter) {
        return new DelegatingMessageConverter(converter);
    }

    @Bean
    public EventConverter eventConverter(MessageConverter messageConverter) {
        return new DelegatingEventConverter(messageConverter);
    }
}
```

### Spring Boot — properties

Bound to `@ConfigurationProperties("axon.converter")`. Allowed values: `default`, `jackson`, `jackson2`, `avro`, `cbor`. `avro` applies only to `messages` and `events`.

```properties
axon.converter.general=jackson
axon.converter.messages=jackson
axon.converter.events=jackson
```

```yaml
axon:
  converter:
    general: jackson
    events: jackson
    messages: jackson
```

The defaults cascade: an unset `messages` falls back to `general`; an unset `events` falls back to `messages` (then `general`). See `configuration/spring-boot.md` for the broader property model.

### Using Avro for events only

Keep Jackson for commands/queries while storing events with Avro by overriding just the `EventConverter`:

```java
import org.apache.avro.message.SchemaStore;
import org.axonframework.conversion.avro.AvroConverter;
import org.axonframework.messaging.core.configuration.MessagingConfigurer;
import org.axonframework.messaging.eventhandling.conversion.DelegatingEventConverter;
import org.axonframework.messaging.eventhandling.conversion.EventConverter;

void configureAvroForEvents(MessagingConfigurer configurer, SchemaStore schemaStore) {
    configurer.componentRegistry(cr -> cr.registerComponent(
            EventConverter.class,
            config -> {
                AvroConverter avro = new AvroConverter(schemaStore, cfg -> cfg);
                return new DelegatingEventConverter(avro);
            }));
}
```

---

## Tuning

### Lenient deserialization

Ignore unknown properties so events written by an older or newer deployment still deserialize — useful during rolling deployments and structural evolution. Both `JacksonConverter` and `AvroConverter` support it.

```java
import org.axonframework.conversion.DelegatingGeneralConverter;
import org.axonframework.conversion.GeneralConverter;
import org.axonframework.conversion.jackson.JacksonConverter;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

GeneralConverter buildLenientConverter() {
    return new DelegatingGeneralConverter(
            new JacksonConverter(JsonMapper.builder()
                    .findAndAddModules()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .build()));
}
```

Avro handles cross-version compatibility through its own schema resolution; as long as schema changes follow Avro's compatibility rules, no extra configuration is needed.

### Generic types

Jackson needs type hints to deserialize generic collections. Prefer `@JsonTypeInfo` on the field:

```java
public class CourseRoster {
    @JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
    private List<Student> students;
}
```

Configuring `ObjectMapper#activateDefaultTyping` is an alternative, but be aware of the security implications of polymorphic deserialization before enabling it broadly.

---

## ConversionException

`ConversionException` (extends `AxonNonTransientException`) is thrown when an input cannot be converted to the requested target type — for example when no conversion path exists, or a Jackson/Avro error occurs during (de)serialization. Being non-transient, retrying the same conversion will not help; fix the payload, the schema, or the converter configuration instead.
