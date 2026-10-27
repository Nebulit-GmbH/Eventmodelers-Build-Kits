# Command Decision Models (DCB) in Axon Framework 5

Many commands need to consult past state before deciding whether to accept or reject. The traditional answer is an aggregate. AF5 offers a more precise alternative: **scope the state to what the command actually needs to decide**.

> **Start here, not with aggregates.** An aggregate loads everything ever recorded for an identity. A decision model loads only the events that are relevant to this specific decision — nothing more.

---

## The Pattern in One Sentence

For each command, define: *(1) which past events are relevant*, *(2) what minimal state to fold them into*, and *(3) what new event(s) to emit if the decision is valid* — then let the event store enforce that no conflicting write happened concurrently.

---

## Step 1 — Tag your events

Tags are key-value pairs stored with each event. They are the lookup vocabulary for sourcing state later. Declare them by annotating fields (or methods) on your event payload with `@EventTag`:

```java
import org.axonframework.eventsourcing.annotation.EventTag;

record CourseCreated(
        @EventTag(key = "course") String courseId,   // stored as Tag("course", courseId)
        String name,
        int capacity
) {}

record StudentEnrolled(
        @EventTag(key = "course") String courseId,
        @EventTag(key = "student") String studentId
) {}
```

The tag key is what you filter by when sourcing. Choose keys that are stable and meaningful across all events in the same decision boundary.

Method-level `@EventTag` returning a `List<String>` produces one tag per element — useful when an event is relevant to multiple identities:

```java
record BidPlaced(
        @EventTag(key = "auction") UUID auctionId,
        String bidderId,
        String previousBidderId,
        BigDecimal amount
) {
    @EventTag(key = "user")
    public List<String> taggedUsers() {
        var tags = new ArrayList<String>();
        tags.add(bidderId);
        if (previousBidderId != null) tags.add(previousBidderId);
        return tags;
    }
}
```

---

## Approach A — Command-Centric Stateful Handlers (Preferred)

This is the recommended DCB approach in AF5. It is **command-centric**: the handler declares which model state it needs; the framework sources it automatically. No `EventStore` dependency in the handler.

### Step 2A — Define an `@EventSourcedEntity` model

The model is a plain class annotated with `@EventSourcedEntity`. The framework sources events matching the entity's tag criteria and applies `@EventSourcingHandler` methods before calling the command handler.

```java
import org.axonframework.eventsourcing.annotation.EventSourcedEntity;
import org.axonframework.eventsourcing.annotation.EventSourcingHandler;
import org.axonframework.eventsourcing.annotation.reflection.EntityCreator;

@EventSourcedEntity(tagKey = "course")   // sources events tagged "course=<id>"
public class CourseState {

    private int enrolled;
    private int capacity;

    @EntityCreator                        // creates the initial empty state (zero events case)
    public CourseState() {}

    @EventSourcingHandler
    private void on(CourseCreated event) {
        this.capacity = event.capacity();
    }

    @EventSourcingHandler
    private void on(StudentEnrolled event) {
        this.enrolled++;
    }

    public int enrolled()  { return enrolled; }
    public int capacity()  { return capacity; }
}
```

Key rules:
- `tagKey` must match the `@EventTag(key = ...)` used on events.
- `@EntityCreator` no-arg constructor creates the entity when no events exist (initial/empty state).
- `@EventSourcingHandler` methods receive the event payload directly — the framework dispatches to the right method by type.
- Keep only decision-relevant fields.

### Step 3A — Declare routing and inject the model in the handler

Annotate command records with `@Command(namespace = "...", routingKey = "fieldName")`. The `routingKey` specifies which field is used for distributed routing and for resolving the entity ID when the handler uses `@InjectEntity`. Always set `namespace` explicitly to a stable, hierarchical business name in reverse-DNS-style dotted form (`<company>.<application>.<domain>[.<subdomain>]`) — when omitted it defaults to the Java package, so moving the class silently changes the command's `QualifiedName` and breaks routing (see `foundations/annotations.md`).

```java
import org.axonframework.messaging.commandhandling.annotation.Command;

@Command(namespace = "com.university.faculty", routingKey = "courseId")
public record EnrollStudent(String courseId, String studentId) {}
```

In the handler, receive the sourced model via `@InjectEntity`. Use `idProperty` to specify which command field holds the entity ID:

```java
import org.axonframework.modelling.annotation.InjectEntity;

@Component                                // Spring: auto-detected
public class EnrolmentCommandHandler {

    @CommandHandler
    void handle(EnrollStudent command,
                @InjectEntity(idProperty = "courseId") CourseState course,
                EventAppender events) {

        if (course.enrolled() >= course.capacity()) {
            throw new CourseFullException(command.courseId());
        }
        events.append(new StudentEnrolled(command.courseId(), command.studentId()));
    }
}
```

The framework:
1. Reads `command.courseId()` (the `idProperty`).
2. Sources all events tagged `course=<courseId>` from the event store.
3. Applies `@EventSourcingHandler` methods to build `CourseState`.
4. Calls the `@CommandHandler` method with the pre-built state.
5. Enforces consistency: if a concurrent write matched the same criteria, `AppendEventsTransactionRejectedException` is thrown.

### Cross-boundary decisions

When a single command needs state from multiple independent boundaries, use multiple `@InjectEntity` parameters with different `idProperty` values:

```java
@Command(namespace = "com.university.auctions", routingKey = "auctionId")
public record PlaceBid(UUID auctionId, String bidderId, BigDecimal amount) {}

@Component
public class AuctionCommandHandler {

    @CommandHandler
    void handle(PlaceBid command,
                @InjectEntity(idProperty = "auctionId") AuctionState auction,
                @InjectEntity(idProperty = "bidderId") WalletState wallet,
                EventAppender events) {

        if (!auction.isOpen()) throw new IllegalArgumentException("Auction not open");
        if (command.amount().compareTo(wallet.balance()) > 0) {
            throw new IllegalArgumentException("Insufficient balance");
        }
        events.append(new BidPlaced(command.auctionId(), command.bidderId(), command.amount(), ...));
    }
}
```

Each `@EventSourcedEntity` type (`AuctionState`, `WalletState`) must be registered with the framework (see **Registration** below).

### Registration — Spring Boot

With the Spring Boot starter, `@EventSourcedEntity` classes and `@Component` command handler classes are auto-detected. No manual wiring needed.

### Registration — tests (manual)

In tests, register each entity explicitly via the component registry before registering the command handler:

```java
var configurer = MessagingConfigurer.create();

// Register event-sourced entities with the StateManager
configurer.componentRegistry(cr -> cr.registerModule(
    EventSourcedEntityModule.autodetected(String.class, CourseState.class)
));
// For a second boundary (cross-boundary command):
configurer.componentRegistry(cr -> cr.registerModule(
    EventSourcedEntityModule.autodetected(String.class, WalletState.class)
));

// Register the command handler
configurer.registerCommandHandlingModule(
    CommandHandlingModule.named("enrolment")
        .commandHandlers()
        .autodetectedCommandHandlingComponent(c -> new EnrolmentCommandHandler())
);

fixture = AxonTestFixture.with(configurer);
```

`EventSourcedEntityModule.autodetected(IdType.class, EntityType.class)` reads the `@EventSourcedEntity` annotation to configure sourcing criteria, entity factory, and ID resolver automatically.

---

## Approach B — Low-Level Handler (Alternative)

This approach gives explicit control at the cost of more boilerplate. Use it when you need fine-grained control over sourcing criteria that cannot be expressed with `tagKey` alone.

### Step 2B — Define a minimal decision state

```java
record EnrolmentState(int enrolled, int capacity, boolean studentAlreadyEnrolled) {

    static EnrolmentState empty() {
        return new EnrolmentState(0, 0, false);
    }

    EnrolmentState apply(EventMessage<?> event, String studentId) {
        // Switch on the message type name — do NOT switch on event.payload(), which returns
        // byte[] in distributed setups. The type name equals ClassName.class.getName() by default.
        // Use payloadAs(SomeClass.class) to deserialize once the type is known.
        return switch (event.type().name()) {
            case "com.example.CourseCreated" -> {
                var e = event.payloadAs(CourseCreated.class);
                yield new EnrolmentState(0, e.capacity(), false);
            }
            case "com.example.StudentEnrolled" -> {
                var e = event.payloadAs(StudentEnrolled.class);
                yield new EnrolmentState(
                        enrolled + 1,
                        capacity,
                        studentAlreadyEnrolled || e.studentId().equals(studentId));
            }
            default -> this;
        };
    }
}
```

### Step 3B — Source, decide, append

```java
import org.axonframework.eventsourcing.eventstore.EventStore;
import org.axonframework.eventsourcing.eventstore.SourcingCondition;
import org.axonframework.messaging.eventstreaming.EventCriteria;

class EnrolmentCommandHandler {

    private final EventStore eventStore;

    EnrolmentCommandHandler(EventStore eventStore) {
        this.eventStore = eventStore;
    }

    @CommandHandler
    void handle(EnrollStudent command, ProcessingContext context, EventAppender events) {
        var tx = eventStore.transaction(context);

        var criteria = EventCriteria.havingTags("course", command.courseId());

        var state = tx.source(SourcingCondition.conditionFor(criteria))
                      .reduce(EnrolmentState.empty(),
                              (s, entry) -> s.apply(entry.message(), command.studentId()))
                      .orTimeout(30, TimeUnit.SECONDS)
                      .join();

        if (state.studentAlreadyEnrolled()) {
            throw new DuplicateEnrolmentException(command.studentId(), command.courseId());
        }
        if (state.enrolled() >= state.capacity()) {
            throw new CourseFullException(command.courseId());
        }

        events.append(new StudentEnrolled(command.courseId(), command.studentId()));
    }
}
```

**What happens at commit:** The transaction records the sourcing criteria and the position reached. At commit, the event store verifies that no matching events were appended after that position by a concurrent transaction. If there was a conflict, `AppendEventsTransactionRejectedException` is thrown.

### Crossing multiple decision boundaries (low-level)

```java
@CommandHandler
void handle(TransferStudent command, ProcessingContext context, EventAppender events) {
    var tx = eventStore.transaction(context);

    var sourceCriteria = EventCriteria.havingTags("course", command.fromCourseId());
    var targetCriteria = EventCriteria.havingTags("course", command.toCourseId());

    var sourceState = tx.source(SourcingCondition.conditionFor(sourceCriteria))
                        .reduce(EnrolmentState.empty(), (s, e) -> s.apply(e.message(), command.studentId()))
                        .orTimeout(30, TimeUnit.SECONDS).join();

    var targetState = tx.source(SourcingCondition.conditionFor(targetCriteria))
                        .reduce(EnrolmentState.empty(), (s, e) -> s.apply(e.message(), command.studentId()))
                        .orTimeout(30, TimeUnit.SECONDS).join();

    if (!sourceState.studentAlreadyEnrolled()) throw new NotEnrolledException(...);
    if (targetState.enrolled() >= targetState.capacity()) throw new CourseFullException(...);

    events.append(new StudentTransferred(command.studentId(), command.fromCourseId(), command.toCourseId()));
}
```

---

## Handling conflicts

When two commands race over the same criteria, the second one to commit loses. In most setups, configure a `RetryScheduler` on the command bus to retry on `AppendEventsTransactionRejectedException` automatically rather than retrying in handler code.

```java
@CommandHandler
void handle(EnrollStudent command, ProcessingContext context, EventAppender events) {
    int attempts = 0;
    while (true) {
        try {
            tryEnrol(command, context, events);
            return;
        } catch (AppendEventsTransactionRejectedException e) {
            if (++attempts >= 3) throw e;
        }
    }
}
```

---

## When to still use an aggregate

Aggregates remain appropriate when:
- Every command targeting an entity always reads all events for that entity's identity — the boundary is completely stable.
- The entity has lifecycle behaviour (creation, deletion) that naturally scopes commands.

---

## Relationship to other guides

- **`commands/stateless.md`** — writing stateless handlers that don't read past state
- **`event-store/primitives.md`** — reference for `SourcingCondition`, `AppendCondition`, `ConsistencyMarker`, and `EventCriteria` APIs used in Approach B
- **`testing`** — how to set up the fixture for command-centric stateful handlers
