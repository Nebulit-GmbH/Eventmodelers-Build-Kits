# Event-Sourced Entities in Axon Framework 5

An *entity* is a stateful command-side component that rebuilds its state from prior events and uses that state to enforce business rules when handling new commands. Entities are the **identity-scoped specialization** of the DCB decision-model pattern described in `commands/decision-models-dcb.md`: instead of building an arbitrary decision model from a hand-written `EventCriteria`, an entity is keyed by a single identifier and Axon sources its event stream automatically from that key. If a handler needs no prior state at all, use a plain stateless handler (`commands/stateless.md`) instead.

This guide covers `@EventSourcedEntity`, the `@EntityCreator`, evolving state with `@EventSourcingHandler`, injecting entities into command handlers with `@InjectEntity`, entity hierarchies, and polymorphism. For the underlying tag/criteria machinery, see `event-store/primitives.md`; for annotation references, see `foundations/annotations.md`.

---

## When to use an entity

Use an entity when a command must be validated against state established by earlier commands:

- "A course cannot accept more students than its capacity" — needs the enrolled count.
- "A student cannot subscribe to more than three courses" — needs the subscription count.
- "An order can only be cancelled if it has not shipped" — needs the order status.

Do **not** use an entity when the command can be validated without reading prior state (sending a notification, creating a resource with a client-supplied identifier). Those are stateless handlers — see `commands/stateless.md`. If you are adding an entity only to hold a flag that is set once and never changes, that is a signal the command may not need an entity.

> Entities vs. DCB decision models: an entity is loaded by *identity* (one tag key, one id). A DCB decision model (`commands/decision-models-dcb.md`) is loaded by an arbitrary `EventCriteria` that can span multiple tags and event types. Entities are the convenient, identity-scoped case; reach for a raw decision model when the state you need crosses entity boundaries.

---

## Entity identification

Every command that targets an existing entity instance must identify which instance to load. Mark the identifier field on the command with `@TargetEntityId`:

```java
import org.axonframework.modelling.annotation.TargetEntityId;

public record RenameCourse(@TargetEntityId String courseId, String name) {}
```

Axon reads this field to load the correct entity before invoking the handler. It is **not** required on creational commands — no entity exists yet at that point.

Axon also needs to know which events belong to an entity's stream. Mark the identifier field on each event with `@EventTag`, and set `tagKey` on the entity annotation to the same key:

```java
import org.axonframework.eventsourcing.annotation.EventTag;

public record CourseCreated(@EventTag String courseId, String title, int capacity) {}
```

```java
import org.axonframework.eventsourcing.annotation.EventSourcedEntity;

@EventSourcedEntity(tagKey = "courseId")
public class Course { /* ... */ }
```

> `@Command(routingKey = "...")` is a separate concern: it sets the routing key a distributed command bus uses to route the command to the correct node. It does not affect which entity instance is loaded. See `commands/stateless.md` for routing.

---

## The four kinds of entity member

An event-sourced entity is built from four member types:

| Member | Form | Responsibility |
|---|---|---|
| Creational command handler | `static` method | Validate the creation command, append the creation event. No entity exists yet. |
| Instance command handler | instance method | Validate a command against current state, append events. |
| Event sourcing handler | instance method, `@EventSourcingHandler` | Apply an event to update state fields. **No business logic.** |
| Entity creator | constructor or static factory, `@EntityCreator` | Construct the initial instance before events are replayed. |

```java
import org.axonframework.eventsourcing.annotation.EventSourcedEntity;
import org.axonframework.eventsourcing.annotation.EventSourcingHandler;
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;

@EventSourcedEntity(tagKey = "courseId")
public class Course {

    private String courseId;
    private String title;
    private int capacity;
    private int enrolledCount;

    @CommandHandler // creational: static, no entity yet
    public static String handle(CreateCourse cmd, EventAppender appender) {
        if (cmd.capacity() <= 0) {
            throw new IllegalArgumentException("Capacity must be positive");
        }
        appender.append(new CourseCreated(cmd.courseId(), cmd.title(), cmd.capacity()));
        return cmd.courseId();
    }

    @CommandHandler // instance: validates against current state
    public void handle(EnrollStudent cmd, EventAppender appender) {
        if (enrolledCount >= capacity) {
            throw new IllegalStateException("Course is full");
        }
        appender.append(new StudentEnrolled(courseId, cmd.studentId()));
    }

    @EventSourcingHandler // applies state, never business logic
    void on(CourseCreated event) {
        this.courseId = event.courseId();
        this.title = event.title();
        this.capacity = event.capacity();
    }

    @EventSourcingHandler
    void on(StudentEnrolled event) {
        this.enrolledCount++;
    }

    @EntityCreator
    protected Course() {}
}
```

> **Strict separation.** Command handlers validate and append events; they must never write to state fields. Event sourcing handlers update state and must contain no business logic. This matters because event sourcing handlers also run during replay when the entity is loaded — any business logic there would execute unexpectedly on every load.

> An entity only needs the state required to decide on incoming commands. Add an `@EventSourcingHandler` only when the resulting state change is relevant for validating a future command.

---

## The entity creator

Every event-sourced entity needs a creator: the constructor or static factory Axon calls before replaying events. There are three forms, selected by what the creator accepts.

| Form | Annotation pattern | Suited for |
|---|---|---|
| No-argument | `@EntityCreator Course() {}` | Mutable entities; state filled by `@EventSourcingHandler`. |
| Identifier-based | `@EntityCreator Course(@InjectEntityId String id)` | Identifier known at creation, declared `final`. |
| First-event-based | `@EntityCreator Course(CourseCreated event)` | Fully immutable entities, constructed from the creation event. |

### No-argument creator

```java
@EntityCreator
protected Course() {}
```

### Identifier-based creator

Use `@InjectEntityId` to mark the identifier parameter so the `final` id is set once at construction:

```java
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;
import org.axonframework.eventsourcing.annotation.reflection.InjectEntityId;

private final String courseId;

@EntityCreator
protected Course(@InjectEntityId String courseId) {
    this.courseId = courseId;
}
```

> `@InjectEntityId` is required to disambiguate the identifier from an event payload. Without it, a single-parameter constructor is treated as the first-event-based form.

### First-event-based creator

```java
@EntityCreator
public Course(CourseCreated event) {
    this.courseId = event.courseId();
    this.capacity = event.capacity();
}
```

When using this form, command handlers must be split into creational (append the creation event before the entity exists) and instance handlers (operate on the already-created entity).

The `@EntityCreator` annotation lives in `org.axonframework.eventsourcing.annotation.reflection`.

---

## Configuring an entity

Three styles are available. The annotations on the entity differ; the registration call differs.

| Style | Entity annotation | Registration |
|---|---|---|
| Autodetected (plain Java) | `@EventSourcedEntity(tagKey = ...)` | `EventSourcedEntityModule.autodetected(IdType.class, Entity.class)` |
| Spring Boot | `@EventSourced(tagKey = ..., idType = ...)` | Auto-configuration — no explicit registration |
| Declarative | none | `EventSourcedEntityModule.declarative(...)` with explicit handlers |

### Autodetected (plain Java)

Annotate the entity, then register it with `EventSourcedEntityModule.autodetected()`. The first argument is the identifier type, the second is the entity class. The flow reads `@CommandHandler`, `@EventSourcingHandler`, and `@EntityCreator` from the class.

```java
import org.axonframework.eventsourcing.configuration.EventSourcedEntityModule;
import org.axonframework.eventsourcing.configuration.EventSourcingConfigurer;

public class CourseConfiguration {

    public static EventSourcingConfigurer configure(EventSourcingConfigurer configurer) {
        return configurer.registerEntity(
                EventSourcedEntityModule.autodetected(String.class, Course.class)
        );
    }
}
```

See `configuration/plain-java.md` for how the `EventSourcingConfigurer` is constructed in `main()` and threaded through.

### Spring Boot

Annotate the entity with `@EventSourced` (from `org.axonframework.extension.spring.stereotype`) instead of `@EventSourcedEntity`. Auto-configuration detects and registers it; no configuration class is needed. `@EventSourced` adds an `idType` attribute (defaults to `String.class`):

```java
import org.axonframework.extension.spring.stereotype.EventSourced;

@EventSourced(tagKey = "courseId", idType = CourseId.class)
public class Course { /* same members as autodetected */ }
```

See `configuration/spring-boot.md` for the auto-configuration details.

### Declarative

The declarative approach wires existing methods into Axon without annotating the entity class. Use it when you cannot (or prefer not to) put framework annotations on your domain model.

```java
import org.axonframework.eventsourcing.EventSourcedEntityFactory;
import org.axonframework.eventsourcing.configuration.EventSourcedEntityModule;
import org.axonframework.eventsourcing.configuration.EventSourcingConfigurer;
import org.axonframework.messaging.core.MessageStream;
import org.axonframework.messaging.core.MessageTypeResolver;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;
import org.axonframework.messaging.eventstreaming.EventCriteria;
import org.axonframework.messaging.eventstreaming.Tag;
import org.axonframework.modelling.annotation.AnnotationBasedEntityIdResolver;

public static EventSourcingConfigurer configure(EventSourcingConfigurer configurer) {
    return configurer.registerEntity(
        EventSourcedEntityModule.declarative(String.class, Course.class)
            .messagingModel((config, model) -> {
                MessageTypeResolver resolver = config.getComponent(MessageTypeResolver.class); // <1>
                return model
                    .creationalCommandHandler(
                        resolver.resolveOrThrow(CreateCourse.class).qualifiedName(),
                        (command, context) -> {
                            Course.handle(command.payloadAs(CreateCourse.class),
                                          EventAppender.forContext(context));
                            return MessageStream.empty().cast();
                        })
                    .instanceCommandHandler(
                        resolver.resolveOrThrow(EnrollStudent.class).qualifiedName(),
                        (command, entity, context) -> { // entity passed as 2nd arg
                            entity.handle(command.payloadAs(EnrollStudent.class),
                                          EventAppender.forContext(context));
                            return MessageStream.empty().cast();
                        })
                    .entityEvolver((entity, event, context) -> { // <2>
                        var created = resolver.resolveOrThrow(CourseCreated.class).qualifiedName();
                        if (event.type().qualifiedName().equals(created)) {
                            entity.on(event.payloadAs(CourseCreated.class));
                        }
                        return entity;
                    })
                    .build();
            })
            .entityFactory(c -> EventSourcedEntityFactory.fromNoArgument(Course::new)) // <3>
            .criteriaResolver(c -> (id, ctx) -> EventCriteria.havingTags(Tag.of("courseId", id))) // <4>
            .entityIdResolver(c -> new AnnotationBasedEntityIdResolver<>()) // <5>
            .build()
    );
}
```

1. Resolve qualified names via `MessageTypeResolver`, not by constructing `QualifiedName` directly. This respects custom names defined on `@Command`/`@Event` annotations.
2. The entity evolver delegates to the entity's own `on` methods and returns the (same or new) instance.
3. `EventSourcedEntityFactory.fromNoArgument` wraps the no-arg constructor. Use `fromIdentifier(Function)` when the constructor needs the id, or `fromEventMessage(BiFunction)` for immutable entities built from the first event.
4. The criteria resolver tells Axon which events belong to this entity's stream, using tag-based filtering — see `event-store/primitives.md`.
5. `AnnotationBasedEntityIdResolver` reads the `@TargetEntityId` field from each command to determine which instance to load.

---

## Stateful command handlers (handlers outside the entity)

Command handlers can live **on** the entity (as above) or in a **separate class** that receives the loaded entity via `@InjectEntity`. The separate-class form keeps the entity as a pure state container and organizes code by use case — the natural fit for Vertical Slice Architecture.

The entity holds only state fields, an `@EntityCreator`, and `@EventSourcingHandler` methods:

```java
@EventSourcedEntity(tagKey = "courseId")
public class Course {

    private String courseId;
    private String name;
    private int capacity;

    @EntityCreator
    public Course() {}

    @EventSourcingHandler
    void on(CourseCreated event) {
        this.courseId = event.courseId();
        this.name = event.name();
        this.capacity = event.capacity();
    }

    String courseId() { return courseId; }
    String name() { return name; }
    int capacity() { return capacity; }
}
```

The handler is a plain class; it receives the `Course` as a parameter whenever prior state is needed:

```java
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;
import org.axonframework.modelling.annotation.InjectEntity;

public class RenameCourseHandler {

    @CommandHandler
    void handle(RenameCourse command,
                @InjectEntity Course course, // loads Course before invoking
                EventAppender events) {
        if (course.courseId() == null) {
            throw new IllegalStateException("Course does not exist");
        }
        if (!command.name().equals(course.name())) { // idempotent: no-op if unchanged
            events.append(new CourseRenamed(command.courseId(), command.name()));
        }
    }
}
```

Creational handlers do **not** take an entity parameter — the entity does not exist yet:

```java
@CommandHandler
String handle(CreateCourse command, EventAppender events) {
    if (command.capacity() <= 0) throw new IllegalArgumentException("Capacity must be positive");
    events.append(new CourseCreated(command.courseId(), command.name(), command.capacity()));
    return command.courseId();
}
```

Register the handler class as a command-handling component and the entity separately (plain Java):

```java
configurer
    .registerEntity(EventSourcedEntityModule.autodetected(String.class, Course.class))
    .registerCommandHandlingModule(
        CommandHandlingModule.named("RenameCourse")
            .commandHandlers()
            .autodetectedCommandHandlingComponent(c -> new RenameCourseHandler()));
```

### Resolving the entity identifier

`@InjectEntity` needs an id to look up the entity. It offers two attributes:

| Attribute | Use |
|---|---|
| `idProperty` | Name a field on the command payload directly: `@InjectEntity(idProperty = "courseId")`. Needed when injecting multiple entities, or when the field is not marked `@TargetEntityId`. |
| `idResolver` | Supply a class implementing `EntityIdResolver` for custom extraction (e.g. id computed from several fields). |

Without either attribute, Axon falls back to `AnnotationBasedEntityIdResolver`, which reads the `@TargetEntityId` field on the command.

### Injecting multiple entities

A single handler can receive more than one entity. Use `idProperty` to bind each parameter to a command field:

```java
@CommandHandler
void handle(
        SubscribeStudentToCourse command,
        @InjectEntity(idProperty = "courseId") Course course,
        @InjectEntity(idProperty = "studentId") Student student,
        EventAppender events) {
    if (course.courseId() == null) throw new IllegalStateException("Course does not exist");
    if (student.studentId() == null) throw new IllegalStateException("Student not enrolled");
    if (course.studentsSubscribed().size() >= course.capacity()) {
        throw new IllegalStateException("Course is fully booked");
    }
    events.append(new StudentSubscribedToCourse(command.courseId(), command.studentId()));
}
```

Here the command has no single `@TargetEntityId` because the handler works across two entities:

```java
public record SubscribeStudentToCourse(String studentId, String courseId) {}
```

---

## Entity hierarchies (parent owning children)

An entity hierarchy is a parent entity that owns one or more child entities. Commands and events route directly to the appropriate child. Use this when a parent owns a bounded set of sub-elements, each with its own identity and handling logic, whose lifecycle is tied to the parent.

> Child entities share the same consistency boundary as their parent: a command targeting a child loads the entire parent hierarchy first. For large or independently managed collections, a separate entity with its own lifecycle is a better fit.

### Autodetected

Declare the child collection with `@EntityMember` on the parent. Children are created in the parent's `@EventSourcingHandler`, never in a command handler.

```java
import java.util.ArrayList;
import java.util.List;

import org.axonframework.eventsourcing.annotation.EventSourcedEntity;
import org.axonframework.eventsourcing.annotation.EventSourcingHandler;
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;
import org.axonframework.modelling.entity.annotation.EntityMember;

@EventSourcedEntity(tagKey = "courseId")
public class Course {

    private String courseId;
    private int capacity;

    @EntityMember(routingKey = "studentId") // <1>
    private final List<Enrollment> enrollments = new ArrayList<>();

    @CommandHandler
    public static String handle(CreateCourse cmd, EventAppender appender) {
        appender.append(new CourseCreated(cmd.courseId(), cmd.title(), cmd.capacity()));
        return cmd.courseId();
    }

    @CommandHandler
    public void handle(EnrollStudent cmd, EventAppender appender) {
        if (enrollments.size() >= capacity) throw new IllegalStateException("Course is full");
        appender.append(new StudentEnrolled(courseId, cmd.studentId()));
    }

    @EventSourcingHandler
    private void on(CourseCreated event) {
        this.courseId = event.courseId();
        this.capacity = event.capacity();
    }

    @EventSourcingHandler
    private void on(StudentEnrolled event) {
        enrollments.add(new Enrollment(event.studentId())); // <2>
    }

    @EntityCreator
    protected Course() {}
}
```

1. `@EntityMember` declares `enrollments` as a child collection. `routingKey = "studentId"` is required when the parent holds multiple children of the same type — it matches a command/event field against the child's identifying value. Omit it for a single child field.
2. Children are created in the parent's event sourcing handler.

The child entity (`Enrollment`) declares its own state, command handlers, and event sourcing handlers, and exposes the value matched against the routing key.

> Only `List` fields are supported for collections of child entities in the annotated approach. A `Map` field will not route. Use a `List` and manage key lookup inside the entity.

### Command and event routing

Commands targeting a child still need `@TargetEntityId` to load the parent, plus a field matching the parent's `routingKey` so Axon picks the right child:

```java
public record DropEnrollment(
        @TargetEntityId String courseId, // loads the parent Course
        String studentId,                // matches routingKey "studentId" -> the child
        String reason) {}
```

By default (`RoutingKeyEventTargetMatcherDefinition`), each event is delivered only to the child whose routing key matches the event payload, not broadcast to every child.

> Each command must have exactly one handler in the entire hierarchy. If both parent and child declare a handler for the same command, Axon throws `DuplicateCommandHandlerSubscriptionException` during configuration. If no matching child is found at command time, Axon throws `ChildEntityNotFoundException` — usually the child was not created yet; ensure the parent's `@EventSourcingHandler` creates it first.

### Advanced routing

Override the defaults via attributes on `@EntityMember`:

- `eventTargetMatcher` — supply an `EventTargetMatcherDefinition` to control which child(ren) an event is delivered to. The framework ships `RoutingKeyEventTargetMatcherDefinition` (the default, used when `routingKey` is set); for anything else — e.g. delivering an event to every child — implement your own `EventTargetMatcherDefinition`.
- `commandTargetResolver` — supply a `CommandTargetResolverDefinition` for custom child selection.

```java
@EntityMember(
    routingKey = "studentId",
    eventTargetMatcher = MyBroadcastMatcherDefinition.class)  // your EventTargetMatcherDefinition
private final List<Enrollment> enrollments = new ArrayList<>();
```

For the declarative form, attach children to the parent metamodel with `EntityChildMetamodel.list(...)` (or `.single(...)`) and `addChild(...)`, supplying `ChildEntityFieldDefinition.forGetterEvolver(getter, evolver)`, a `commandTargetResolver`, and an `eventTargetMatcher`. These live in `org.axonframework.modelling.entity.child`.

---

## Polymorphic entities

A polymorphic entity lets multiple concrete types share a common abstract parent, each with their own handlers. The concrete type is fixed at creation time and never changes.

> If the variants differ only by a flag or enum value, a single entity with conditional logic is simpler. Use polymorphism when variants have structurally different commands, state, or behavior.

### Autodetected

List the concrete subtypes via `concreteTypes` on the abstract parent. Axon scans all listed subtypes for handlers; subtypes need no annotation of their own. An `@EntityCreator` static factory picks the concrete type from the creation event:

```java
import org.axonframework.eventsourcing.annotation.EventSourcedEntity;
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;

@EventSourcedEntity(tagKey = "courseId", concreteTypes = {OnlineCourse.class, InPersonCourse.class})
public abstract class Course {

    protected String courseId;
    protected String title;
    protected int capacity;
    // command handlers, event sourcing handlers — see members section

    @EntityCreator
    public static Course create(CourseCreated event) {
        return switch (event.courseType()) {
            case ONLINE    -> new OnlineCourse(event);
            case IN_PERSON -> new InPersonCourse(event);
        };
    }
}
```

Subtypes extend the parent and add their own fields and handlers:

```java
public class OnlineCourse extends Course {
    protected String platformUrl;
    public OnlineCourse(CourseCreated event) {
        this.courseId = event.courseId();
        this.title = event.title();
        this.capacity = event.capacity();
        this.platformUrl = event.platformUrl();
    }
}
```

Register the **abstract parent** — Axon discovers the subtypes from `concreteTypes`:

```java
configurer.registerEntity(EventSourcedEntityModule.autodetected(String.class, Course.class));
```

> If the parent is a sealed class or interface, `concreteTypes` is optional: Axon collects all concrete leaf types by traversing the sealed hierarchy.

### Spring Boot

Annotate the abstract parent with `@EventSourced(concreteTypes = {...})`. Do **not** annotate the subtypes — they are already discovered, and since `@EventSourced` is a Spring `@Component`, annotating them would create unnecessary beans.

### Declarative

No annotations. Provide an `EventSourcedEntityFactory.fromEventMessage(...)` that inspects the first event and instantiates the correct concrete type; subtype-specific instance command handlers cast the entity parameter to the concrete type.

### Constraints

- For non-sealed parents, subtypes missing from `concreteTypes` are silently ignored — their handlers are never registered and commands targeting them fail at runtime.
- Each command may have at most one handler anywhere in the hierarchy, or Axon throws `DuplicateCommandHandlerSubscriptionException` at startup (applies to instance and creational handlers).
- `@EventSourcingHandler` methods may be declared on both parent and subtype; the parent's runs first, then the subtype's.
- Parent fields accessed by subtype constructors must be at least `protected`.
- The concrete type is fixed at creation; an entity cannot change type at runtime.

---

## Testing

The `AxonTestFixture` guards against unintentional state changes in command handlers and is strongly recommended for stateful entity testing — given prior events, when a command, then expect events or an exception. See the testing guide for the given/when/then API.

## Related guides

- `commands/stateless.md` — handlers that need no prior state.
- `commands/decision-models-dcb.md` — the general decision-model pattern; entities are its identity-scoped specialization.
- `event-store/primitives.md` — `EventCriteria`, `Tag`, `@EventTag`, and tag-based stream filtering.
- `foundations/annotations.md` — annotation reference.
- `configuration/plain-java.md` / `configuration/spring-boot.md` — wiring entities into the application.
