# Handler Customization in Axon Framework 5

Three advanced SPIs let you change *how* annotated handler methods are discovered and invoked, beyond what [interceptors](interceptors.md) and the built-in [supported parameters](supported-parameters.md) provide:

| Topic | Interface / annotation | What it does |
|---|---|---|
| **Custom parameter injection** | `ParameterResolverFactory` + `ParameterResolver<T>` | Inject your own parameter types into `@CommandHandler` / `@EventHandler` / `@QueryHandler` methods |
| **Handler wrapping** | `HandlerEnhancerDefinition` + `MessageHandlingMember<T>` | Wrap or filter handler invocation at resolution time |
| **Meta-annotations** | any framework annotation (e.g. `@CommandHandler`) | Compose your own annotations from framework annotations |

All three are discovered through the Java `ServiceLoader` (SPI) mechanism, and the first two can additionally be registered programmatically or as Spring beans. They live in the `org.axonframework.messaging.core.annotation` package.

> These are framework-extension points. For everyday cross-cutting concerns (logging, validation, retry, metadata enrichment) prefer [interceptors](interceptors.md) — they are simpler and require no SPI registration.

---

## Custom ParameterResolver

A `ParameterResolver<T>` produces a value for a single handler-method parameter from the active `ProcessingContext`. A `ParameterResolverFactory` decides, per parameter, whether it can supply a resolver.

```java
package org.axonframework.messaging.core.annotation;

public interface ParameterResolver<T> {

    // Asynchronously resolves the value; completes with null if absent
    CompletableFuture<T> resolveParameterValue(ProcessingContext context);

    // Whether a value can be provided for this context right now
    boolean matches(ProcessingContext context);

    // Optional: narrow this resolver to a specific payload type
    default Class<?> supportedPayloadType() {
        return Object.class;
    }
}

@FunctionalInterface
public interface ParameterResolverFactory {

    // Inspect one parameter; return a resolver, or null if not applicable
    @Nullable
    ParameterResolver<?> createInstance(Executable executable,
                                        Parameter[] parameters,
                                        int parameterIndex);
}
```

> Note the AF5 shape: `resolveParameterValue` takes only the `ProcessingContext` and returns a `CompletableFuture<T>`. The current `Message` is obtained from the context with `Message.fromContext(context)` rather than passed in directly.

### Example — inject a tenant-scoped `Registrar` by type

Suppose handlers in the university domain want the current academic `Registrar` injected — resolved from metadata on the message.

```java
import org.axonframework.messaging.core.Message;
import org.axonframework.messaging.core.annotation.ParameterResolver;
import org.axonframework.messaging.core.annotation.ParameterResolverFactory;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;

import java.lang.reflect.Executable;
import java.lang.reflect.Parameter;
import java.util.concurrent.CompletableFuture;

public class RegistrarParameterResolverFactory implements ParameterResolverFactory {

    private final RegistrarRepository registrars;

    public RegistrarParameterResolverFactory(RegistrarRepository registrars) {
        this.registrars = registrars;
    }

    @Override
    public ParameterResolver<?> createInstance(Executable executable,
                                               Parameter[] parameters,
                                               int parameterIndex) {
        // Only match parameters declared as Registrar
        if (!Registrar.class.isAssignableFrom(parameters[parameterIndex].getType())) {
            return null;
        }
        return new ParameterResolver<Registrar>() {
            @Override
            public CompletableFuture<Registrar> resolveParameterValue(ProcessingContext context) {
                Message message = Message.fromContext(context);
                String facultyId = (String) message.metadata().get("facultyId");
                return CompletableFuture.completedFuture(registrars.forFaculty(facultyId));
            }

            @Override
            public boolean matches(ProcessingContext context) {
                Message message = Message.fromContext(context);
                return message != null && message.metadata().containsKey("facultyId");
            }
        };
    }
}
```

A handler can now simply declare the parameter:

```java
@CommandHandler
void handle(EnrollStudent command, Registrar registrar, EventAppender events) {
    registrar.assertEnrolmentAllowed(command.studentId());
    events.append(new StudentEnrolled(command.courseId(), command.studentId()));
}
```

### Annotation-driven resolvers

To bind a resolver to a custom *annotation* (instead of a parameter type), extend `AbstractAnnotatedParameterResolverFactory<A, P>`. It already does the "annotation present *and* parameter type assignable" plumbing — you only supply the resolver. This is exactly how built-ins like `@MessageIdentifier` work:

```java
@Priority(Priority.HIGH)
public final class MessageIdentifierParameterResolverFactory
        extends AbstractAnnotatedParameterResolverFactory<MessageIdentifier, String> {

    private final ParameterResolver<String> resolver = new ParameterResolver<>() {
        @Override
        public CompletableFuture<String> resolveParameterValue(ProcessingContext context) {
            return CompletableFuture.completedFuture(Message.fromContext(context).identifier());
        }
        @Override
        public boolean matches(ProcessingContext context) {
            return Message.fromContext(context) != null;
        }
    };

    public MessageIdentifierParameterResolverFactory() {
        super(MessageIdentifier.class, String.class); // annotation type + declared param type
    }

    @Override
    protected ParameterResolver<String> getResolver() {
        return resolver;
    }
}
```

### Registration

A factory must be **public, non-abstract, and have a public no-arg constructor** to be loaded via the classpath. Two routes:

**(1) Classpath SPI** — create
`META-INF/services/org.axonframework.messaging.core.annotation.ParameterResolverFactory`
containing the fully-qualified class name(s), one per line:

```
com.university.config.RegistrarParameterResolverFactory
```

The `ClasspathParameterResolverFactory` discovers these automatically (alongside framework defaults via `MultiParameterResolverFactory`).

**(2) Programmatic** — when the factory needs constructor dependencies (as `RegistrarParameterResolverFactory` does), register it on the `MessagingConfigurer` (see [configuration/plain-java.md](../configuration/plain-java.md)):

```java
messagingConfigurer.registerParameterResolverFactory(
        config -> new RegistrarParameterResolverFactory(
                config.getComponent(RegistrarRepository.class)));
```

In Spring Boot, declaring the factory as a `@Bean` is sufficient.

> `@Priority(Priority.HIGH)` on a factory raises it above the defaults so a custom resolver can take precedence for a given parameter.

---

## HandlerEnhancerDefinition

A `HandlerEnhancerDefinition` wraps a `MessageHandlingMember<T>` — the framework's representation of a single annotated handler method — at *resolution time*, before any message is dispatched. Unlike interceptors, it has access to the handler member itself (its declared attributes, signature, and target entity), so it can filter or augment individual handlers.

```java
package org.axonframework.messaging.core.annotation;

public interface HandlerEnhancerDefinition {

    // Return the original, or a wrapper around it
    <T> MessageHandlingMember<T> wrapHandler(MessageHandlingMember<T> original);
}
```

The `MessageHandlingMember<T>` exposes, among others:

| Member | Purpose |
|---|---|
| `payloadType()` | Declared payload type of the handler |
| `canHandle(Message, ProcessingContext)` | Whether this handler accepts a given message |
| `canHandleMessageType(Class<? extends Message>)` | Filter by message kind, e.g. `CommandMessage.class` |
| `handle(Message, ProcessingContext, T target)` | Invoke the handler, returning a `MessageStream<?>` |
| `attribute(String key)` | Read an annotation attribute (meta-annotation aware) |
| `unwrap(Class)` | Get the underlying `Executable` / `Member` |

Extend `WrappedMessageHandlingMember<T>` to override just the behavior you care about; it delegates everything else to the original.

### Example — enforce a metadata gate on selected handlers

This enhancer wraps only handlers carrying a custom `@RequiresApproval` attribute, and refuses to handle the message unless an approval flag is present in metadata.

```java
import org.axonframework.messaging.core.Message;
import org.axonframework.messaging.core.annotation.HandlerEnhancerDefinition;
import org.axonframework.messaging.core.annotation.MessageHandlingMember;
import org.axonframework.messaging.core.annotation.WrappedMessageHandlingMember;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;

public class ApprovalHandlerEnhancerDefinition implements HandlerEnhancerDefinition {

    @Override
    public <T> MessageHandlingMember<T> wrapHandler(MessageHandlingMember<T> original) {
        // Only wrap handlers annotated (directly or via meta-annotation) with @RequiresApproval
        return original.<String>attribute("requiredApprovalRole")
                       .map(role -> (MessageHandlingMember<T>) new ApprovalMember<>(original, role))
                       .orElse(original); // not interested -> return original unchanged
    }

    private static class ApprovalMember<T> extends WrappedMessageHandlingMember<T> {

        private final String requiredRole;

        private ApprovalMember(MessageHandlingMember<T> delegate, String requiredRole) {
            super(delegate);
            this.requiredRole = requiredRole;
        }

        @Override
        public boolean canHandle(Message message, ProcessingContext context) {
            return super.canHandle(message, context)
                    && requiredRole.equals(message.metadata().get("approvedByRole"));
        }
    }
}
```

For the `"requiredApprovalRole"` attribute to appear in `attribute(...)`, the custom annotation must be meta-annotated with `@HasHandlerAttributes`:

```java
import org.axonframework.messaging.core.annotation.HasHandlerAttributes;

import java.lang.annotation.*;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@HasHandlerAttributes
public @interface RequiresApproval {

    String requiredApprovalRole();
}
```

```java
@RequiresApproval(requiredApprovalRole = "DEAN")
@CommandHandler
void handle(WaiveTuition command, EventAppender events) { ... }
```

> To wrap *invocation* rather than eligibility, override `handle(Message, ProcessingContext, T target)` (returns a `MessageStream<?>`) instead of `canHandle`. The framework wraps handler invocation in exactly this way for cross-cutting concerns such as tracing. Filter to a message kind with `canHandleMessageType(CommandMessage.class)` when an enhancer should only touch, say, command handlers.

### Registration

`HandlerEnhancerDefinition`s are discovered via the classpath `ServiceLoader` (`ClasspathHandlerEnhancerDefinition`, combined through `MultiHandlerEnhancerDefinition`). Create:

`META-INF/services/org.axonframework.messaging.core.annotation.HandlerEnhancerDefinition`

```
com.university.config.ApprovalHandlerEnhancerDefinition
```

In a Spring application, alternatively declare it as a `@Bean` — Spring's handler-definition support combines context beans with the classpath-discovered ones:

```java
@Bean
public ApprovalHandlerEnhancerDefinition approvalHandlerEnhancerDefinition() {
    return new ApprovalHandlerEnhancerDefinition();
}
```

---

## Meta-annotations

Most Axon annotations may themselves be placed on *another* annotation. When Axon scans a handler it follows meta-annotations as well, so you can compose a team-specific annotation from a framework one and fix or expose attributes. `@CommandHandler` is declared `@Target({METHOD, ANNOTATION_TYPE})` precisely so it can be used this way.

```java
import com.fasterxml.jackson.databind.JsonNode;
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;

import java.lang.annotation.*;

@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.ANNOTATION_TYPE})
@CommandHandler(payloadType = JsonNode.class) // fixed for every use of @JsonCommandHandler
public @interface JsonCommandHandler {

    // No default -> developers MUST provide a command name
    String commandName();

    // Re-exposed from @CommandHandler so it can still be set per handler
    String routingKey() default "";
}
```

Rules:

- Attribute names on your annotation must **match exactly** the names on the meta-annotation (`commandName`, `routingKey`) to override them.
- Fixing `payloadType` on the meta-annotation forces every `@JsonCommandHandler` method to declare a payload assignable to `JsonNode`.
- Omitting a default (as on `commandName`) makes that attribute mandatory at the use site.

```java
@JsonCommandHandler(commandName = "university.AdmitApplicant")
void handle(JsonNode command, EventAppender events) { ... }
```

> When you write custom logic that reads annotation attributes, do **not** use Java's raw annotation API — it ignores meta-annotations. Use `AnnotationUtils.findAnnotationAttributes(AnnotatedElement, String)` (from `org.axonframework.common.annotation`), or `MessageHandlingMember.attribute(...)`, both of which resolve through meta-annotation layers. See [annotations.md](annotations.md) for the catalog of composable handler annotations.

---

## Choosing the right tool

| Need | Use |
|---|---|
| Inject a custom object into handler methods | `ParameterResolverFactory` |
| Accept/reject or wrap handlers based on their declaration | `HandlerEnhancerDefinition` |
| A reusable annotation with preset framework behavior | Meta-annotation |
| Cross-cutting logic around dispatch/handling | [Interceptors](interceptors.md) |
