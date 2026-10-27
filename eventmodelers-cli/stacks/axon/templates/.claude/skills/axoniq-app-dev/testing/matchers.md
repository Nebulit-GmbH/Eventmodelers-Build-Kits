# Matchers and Field Filters in Axon Framework 5

The default `AxonTestFixture` assertions (`events(...)`, `commands(...)`, `resultMessagePayload(...)`) compare expected and actual messages with field-by-field equality. When that exact comparison is too strict — non-deterministic IDs, timestamps, or "match any of these in some order" scenarios — AF5 gives you two extension points: **matchers** (Hamcrest matchers for expressive list/payload assertions) and **field filters** (control which fields take part in the equality comparison).

Neither is required. Start with the plain assertions in [testing/basics.md](basics.md); reach for matchers and field filters only when a scenario needs them. For multi-fixture and integration-style setups, see [testing/advanced.md](advanced.md).

---

## Two then-phase flows

The fixture's then-phase exposes two lambda-based hooks for both events and commands:

| Method | Lambda type | Outcome decided by | Field filters applied? |
| --- | --- | --- | --- |
| `eventsSatisfy(Consumer<List<EventMessage>>)` | `Consumer` | `AssertionError` thrown inside the lambda | No |
| `eventsMatch(Predicate<List<EventMessage>>)` | `Predicate` | returned `boolean` (`false` fails) | No |
| `commandsSatisfy(Consumer<List<CommandMessage>>)` | `Consumer` | `AssertionError` thrown inside the lambda | No |
| `commandsMatch(Predicate<List<CommandMessage>>)` | `Predicate` | returned `boolean` (`false` fails) | No |

> The recorded lists are `List<EventMessage>` / `List<CommandMessage>` — full messages, not payloads. Unwrap to payloads with `messageWithPayload(...)` or `payloadsMatching(...)` (see below).

> Field filters registered on the fixture are **only** applied by the equality-based assertions (`events`, `commands`, `resultMessagePayload`). The `*Satisfy` and `*Match` flows run your lambda verbatim and ignore registered filters — do per-test filtering with `deepEquals(expected, filter)` instead.

A Hamcrest `Matcher` is not passed directly to `eventsMatch` (which wants a `Predicate`). Instead, wrap it with Hamcrest's `assertThat` inside the **then-satisfies** flow:

```java
import static org.axonframework.test.matchers.Matchers.*;
import static org.hamcrest.MatcherAssert.assertThat;

fixture.when()
       .command(new EnrollStudent("course-1", "student-A"))
       .then()
       .eventsSatisfy(events -> assertThat(events, payloadsMatching(
               listWithAllOf(
                       matches(p -> p instanceof StudentEnrolled),
                       matches(p -> p instanceof EnrolmentConfirmed)))));
```

---

## Built-in matchers

All built-in matchers are static methods on `org.axonframework.test.matchers.Matchers`, built on the Hamcrest `Matcher` interface. Most expect a nested `Matcher` to delegate to.

| Method | Description |
| --- | --- |
| `payloadsMatching(Matcher<? extends List<?>>)` | Unwraps the payloads of **all** messages and hands the list to the given matcher. |
| `messageWithPayload(Matcher<?>)` | Unwraps the payload of a **single** message and applies the given matcher. |
| `listWithAllOf(Matcher<T>...)` | List matcher — **every** given matcher must match some item, in any order. |
| `listWithAnyOf(Matcher<T>...)` | List matcher — **at least one** given matcher must match some item, in any order. |
| `sequenceOf(Matcher<T>...)` | List matcher — matchers must match **in order**, gaps of unmatched items allowed. |
| `exactSequenceOf(Matcher<T>...)` | List matcher — matchers must match **exactly in order**, no gaps. |
| `matches(Predicate<T>)` / `predicate(Predicate<T>)` | Wraps a `Predicate` as a matcher (synonyms). |
| `deepEquals(T expected)` | Field-by-field equality (uses `equals` first; falls back to reflective field comparison if `equals` is not overridden). |
| `deepEquals(T expected, FieldFilter filter)` | Same, with a `FieldFilter` controlling which fields are compared. |
| `exactClassOf(Class<T> expected)` | Matches only the exact class (not subtypes). |
| `noEvents()` / `noCommands()` | Matches an empty list of events / commands. |
| `andNoMore()` / `nothing()` | Matches "nothing" (`null`/`void`); append to an `exactSequenceOf` to assert no trailing items (synonyms). |

> `exactSequenceOf` ignores excess actual items unless you close the list with `andNoMore()`. If there are more matchers than items, the surplus matchers are evaluated against `null`.

### Exact sequence with `exactClassOf` and `andNoMore`

```java
import static org.axonframework.test.matchers.Matchers.*;
import static org.hamcrest.MatcherAssert.assertThat;

fixture.given()
       .event(new CourseCreated("course-1", "DDD", 30))
       .when()
       .command(new EnrollStudent("course-1", "student-A"))
       .then()
       .eventsSatisfy(events -> assertThat(events, exactSequenceOf(
               messageWithPayload(exactClassOf(StudentEnrolled.class)),
               messageWithPayload(exactClassOf(EnrolmentConfirmed.class)),
               andNoMore())));
```

### Order-independent "at least one of"

```java
import static org.axonframework.test.matchers.Matchers.*;
import static org.hamcrest.MatcherAssert.assertThat;

fixture.when()
       .command(new EnrollStudent("course-1", "student-A"))
       .then()
       .eventsSatisfy(events -> assertThat(events, listWithAnyOf(
               messageWithPayload(exactClassOf(StudentEnrolled.class)))));
```

### Asserting no events with the matcher

```java
import org.axonframework.test.matchers.Matchers;
import static org.hamcrest.MatcherAssert.assertThat;

fixture.when()
       .command(new EnrollStudent("unknown-course", "student-A"))
       .then()
       .eventsSatisfy(events -> assertThat(events, Matchers.noEvents()));
```

> `noEvents()` here is the *matcher* form. For the simple case the plain `.then().noEvents()` assertion from [testing/basics.md](basics.md) reads better — use the matcher only when composing it with other logic.

### `deepEquals` with a per-test filter

`deepEquals(expected, filter)` is the per-test alternative to fixture-wide field filters. It keeps the equality semantics but skips the filtered fields, with no global `Customization` change:

```java
import static org.axonframework.test.matchers.Matchers.*;
import static org.hamcrest.MatcherAssert.assertThat;

fixture.when()
       .command(new EnrollStudent("course-1", "student-A"))
       .then()
       .eventsSatisfy(events -> assertThat(events, exactSequenceOf(
               messageWithPayload(deepEquals(
                       new StudentEnrolled("course-1", "student-A"),
                       field -> !field.getName().equals("enrolledAt"))),
               andNoMore())));
```

---

## Field filters

A field filter decides, per `java.lang.reflect.Field`, whether that field participates in the equality comparison. This lets the equality-based assertions ignore non-deterministic fields such as generated identifiers or timestamps. Consider:

```java
public record StudentEnrolled(String enrolmentId, String courseId, Instant enrolledAt) {
}
```

If `enrolmentId` and `enrolledAt` are generated at runtime, a plain `.then().events(new StudentEnrolled(...))` can never produce stable expected values. Registering field filters tells the fixture to skip those fields during comparison.

How filters are applied during the then-phase:

1. The fixture recursively walks all fields of the expected and actual (nested) objects.
2. For each field, every registered filter is consulted.
3. If **any** filter returns `false`, the field is skipped.
4. Only fields accepted by **all** filters are compared.

> Alternatives worth weighing first: the per-test flexibility of `deepEquals(expected, filter)` above, or injecting a mockable service (e.g. an ID generator / clock) so the generated values become deterministic — which makes field filters unnecessary.

### The `FieldFilter` interface

```java
package org.axonframework.test.matchers;

import java.lang.reflect.Field;

@FunctionalInterface
public interface FieldFilter {
    boolean accept(Field field);   // true = include in comparison, false = ignore
}
```

### Registering field filters

Field filters are registered through the `AxonTestFixture.Customization` passed to the `with(ApplicationConfigurer, UnaryOperator<Customization>)` factory. `Customization` exposes two methods, both returning the `Customization` for fluent chaining:

| Method | Effect |
| --- | --- |
| `registerIgnoredField(Class<?> declaringClass, String fieldName)` | Ignores one named field declared on one payload type. Throws `FixtureExecutionException` if no such field is declared. |
| `registerFieldFilter(FieldFilter filter)` | Registers an arbitrary filter, applied to **every** field of every compared type. |

Ignore a single generated field on a specific event type:

```java
import org.axonframework.test.fixture.AxonTestFixture;

@BeforeEach
void setUp() {
    fixture = AxonTestFixture.with(
            configurer,
            customization -> customization
                    .registerIgnoredField(StudentEnrolled.class, "enrolmentId")
                    .registerIgnoredField(StudentEnrolled.class, "enrolledAt"));
}
```

For broader control, register a custom `FieldFilter`. This example skips every field named `enrolmentId` regardless of which message declares it:

```java
import org.axonframework.test.fixture.AxonTestFixture;

@BeforeEach
void setUp() {
    fixture = AxonTestFixture.with(
            configurer,
            customization -> customization.registerFieldFilter(
                    field -> !field.getName().equals("enrolmentId")));
}
```

### Built-in field filters

Axon ships several `FieldFilter` implementations in `org.axonframework.test.matchers` you can reuse instead of writing your own:

| Filter | Obtain via | Behaviour |
| --- | --- | --- |
| `AllFieldsFilter` | `AllFieldsFilter.instance()` | Accepts all fields (the default). |
| `NonStaticFieldsFilter` | `NonStaticFieldsFilter.instance()` | Excludes `static` fields. |
| `NonTransientFieldsFilter` | `NonTransientFieldsFilter.instance()` | Excludes `transient` fields. |
| `IgnoreField` | `new IgnoreField(Class<?>, String)` | Ignores one named field; what `registerIgnoredField` uses internally. Throws `FixtureExecutionException` for an unknown field. |
| `MatchAllFieldFilter` | `new MatchAllFieldFilter(Collection<FieldFilter>)` | Combines filters with AND — a field must be accepted by every filter. |

> Registering multiple filters on a `Customization` already AND-combines them (a field must be accepted by all). `MatchAllFieldFilter` is useful when you need a single composed filter object, e.g. to pass into `deepEquals(expected, filter)`.

---

## Common field-filter recipes

### Ignore timestamp-like fields

Skip fields whose name suggests a timestamp, or whose type is `Instant`:

```java
import org.axonframework.test.fixture.AxonTestFixture;
import java.time.Instant;

fixture = AxonTestFixture.with(configurer, customization ->
        customization.registerFieldFilter(field -> {
            String name = field.getName();
            return !(name.contains("timestamp")
                    || name.contains("createDate")
                    || name.contains("updateDate"))
                    && !field.getType().equals(Instant.class);
        }));
```

### Ignore generated identifier fields

Skip any `UUID`-typed field, or any field whose name contains `id`:

```java
import org.axonframework.test.fixture.AxonTestFixture;
import java.util.UUID;

fixture = AxonTestFixture.with(configurer, customization ->
        customization.registerFieldFilter(
                field -> !field.getType().equals(UUID.class)
                        && !field.getName().toLowerCase().contains("id")));
```

### Filter on a marker annotation

Because the filter receives a `Field`, you can ignore fields carrying a custom annotation:

```java
import java.lang.annotation.*;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
@interface IgnoreInTest { }

record StudentEnrolled(@IgnoreInTest String enrolmentId, String courseId) { }

fixture = AxonTestFixture.with(configurer, customization ->
        customization.registerFieldFilter(
                field -> !field.isAnnotationPresent(IgnoreInTest.class)));
```

### Combining filters

Filters chain fluently; all are AND-combined. Mix named-field ignores, a built-in filter, and a custom predicate in one helper:

```java
import org.axonframework.test.fixture.AxonTestFixture;
import org.axonframework.test.matchers.NonTransientFieldsFilter;

fixture = AxonTestFixture.with(configurer, MatchersTest::registerFilters);

private static AxonTestFixture.Customization registerFilters(
        AxonTestFixture.Customization customization) {
    return customization
            .registerIgnoredField(StudentEnrolled.class, "enrolmentId")
            .registerIgnoredField(CourseCreated.class, "courseId")
            .registerFieldFilter(NonTransientFieldsFilter.instance())
            .registerFieldFilter(field -> !field.getName().contains("internal"));
}
```

---

## Choosing between the options

- Plain `.then().events(...)` / `.commands(...)` — exact equality; the default and most readable. See [testing/basics.md](basics.md).
- Fixture-wide field filters — the same payload type carries a non-deterministic field across many tests; register once in `setUp`.
- `deepEquals(expected, filter)` inside `eventsSatisfy` — one-off filtering for a single assertion without changing the fixture.
- `Matchers` list/payload matchers — order-independence, "any of", exact sequences, or class-only checks that equality cannot express.
- `eventsMatch` / `commandsMatch` — a quick `Predicate<List<...>>` when a boolean is all you need (note: field filters do not apply here).
