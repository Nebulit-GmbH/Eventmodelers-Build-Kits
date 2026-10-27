# Event Versioning and Upcasting in Axon Framework 5

Events are stored indefinitely, so over the lifetime of an application their schema *will* change. This guide covers how to evolve event schemas safely. AF5's primary mechanism is **payload conversion at handling time** — see [events/handling-projections.md](handling-projections.md) for how handlers are written and [event-store/conversion-serialization.md](../event-store/conversion-serialization.md) for the conversion layer. For how events are persisted, see [event-store/primitives.md](../event-store/primitives.md).

> **Read this first.** Prefer **payload conversion at handling time** — it covers the large majority of real-world schema changes with no extra infrastructure. When the stored representation itself must change for all consumers (renames, structural rewrites, drops), use **message transformation** — the AF5 successor to AF4 upcasters, available from **5.2.0** in the commercial Axoniq Framework module `axoniq-message-transformation`. On AF 5.0/5.1, or on open-source AF5 only, payload conversion is the only mechanism — there is no upcaster API in open-source AF5.

---

## Identifying an event version

Every event type carries a `MessageType` — a fully qualified name plus a version. You control all three with the `@Event` annotation (`org.axonframework.messaging.eventhandling.annotation.Event`):

```java
import org.axonframework.messaging.eventhandling.annotation.Event;

@Event(
    namespace = "com.university.faculty",  // best practice: set explicitly (else defaults to the package name)
    name      = "CourseCreated",           // defaults to the simple class name
    version   = "1.0.0"                    // defaults to "0.0.1"
)
public record CourseCreated(String courseId, String name, int capacity) {
}
```

> Set `namespace` explicitly rather than letting it default to the package. Use a stable, hierarchical reverse-DNS-style name — `<company>.<application>.<domain>[.<subdomain>]`, e.g. `"com.university.faculty"` — so the stored event identity stays fixed when the Java class is moved or its package renamed.

| Attribute | Maps to | Default |
|---|---|---|
| `namespace` | `QualifiedName#namespace()` | package name of the class |
| `name` | `QualifiedName#localName()` | simple class name |
| `version` | `MessageType#version()` | `"0.0.1"` (`MessageType.DEFAULT_VERSION`) |

The `name` is the stable business identity stored in the event store; the `version` distinguishes successive shapes of that same event. Changing the Java class name or package does **not** change the stored identity as long as `name`/`namespace` stay fixed — that is what lets you refactor freely.

---

## Payload conversion at handling time

When an event is stored, it keeps its serialized form (JSON, Avro binary, ...) together with its `MessageType`. When a handler needs the event, Axon converts that stored payload into the type the handler asks for — *at handling time*, per handler. Two consequences:

- Different handlers (even in different applications) can read the same stored event as different Java types.
- You evolve handling code without ever rewriting stored events.

### Matching a handler to a stored event

The first parameter's type normally drives both the matched event name and the target representation. When the Java type no longer shares its name with the stored event, pin the match explicitly with `eventName`:

```java
import org.axonframework.messaging.eventhandling.annotation.EventHandler;

class CourseProjection {

    // Reads the stored "CourseCreated" as the original record
    @EventHandler(eventName = "CourseCreated")
    void on(CourseCreated event) {
        repository.save(new CourseView(event.courseId(), event.name(), event.capacity()));
    }
}
```

If unspecified, `eventName` is derived from the payload type (the first parameter) by the configured `MessageTypeResolver`. You can also force the *representation* a handler receives with `payloadType` (defaults to `Object.class`), independent of the first parameter — useful for handlers that work against a raw representation.

### Reading an old event as a new shape

Suppose `CourseCreated` later needs a computed field. Define a new record under the **same** event `name`, add the field, and compute it in a constructor. A handler that asks for the new type triggers conversion of the stored payload into it:

```java
import com.fasterxml.jackson.annotation.JsonAlias;
import org.axonframework.messaging.eventhandling.annotation.Event;
import org.axonframework.messaging.eventhandling.annotation.EventHandler;

@Event(name = "CourseCreated", version = "2.0.0")
public record EnrichedCourseCreated(
    String courseId,
    @JsonAlias("name") String title,   // old field "name" maps onto "title"
    int capacity,
    int seatsRemaining                 // new field, defaulted during conversion
) {
    // Convenience constructor used when no seatsRemaining was stored
    public EnrichedCourseCreated(String courseId, String title, int capacity) {
        this(courseId, title, capacity, capacity);
    }
}

class CapacityProjection {

    @EventHandler
    void on(EnrichedCourseCreated event) {
        // Stored "CourseCreated" payloads are converted to this type on the fly.
        repository.updateSeats(event.courseId(), event.seatsRemaining());
    }
}
```

Meanwhile another handler — possibly in a different service — keeps reading the original shape unchanged:

```java
@EventHandler(eventName = "CourseCreated")
void on(CourseCreated event) {
    // Legacy handling path, still receiving the v1 representation.
}
```

Both handlers consume the *same* stored event; Axon's `Converter` (`org.axonframework.conversion.Converter`) does the per-handler transformation via `convert(input, targetType)`.

### What payload conversion handles without any extra code

| Change | How |
|---|---|
| **Add a field** | Give it a default in a constructor, or let the (de)serializer default it |
| **Remove a field** | Simply omit it from the new type — readers ignore unknown stored fields |
| **Rename a field** | Map old to new with Jackson `@JsonProperty` / `@JsonAlias` |
| **Change a field's type** | The `Converter` transforms compatible types (e.g. `String`→`Integer`, `Date`→`Instant`) |
| **Restructure per handler** | Each handler declares its own Java type for the same event |

> **Jackson defaulting.** With the Jackson-based converter, configure leniency (e.g. `FAIL_ON_UNKNOWN_PROPERTIES = false`) so removed/added fields do not break deserialization of older payloads. `@JsonAlias` is the cleanest way to keep accepting an old field name while exposing a new one.

This is intentionally the path of least resistance: prefer it, and reach for upcasters only when the **stored structure itself** must change in ways conversion cannot express.

---

## Backward- and forward-compatible event design

A few rules keep events evolvable regardless of mechanism:

- **Never reuse a `name` for a semantically different event.** The `name` is the contract; bump `version` for shape changes, mint a new `name` for new meaning.
- **Add, don't repurpose.** Adding optional/defaulted fields is backward compatible. Changing the meaning of an existing field is not — introduce a new field instead.
- **Avoid required fields without defaults** when you cannot backfill them for historical events.
- **Keep payloads serializer-friendly:** stable field names, simple types, records. Lean on `@JsonAlias`/`@JsonProperty` rather than renaming stored keys.
- **Decouple the stored name from the Java type name** via `@Event(name = ...)` so you can rename/move classes without an upcaster.

---

## Message transformation (Axoniq Framework 5.2.0+)

Unlike payload conversion (per handler, at handling time), a **message transformation** changes how an event is read *from the event store*, before any handler or interceptor sees it — one transformation applied to all consumers. It is non-destructive: stored events are never rewritten; they are transformed on read (both sourcing and streaming). This is the AF5 successor to AF4's upcasters.

> **Availability.** Message transformation ships in the **commercial Axoniq Framework** as `io.axoniq.framework:axoniq-message-transformation`, from 5.2.0. It is not part of open-source AF5 (the open-source repo only carries a demo application, `examples/university-message-transformation`). On open-source-only projects, use payload conversion.

### Defining transformations

Entry point: `EventTransformation` (`io.axoniq.framework.messaging.transformation.events`). Identity is the logical `MessageType` (qualified name + version) — the same identity you control with `@Event`. Three operations exist:

```java
import io.axoniq.framework.messaging.transformation.events.EventTransformation;
import org.axonframework.messaging.core.MessageType;

// 1. Rewrite a payload under the same name (version bump).
//    The target must keep the same qualified name; only the version may change.
EventTransformation courseV1toV2 = EventTransformation
        .from(new MessageType(COURSE_CREATED, "1.0.0"))
        .to(new MessageType(COURSE_CREATED, "2.0.0"))
        .transform(JsonNode.class, v1 -> splitCapacityIntoMinMax(v1));

// 2. Rename an event (change qualified name and/or version; payload untouched).
EventTransformation rename = EventTransformation.rename(
        new MessageType(COURSE_OFFERED, "1.0.0"),
        new MessageType(COURSE_PUBLISHED, "1.0.0"));

// 3. Drop an event from the read stream (it stays in storage).
EventTransformation drop = EventTransformation.drop(new MessageType(SYSTEM_HEARTBEAT, "1.0.0"));
```

`transform(...)` accepts a `Class<T>` or `TypeReference<T>` input type and a `Function<T, U>` or `BiFunction<T, ProcessingContext, U>` mapper. The input type may be a purpose-written record of the old stored shape (type-safe — the framework verifies the mapper's output identity against the declared `to`), a Jackson `JsonNode`, or a `Map<String, Object>`. The payload arrives deserialized; there is no AF4-style `IntermediateEventRepresentation`.

To match a *range* of versions, use a predicate. `declaringFromTypes(...)` declares which stored names the rule reads — used for criteria widening:

```java
EventTransformation.from(type -> type.version().startsWith("0."))
        .declaringFromTypes(WELCOME_MESSAGE_SENT)
        .to(new MessageType(WELCOME_MESSAGE_SENT, "1.0.0"))
        .transform(JsonNode.class, this::liftBetaShape);
```

### Registering the chain

Build one `EventTransformerChain` and register it as a component; a ServiceLoader-discovered configuration enhancer detects it and decorates the `EventStore` read path. There is no dedicated configurer method and no Spring property.

```java
EventTransformerChain chain = EventTransformerChain.builder()
        .register(courseV1toV2)
        .register(rename)
        .register(drop)
        .build();

// Plain Java
configurer.componentRegistry(registry ->
        registry.registerComponent(EventTransformerChain.class, config -> chain));
```

Under Spring Boot, expose the chain as a `@Bean` — beans are registered as components, and the same enhancer picks it up.

### Semantics

- **Read-side only.** Sourcing and streaming see transformed events; appends, live publish/subscribe dispatch, and tracking tokens are untouched. Transformation runs before any interceptor or handler.
- **Chains compose to a fixed point.** Transformations re-apply to an event until none matches, so v1→v2→v3 hops compose regardless of registration order (bounded by `maxIterationsPerEvent`, default 100).
- **Precedence.** An exact `from(MessageType)` always beats a predicate match; among predicates, the first registered wins.
- **Criteria widening is automatic.** When sourcing asks for a target type, the chain widens the `EventCriteria` so events still stored under the declared source names are fetched too. A predicate rule without `declaringFromTypes(...)` drops the type filter entirely (broader reads, but never misses events).
- **Dropped events still advance the stream position** — streaming processors do not revisit them.
- **Validation.** Two transformations with the same exact source, a payload mapping whose `to` changes the qualified name, or mapper output that does not match the declared `to` identity fail with `ChainConfigurationException` (at `build()` or at read time).
- **Unversioned legacy events** (stored without a version) resolve to version `0.0.1` — write your `from(...)` accordingly.

### Not supported

Splitting one stored event into several, changing metadata, and context-carrying transforms (merging events, moving a field from one event to another) are not supported by the transformation API. Handle those by designing new events going forward, or per handler with payload conversion.

---

## Choosing a strategy

| Situation | Use |
|---|---|
| Add/remove/rename a field; change a field type | Payload conversion (define new `@Event` shape + Jackson annotations) |
| Different handlers want different shapes of one event | Payload conversion (per-handler types, `eventName`) |
| Rename/move the Java class, keep stored identity | Keep `@Event(name = ...)` stable — no transform needed |
| Split, merge, or re-identify stored events; cross-event moves | Upcasting — **wait for 5.2.0**; stage the change until then |

For the overwhelming majority of schema changes in AF5.0/5.1, payload conversion at handling time is the answer. Reserve upcasting for genuine stored-structure changes, and only once the mechanism ships.
