# Identifier Generation in Axon Framework 5

Every message in Axon Framework 5 — command, event, or query — carries a unique identifier. The framework generates these through a single pluggable abstraction, `IdentifierFactory`. This guide covers where identifiers come from, the default behaviour, and how to plug in your own strategy. For how identifiers flow through messages, see `foundations/messages-and-processing-context.md`; for the distinct concept of *entity* identifiers and tags used to source decision state, see `commands/decision-models-dcb.md`.

---

## Where message identifiers come from

When the framework builds a `GenericMessage` (the base implementation behind command, event, and query messages) without an explicit identifier, it asks `IdentifierFactory` for one:

```java
// org.axonframework.messaging.core.GenericMessage (framework internal)
this(IdentifierFactory.getInstance().generateIdentifier(), type, payload, declaredPayloadType, metadata);
```

You normally never call this yourself for the *message* identifier — the framework assigns it. `IdentifierFactory` becomes relevant when you need to generate your own *domain* identifiers (a course id, an enrollment id) or when you want to change the generation strategy globally.

---

## The `IdentifierFactory` abstraction

`IdentifierFactory` is an abstract factory in the `org.axonframework.common` package. It exposes a single method and a static accessor:

```java
import org.axonframework.common.IdentifierFactory;

String id = IdentifierFactory.getInstance().generateIdentifier();
```

| Member | Description |
|---|---|
| `static IdentifierFactory getInstance()` | Returns the singleton implementation discovered on the classpath. |
| `abstract String generateIdentifier()` | Produces a unique identifier as a `String`. |

The instance is resolved once, in a static initializer, and cached for the lifetime of the JVM.

### Default behaviour

If no custom implementation is found, the framework uses `DefaultIdentifierFactory`, which returns random `java.util.UUID`s:

```java
// org.axonframework.common.DefaultIdentifierFactory
@Override
public String generateIdentifier() {
    return UUID.randomUUID().toString();
}
```

These are safe — the value space (~3 × 10³⁸) makes collisions effectively impossible — but `UUID.randomUUID()` is not the fastest generator available. Replace it only if profiling shows it matters.

### Generating your own domain identifiers

Use the same factory for the identifiers you mint inside command handlers, so that a custom strategy applies everywhere consistently:

```java
import org.axonframework.common.IdentifierFactory;
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;

class EnrollmentCommandHandler {

    @CommandHandler
    String handle(EnrollStudent command, EventAppender events) {
        String enrollmentId = IdentifierFactory.getInstance().generateIdentifier();
        events.append(new StudentEnrolled(enrollmentId, command.studentId(), command.courseId()));
        return enrollmentId;
    }
}
```

> Preferring `IdentifierFactory.getInstance().generateIdentifier()` over a direct `UUID.randomUUID().toString()` keeps every identifier in your application — message and domain alike — flowing through one configurable strategy.

---

## Customizing identifier generation

`IdentifierFactory` is discovered via Java's `ServiceLoader` mechanism, not through the Axon configurer. To supply your own implementation:

### 1. Implement `IdentifierFactory`

The implementation must extend `IdentifierFactory`, have an accessible no-argument constructor, and be thread-safe (a single instance serves the whole application).

```java
package edu.university.config;

import org.axonframework.common.IdentifierFactory;
import com.github.f4b6a3.uuid.UuidCreator;

public class TimeOrderedIdentifierFactory extends IdentifierFactory {

    @Override
    public String generateIdentifier() {
        // e.g. a time-ordered (UUIDv7-style) value for better index locality
        return UuidCreator.getTimeOrderedEpoch().toString();
    }
}
```

### 2. Register it via `META-INF/services`

Create a file on the classpath named exactly:

```
META-INF/services/org.axonframework.common.IdentifierFactory
```

containing the fully qualified class name of your implementation:

```
edu.university.config.TimeOrderedIdentifierFactory
```

On startup the framework's `ServiceLoader` lookup finds the file and instantiates the named class. From then on, every `IdentifierFactory.getInstance()` call returns your implementation.

### Requirements

| Requirement | Why |
|---|---|
| Fully qualified class name in `META-INF/services/org.axonframework.common.IdentifierFactory` | How `ServiceLoader` locates the implementation. |
| Accessible zero-argument constructor | `ServiceLoader` instantiates it reflectively. |
| Extends `IdentifierFactory` | The contract `getInstance()` returns. |
| Visible to the context classloader (or the one that loaded `IdentifierFactory`) | The lookup tries the context classloader first, then falls back to the `IdentifierFactory` classloader. |
| Thread-safe | One instance is shared across all threads for the JVM's lifetime. |

> The instance is resolved once in a static initializer and cached. Declaring more than one implementation on the classpath is ambiguous — the framework logs a warning and the choice may differ between restarts. Ship exactly one.
