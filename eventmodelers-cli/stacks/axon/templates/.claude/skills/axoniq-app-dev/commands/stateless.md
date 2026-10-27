# Command Handling in Axon Framework 5

Command handlers process a command and produce zero or more events as a result. They are stateless by default — they do not read past events before deciding. If the handler needs to consult past state before making a decision, use the **`commands/decision-models-dcb.md` guide** instead.

---

## Writing a Command Handler

Annotate any method with `@CommandHandler`. The method's first parameter is the command payload (matched by type). Additional parameters are resolved automatically.

```java
import org.axonframework.messaging.commandhandling.annotation.CommandHandler;
import org.axonframework.messaging.eventhandling.gateway.EventAppender;

class CourseCommandHandler {

    @CommandHandler
    void handle(CreateCourse command, EventAppender events) {
        events.append(new CourseCreated(command.courseId(), command.name(), command.capacity()));
    }

    @CommandHandler
    void handle(RenameCourse command, EventAppender events) {
        events.append(new CourseRenamed(command.courseId(), command.newName()));
    }
}
```

### Resolved parameters

| Parameter type | What you get |
|---|---|
| First param (any type) | Command payload |
| `EventAppender` | Appends events to the event store and bus |
| `ProcessingContext` | The active processing context (unit of work) |
| `@MetadataValue("key") String` | A single value extracted from message metadata |
| `Metadata` | The full metadata map |
| `CommandMessage` | The raw command message |

```java
@CommandHandler
void handle(
        EnrollStudent command,
        @MetadataValue("userId") String actorId,   // from metadata
        ProcessingContext context,
        EventAppender events
) {
    events.append(new StudentEnrolled(command.studentId(), command.courseId()), 
                  Metadata.with("enrolledBy", actorId));
}
```

### Publishing events

`EventAppender` is the recommended way to publish events from within a command handler. It stages events to be appended atomically when the processing context commits.

```java
// Single event
events.append(new CourseCreated(id, name, capacity));

// Multiple events
events.append(new CourseCreated(id, name, capacity), new CourseActivated(id));

// With metadata
events.append(List.of(new CourseCreated(id, name, capacity)), Metadata.with("source", "admin"));
```

### Naming and routing

By default the command name is derived from the payload type's fully qualified class name. Override it with the `commandName` attribute on `@CommandHandler`:

```java
@CommandHandler(commandName = "faculty.CreateCourse")
void handle(CreateCourse command, EventAppender events) { ... }
```

Commands are routed to the handler whose registered name matches the command message's `QualifiedName`. Within a single command bus there can be exactly one handler per command name.

For distributed routing and for `@InjectEntity` to resolve entity IDs, annotate the command payload class with `@Command(routingKey = "fieldName")`:

```java
import org.axonframework.messaging.commandhandling.annotation.Command;

@Command(namespace = "com.university.faculty", routingKey = "courseId")
public record EnrollStudent(String courseId, String studentId) {}
```

The `routingKey` specifies which field the command bus uses to route the command to the correct node in a distributed setup, and which field `@InjectEntity` uses by default to identify the entity to load.

> **Always set `namespace` explicitly.** When omitted, the command's namespace defaults to the Java package of the class, coupling its `QualifiedName` to where the class lives — moving or renaming the package then silently changes the command name and breaks routing. Pin it to a stable, hierarchical business name in reverse-DNS-style dotted form, `<company>.<application>.<domain>[.<subdomain>]` (here `"com.university.faculty"`), independent of the Java package. See `foundations/annotations.md`.

---

## Dispatching Commands

Use `CommandGateway` to dispatch commands. Obtain it from the framework configuration — do not construct it manually in application code. In Spring Boot, inject it directly — it is auto-configured as a bean.

```java
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.axonframework.messaging.commandhandling.CommandExecutionException;

public class EnrollmentService {

    private final CommandGateway commands;

    public EnrollmentService(CommandGateway commands) {
        this.commands = commands;
    }

    // Fire-and-forget (non-blocking)
    public void createCourse(String courseId, String name, int capacity) {
        commands.send(new CreateCourse(courseId, name, capacity));
    }

    // Block until the handler completes, get a typed result
    public String enroll(String studentId, String courseId) {
        return commands.sendAndWait(new EnrollStudent(studentId, courseId), String.class);
    }

    // Dispatch with metadata
    public void createWithActor(String courseId, String name, int capacity, String actor) {
        commands.send(new CreateCourse(courseId, name, capacity),
                      Metadata.with("userId", actor));
    }
}
```

### Returning results from a handler

The return value of `@CommandHandler` becomes the command result:

```java
@CommandHandler
String handle(EnrollStudent command, EventAppender events) {
    String enrollmentId = UUID.randomUUID().toString();
    events.append(new StudentEnrolled(command.studentId(), command.courseId(), enrollmentId));
    return enrollmentId;
}

// Caller:
String enrollmentId = commands.sendAndWait(cmd, String.class);
```

---

## Registering Handlers

### Annotation-based (recommended)

Use `CommandHandlingModule` to register a class whose methods carry `@CommandHandler`:

```java
var configurer = MessagingConfigurer.create();
configurer.registerCommandHandlingModule(
    CommandHandlingModule
        .named("CourseCommands")
        .commandHandlers()
        .autodetectedCommandHandlingComponent(c -> new CourseCommandHandler())
);
```

`autodetectedCommandHandlingComponent` wraps the object in `AnnotatedCommandHandlingComponent`, which scans for `@CommandHandler` methods and registers each one.

### Programmatic (single handler)

For fine-grained control, register individual handlers directly:

```java
CommandHandlingModule
    .named("CourseCommands")
    .commandHandlers()
    .commandHandler(
        new QualifiedName("faculty.CreateCourse"),
        (command, context) -> {
            // handle
            return MessageStream.fromItems(resultMessage);
        }
    );
```

---

## Exception handling

Exceptions thrown from `@CommandHandler` methods surface to the caller wrapped in `CommandExecutionException` (`org.axonframework.messaging.commandhandling.CommandExecutionException`). The original exception is available via `getCause()`. Use `@ExceptionHandler` in the same class to intercept and translate them:

```java
class CourseCommandHandler {

    @CommandHandler
    void handle(CreateCourse command, EventAppender events) {
        if (command.capacity() <= 0) throw new InvalidCapacityException("capacity must be positive");
        events.append(new CourseCreated(command.courseId(), command.name(), command.capacity()));
    }

    @ExceptionHandler
    void on(InvalidCapacityException ex, CommandMessage command) {
        throw new CommandExecutionException("Bad command: " + ex.getMessage(), ex);
    }
}
```

---

## When this guide does not apply

If the command handler needs to **read past events** before deciding (e.g., "is this course already full?", "does this student already exist?"), use the **`commands/decision-models-dcb.md` guide**. That pattern sources the relevant decision state from the event store before appending.
