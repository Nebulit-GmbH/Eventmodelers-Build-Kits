# Axoniq Workflow API (verified against Axoniq Framework 5.4.0)

Source: Axoniq's `saga-to-workflow` skill and the 5.4.0 artifacts. Official docs:
https://docs.axoniq.io/axon-framework-reference/development/workflows/. The runnable example in
[`../assets/java/`](../assets/java/) compiles and passes its fixture tests on 5.4.0 — copy from it, do not retype the API.

## Dependencies

`axoniq-workflow-dsl` (+ `axoniq-workflow-test`, test scope) are **not** managed by the BOM — version them with
`${axoniq-framework.version}`. Spring Boot wiring comes from `axoniq-spring-boot-starter`
(`WorkflowAutoConfiguration` / `WorkflowDefinitionLookup` discover `@Workflow` beans); there is no separate workflow starter and no
`axoniq-workflows` artifact. Fixture tests also need AssertJ.

## Packages

| Type | Package |
|---|---|
| `@Workflow` | `io.axoniq.framework.workflow.annotation` |
| `SimpleWorkflowContext` | `io.axoniq.framework.workflow.dsl.simple` |
| step results/definitions/exceptions/status (`WorkflowStepResult`, `ExecuteStepDefinition`, `StepFailedException`, `StepTimedOutException`, `WorkflowStatus`) | `io.axoniq.framework.workflow.dsl.api` |
| `WorkflowModule` | `io.axoniq.framework.workflow.configuration` |
| `WorkflowTestFixture` | `io.axoniq.framework.workflow.runtime.test.fixture` |

## `@Workflow`

```java
@Workflow(workflowName = "OrderPayment", workflowNamespace = "{reverse.dns.namespace}",
          idProperty = "orderId", startOnEventClass = OrderPlaced.class)
public void execute(SimpleWorkflowContext context) { ... }
```

`idProperty` must be unique per process *run* (a reusable id such as a customer id makes separate runs collide). Start data comes
from `context.workflowPayload()` — a `Map`; numbers deserialize as `Number`, so use `((Number) v).longValue()`.

## Context calls used by the example

| Call | Meaning |
|---|---|
| `waitForEvent(name, EventType.class, associations, step -> step.timeout(d))` | Register a wait; returns a `WorkflowStepResult`. Register it **before** the command that causes the event. |
| `awaitExecute(name, Map.of(), (processingContext, input) -> {...}, step -> step.timeout(d))` | Run a durable step and block until it finishes |
| `execute(...)` | Same, without blocking (parallel work) |
| `awaitPublish(name, event)` / `publish(...)` | Record a domain event from the workflow |
| `awaitSleep(name, s -> s.timeout(d))` | Durable delay |
| `fail(exception)` | Unresolved technical failure → status FAILED. A compensated business rejection simply returns → COMPLETED |

Result checks: use `WorkflowStepResult::isCompleted` in combinators; `success()`/`failure()`/`timeout()` block until the result exists.
Pass the step's `ProcessingContext` to `gateway.send(command, processingContext)` — the one-arg overload sends a null context.
`RetryPolicy.maxRetries(n)` = n retries *after* the first attempt.

`Steps.java` in the assets holds the three command-dispatch contracts (`send` fire-and-forget, `sendAndWait`, `sendAsync`) — copy only
the ones used.
