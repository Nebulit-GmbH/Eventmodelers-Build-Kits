---
name: axoniq-app-dev
description: >
  Build apps with Axon Framework 5 (AF5) or Axoniq Framework. Use when implementing or debugging Axon components: command/event/query handlers, event-sourced entities, projections, event store, tests.
disable-model-invocation: false
user-invocable: true
allowed-tools: Read, Glob, Grep, Edit, Write
---

# Axon Framework 5 — Application Developer Guide

> **Kit note — vendored from Axoniq.** This skill is a copy of Axoniq's `axoniq-app-dev` (Apache-2.0, `AxonIQ/agent-skills`, plugin `axoniq-app-development` 0.5.1); refresh it by re-copying, not by editing it here. This kit builds against **5.4.0** while the guides target 5.2.x, and the `build-*` skills are the authority where they differ. Known difference: a no-arg entity creator must be `@ForcedEntityCreator` (not plain `@EntityCreator`, as the guides show) or `@InjectEntity` throws `EntityNotFoundException` for an id with no events.

This skill covers everything needed to build an application with Axon Framework 5 (AF5) and its optional commercial extension, Axoniq Framework. When working on a specific topic, use the Read tool to load the relevant guide file from the subdirectories listed in the routing table below.

> **Target version:** this skill targets the **Axon Framework 5.2.x** line (latest stable `5.2.0`). API names and package locations follow the 5.2 layout. Version-specific feature availability is called out inline in the guides (for example: replay/reset from 5.1; message transformation/upcasting, annotated handler interceptors, and handler timeouts from 5.2). When advising a user, confirm their version in the build file if a feature's availability is borderline.

> **Investigating an API not covered here:** the published Javadoc at **https://apidocs.axoniq.io/** is the reference for any class, method, or package this skill's guides don't document. The docs are versioned by minor line: for a version `x.y.z`, the URL contains the `x.y` segment — e.g. `https://apidocs.axoniq.io/5.2/` for the 5.2.x line. Match the segment to the user's version (check the build file). It covers both the open-source `org.axonframework` packages and the commercial `io.axoniq.framework` packages — browse by package, e.g. `https://apidocs.axoniq.io/5.2/org/axonframework/.../package-summary.html`.

---

## Framework choices

**Axon Framework 5** (`org.axonframework`, Apache 2.0) is fully open source and provides the complete core feature set: command handling, DCB decision models, event sourcing, event handling, query handling, interceptors, dead letter queue (in-memory, JDBC, JPA), Spring Boot integration, and testing utilities. It is the default choice.

**Axoniq Framework** (`io.axoniq.framework`, commercial license) is an optional extension layer that adds production infrastructure features on top of AF5:
- **PostgreSQL event store** — a production-grade `EventStorageEngine` backed by PostgreSQL with optimised DCB tag indexing and, since 5.2.0, co-located snapshot storage
- **Distributed messaging** — `DistributedCommandBus` and `DistributedQueryBus` for spreading load across multiple application instances
- **Multi-source event streaming** — `MultiStreamableEventSource` for consuming events from multiple independent event stores simultaneously
- **Message transformation** (5.2.0+) — rewrite, rename, or drop stored events on read; the AF5 successor to upcasters
- **Persistent streams** (5.2.0+) — Axon Server-managed event streams as processor sources (via `axon-server-connector`)

Axoniq Framework is free for non-production use; production deployments require a paid subscription. Users who prefer to stay on open-source only can cover all core use cases with AF5 alone — Axoniq Framework features should only be suggested when the user asks for them or their use case clearly requires them.

## Detecting which frameworks the user has

**First, verify the project is on Axon Framework 5.** The `org.axonframework` groupId is shared with Axon Framework 4, so the groupId alone does not identify the major version. Check the version of the `org.axonframework` dependencies in the build file (`pom.xml`, `build.gradle`, or `build.gradle.kts`) — the version may sit on the dependency itself, on the `axon-bom`, or in a property such as `<axon.version>`:

- **Version `5.x`**: proceed with this skill.
- **Version `4.x`**: **this skill does not apply — stop.** This skill's APIs and patterns (DCB, `EventStoreTransaction`, `@EventSourcedEntity`, `EventAppender`, `AxonTestFixture`, …) do not exist in AF4, and AF4's aggregate-centric APIs (`@Aggregate`, `AggregateLifecycle.apply()`, `FixtureConfiguration`) are not covered here. Do not answer AF4 questions from these guides. Tell the user this skill targets Axon Framework 5, and point them to the Axon Framework 4 reference guide at https://docs.axoniq.io/ for AF4 work, or to the `axoniq-migration` plugin (`axon4to5-openrewrite`, `axon4to5-migrate-code` skills) if they want to migrate to AF5.

When no build file is visible, ask which major version the user is on before giving stateful-handling advice — AF4 and AF5 answers differ fundamentally.

Then, before suggesting Axoniq Framework features, check the build file for the groupId prefixes:

| GroupId prefix | Framework | Notes |
|---|---|---|
| `org.axonframework` | Axon Framework 5 (open source) | Same groupId as Axon Framework 4 — verify version is 5.x (see above) |
| `io.axoniq.framework` | Axoniq Framework (commercial) | Only present if user explicitly added it |
| `io.axoniq` (other) | Other Axoniq commercial products | e.g. Axon Server connector, Inspector |

**If the build file contains only `org.axonframework` dependencies**: the user is on Axon Framework only. Give AF5-only advice. Do not suggest `io.axoniq.framework` modules unless the user asks.

**If the build file contains `io.axoniq.framework` dependencies**: Axoniq Framework is available. It is safe to reference its APIs (`PostgresqlEventStorageEngine`, `DistributedCommandBus`, `MultiStreamableEventSource`, etc.).

When no build file is visible and the question is ambiguous, default to AF5 open-source advice and note that Axoniq Framework provides commercial alternatives where relevant.

---

## DCB Philosophy — the primary stateful pattern

The primary model for stateful command handling in AF5 is **DCB (Dynamic Consistency Boundaries)**, not aggregates. Aggregates are a specialization of DCB, not the default.

**Core idea**: for each command, identify the minimum state needed to make the decision, source only the events relevant to that decision using tag-based criteria, then append the resulting events with a condition that detects concurrent conflicts on that same boundary.

**Why DCB over aggregates**: an aggregate loads everything ever recorded for an identity. A DCB decision model loads only the events that are relevant to the specific decision being made — nothing more. This is more precise, more performant, and avoids the overhead of identity-scoped loading when only a subset of that history is needed.

**The workflow**:
1. Tag events with `@EventTag` so they can be found later by meaningful keys (e.g., `"course"`, `"student"`)
2. Define a minimal decision state record that holds only what the command needs to decide
3. In the command handler, open an `EventStoreTransaction`, source the relevant events using `SourcingCondition` + `EventCriteria`, fold them into the decision state, apply business rules, then append the result
4. The transaction automatically enforces that no conflicting event was written concurrently — if one was, `AppendEventsTransactionRejectedException` is thrown and the command should be retried

**Key AF5 primitives**: `EventStore`/`EventStoreTransaction`, `SourcingCondition`, `AppendCondition`, `ConsistencyMarker`, `EventCriteria`/`Tag`/`@EventTag`, `AppendEventsTransactionRejectedException`

---

## Routing table

When working on a topic, read the corresponding guide file. Guides are grouped into domain folders that mirror the AF5 reference guide. Each guide contains full API reference, code examples, and patterns.

| Domain | Topic | Guide file | Framework |
|---|---|---|---|
| getting-started | Maven dependencies / project setup | `getting-started/dependencies.md` | AF5 + Axoniq Framework |
| foundations | Message anatomy, processing context, correlation | `foundations/messages-and-processing-context.md` | AF5 (open source) |
| foundations | MessageStream API (entries, factories, reduce/consume, transform) | `foundations/message-streams.md` | AF5 (open source) |
| foundations | Message annotations reference | `foundations/annotations.md` | AF5 (open source) |
| foundations | Supported handler parameters reference | `foundations/supported-parameters.md` | AF5 (open source) |
| foundations | Exception handling & handler timeouts | `foundations/exception-handling.md` | AF5 (open source) |
| foundations | Interceptors | `foundations/interceptors.md` | AF5 (open source) |
| foundations | Customizing handlers (parameter resolvers, enhancers, meta-annotations) | `foundations/handler-customization.md` | AF5 (open source) |
| foundations | Identifier generation | `foundations/identifiers.md` | AF5 (open source) |
| commands | Stateless command handling | `commands/stateless.md` | AF5 (open source) |
| commands | Stateful command handling (DCB) | `commands/decision-models-dcb.md` | AF5 (open source) |
| commands | Event-sourced entities (creator, hierarchies, polymorphism) | `commands/entities.md` | AF5 (open source) |
| commands | Dispatching commands & command bus | `commands/dispatching.md` | AF5 (open source) |
| events | Event handling and projections | `events/handling-projections.md` | AF5 (open source) |
| events | Event processors (subscribing / pooled streaming) | `events/processors.md` | AF5 (open source) |
| events | Publishing events | `events/publishing.md` | AF5 (open source) |
| events | Event versioning & upcasting / message transformation | `events/versioning-upcasting.md` | AF5 + Axoniq Framework (transformation) |
| queries | Query handling | `queries/query-handling.md` | AF5 (open source) |
| event-store | Event store API reference (sourcing / append conditions) | `event-store/primitives.md` | AF5 (open source) |
| event-store | Event store internals (EventStore / EventStorageEngine) | `event-store/internals.md` | AF5 (open source) |
| event-store | Conversion & serialization | `event-store/conversion-serialization.md` | AF5 (open source) |
| configuration | Application configuration (plain Java) | `configuration/plain-java.md` | AF5 + Axoniq Framework options |
| configuration | Spring Boot configuration | `configuration/spring-boot.md` | AF5 Spring extension |
| testing | Testing — basics | `testing/basics.md` | AF5 (open source) |
| testing | Testing — advanced (time, integration, Spring) | `testing/advanced.md` | AF5 (open source) |
| testing | Testing — matchers & field filters | `testing/matchers.md` | AF5 (open source) |
| production-infra | Distributed messaging | `production-infra/distributed-messaging.md` | Axoniq Framework (commercial) |
| production-infra | Multi-source event streaming | `production-infra/multi-source-streaming.md` | Axoniq Framework (commercial) |

**To load a guide**: use the Read tool with the path relative to this file, e.g.:

```
Read: skills/axoniq-app-dev/commands/decision-models-dcb.md
```

---

## Quick orientation

**Getting started**
- Start with **`getting-started/dependencies.md`** when setting up a new project or adding a module — it covers all Maven/Gradle coordinates and versions.

**Commands**
- Start with **`commands/stateless.md`** for any command handler that does not need to read past state.
- Start with **`commands/decision-models-dcb.md`** for any command handler that must validate against prior events. This is the more common case.
- Use **`commands/entities.md`** when modelling identity-scoped state with `@EventSourcedEntity` / `@InjectEntity`, entity hierarchies, or polymorphism (the identity-scoped specialization of DCB).
- Use **`commands/dispatching.md`** for the `CommandGateway`/`CommandBus` API, routing keys, and command results.

**Events**
- Use **`events/handling-projections.md`** when building projections, reactions, replay control, sequencing, or a dead letter queue.
- Use **`events/processors.md`** for the deep processor reference — subscribing vs pooled streaming, tracking tokens, segments, multi-node, reset.
- Use **`events/publishing.md`** when publishing events via `EventAppender` (inside handlers) or `EventGateway` (outside).
- Use **`events/versioning-upcasting.md`** when evolving event schemas — payload conversion (open source) and message transformation/upcasting (Axoniq Framework, 5.2.0+).

**Queries**
- Use **`queries/query-handling.md`** when serving read requests or pushing live updates via subscription queries.

**Foundations** (messaging internals & cross-cutting)
- Use **`foundations/messages-and-processing-context.md`** for message anatomy, `ProcessingContext`/unit-of-work lifecycle, and correlation.
- Use **`foundations/message-streams.md`** for the `MessageStream` API — the `Entry` wrapper, factory methods, `reduce`/imperative consumption, and transforms. Read it whenever you source events, write a low-level handler/interceptor, or consume a `MessageStream<?>`.
- Use **`foundations/annotations.md`** as a complete reference for any annotation's attributes (`@Command`, `@Event`, `@CommandHandler`, `@EventHandler`, `@InjectEntity`, `@EventSourcedEntity`, `@EventTag`, etc.).
- Use **`foundations/supported-parameters.md`** to see what can be injected into a handler method.
- Use **`foundations/exception-handling.md`** for `@ExceptionHandler`, execution-exception wrapping, and handler timeouts.
- Use **`foundations/interceptors.md`** when adding cross-cutting behaviour (validation, logging, retry, correlation propagation).
- Use **`foundations/handler-customization.md`** for custom `ParameterResolver`s, `HandlerEnhancerDefinition`s, and meta-annotations.
- Use **`foundations/identifiers.md`** when customizing message/identifier generation.

**Event store**
- Use **`event-store/primitives.md`** alongside the DCB guide for exact sourcing/append condition APIs.
- Use **`event-store/internals.md`** for the `EventStore`/`EventStorageEngine` layer and storage engines.
- Use **`event-store/conversion-serialization.md`** for the `Converter` layer, Jackson/Avro/CBOR, and content types.

**Configuration**
- Use **`configuration/plain-java.md`** when wiring up a plain Java application. Includes event store options (in-memory, PostgreSQL) and dead letter queue configuration.
- Use **`configuration/spring-boot.md`** for a Spring Boot application — auto-detection, `@EventSourced`, `@Namespace`, `EventProcessorDefinition`, `application.yml` processor properties, and Axon Server connection properties (`axon.axonserver.servers`/`context`/`token`).

**Testing**
- Use **`testing/basics.md`** for the `AxonTestFixture` given-when-then basics.
- Use **`testing/advanced.md`** for time control, integration tests, and Spring Boot test setup.
- Use **`testing/matchers.md`** for the matcher API and field filters.

**Production infrastructure (Axoniq Framework, commercial)**
- Use **`production-infra/distributed-messaging.md`** when distributing command or query load across multiple application nodes.
- Use **`production-infra/multi-source-streaming.md`** when consuming events from multiple independent event stores simultaneously.
