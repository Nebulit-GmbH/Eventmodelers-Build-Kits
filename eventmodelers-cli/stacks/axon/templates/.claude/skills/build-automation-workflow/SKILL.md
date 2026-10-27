---
name: build-automation-workflow
authors:
  - Martin Dilger
description: >
  Analyze a list of automation slices and translate appropriate ones into Axon Framework 5 Workflows
  (long-running, durable, multi-step processes) instead of plain @EventHandler automations.
  Determines WHICH slices need a Workflow, then implements them using the AF5 Workflow engine.
  Use when: (1) given a set of automation slice.json definitions, decide which ones should be
  Workflows; (2) user asks to "convert automation to workflow", "implement as workflow",
  or "use Axon Workflow for this slice"; (3) a slice has multi-step logic, needs to wait for
  external input/approval, requires compensation/rollback, or spans significant time.
  Built on Axoniq Workflows (`axoniq-workflow-dsl`, Axoniq Framework 5.4.0).
---

# Build Automation Workflow (Java / Axon Framework 5)

> Workflows are an Axoniq Framework module (`io.axoniq.framework:axoniq-workflow-dsl`), not part of open-source AF5. A tested, runnable
> example lives in [assets/java/](assets/java/); the API is summarised in [references/workflow-api.md](references/workflow-api.md).

New workflow slices live under
`src/main/java/.../slices/{context}/automation/{slicename}/` — see Step 0 below for how to resolve the
`{basePackage}` this path is rooted at.

---

> **Axoniq reference:** for processors, command dispatching and exception/timeout handling around the workflow, read the matching guide from the `axoniq-app-dev` skill (`events/processors.md`, `commands/dispatching.md` and `foundations/exception-handling.md`) before guessing at an API. This skill is verified against Axon Framework 5.4.0 and wins where the two disagree.

## Step 0: Discover Project Conventions

> **Comments & description**: Each element in the slice carries a `comments: string[]` array and a `description` field. Use these as implementation hints. When done, resolve each used comment: `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get IDs first via GET on same path).

Read `.build-kit/CLAUDE.md` and check whether the project already uses AF5 Workflows. Look for:

- A `WorkflowModule` bean in any `@Configuration` class (not needed under Spring — the starter discovers `@Workflow` beans)
- Classes annotated with `@Workflow`
- Existing `*Workflow.java` files under any slice package

**Determine `{basePackage}`** — every path in this skill is rooted at
`{basePackage}.slices.{context}.automation.{slicename}`. Resolve `{basePackage}` as documented in
`.build-kit/CLAUDE.md`'s Structure section.

- The workflow dependencies in `pom.xml`. They are **not** managed by the BOM, so version them with the framework property
  (`axoniq-workflows` does not exist):

```xml
<dependency>
    <groupId>io.axoniq.framework</groupId>
    <artifactId>axoniq-workflow-dsl</artifactId>
    <version>${axoniq-framework.version}</version>
</dependency>
<dependency>
    <groupId>io.axoniq.framework</groupId>
    <artifactId>axoniq-workflow-test</artifactId>
    <version>${axoniq-framework.version}</version>
    <scope>test</scope>
</dependency>
<!-- plus org.assertj:assertj-core (test) if not already present -->
```

If they are missing from the pom, add them before implementing any workflow.

---

## Step 1: Analyze Automation Slices — Which Ones Need a Workflow?

Read every slice.json under `.build-kit/.slices/{context}/` where `processors` is not empty,
or where the user specifies a list of slices to analyze.

For each automation slice, apply this decision table:

| Signal in the slice definition | Decision |
|---|---|
| Single trigger event → single command, no waiting | **Plain automation** (`build-automation`) |
| Multi-step: trigger → command → wait for event → another command | **Workflow** |
| **Same processor name appears in 2+ slices of the same context/timeline** | **Workflow** — one instance (see below) |
| Process must wait for human approval or external confirmation | **Workflow** |
| Compensation/rollback: if step N fails, undo steps 1..N-1 | **Workflow** |
| Steps involve a timer / scheduled delay | **Workflow** |
| Fan-out: one trigger dispatches to many entities then waits for all | **Workflow** |
| Parent-child: one process spawns another and waits for its completion | **Workflow** (sub-workflow) |
| Scatter-gather: send to many, process replies as they arrive | **Workflow** |

**Same-name processors = one workflow instance.** A processor's name is its `title` in slice.json. Before classifying, group
the processors of *all* slice.json files in the context by `title` (case-insensitive). When two or more slices carry a processor
with the same name, they are not separate automations but separate functionalities (steps) of the **same process instance** — build
them as **one** workflow, never one workflow (or one `@EventHandler`) per slice:

- one `{Name}Workflow` class; each same-named processor contributes its trigger (a start or a `waitForEvent`) and its command step(s)
- all of them share one `idProperty` — find the id field the slices' events/commands have in common; if none exists, that is a
  modeling gap: pick the closest and note the assumption in a code comment
- order the steps by the slices' left-to-right position on the timeline; the earliest trigger becomes `startOnEventClass`
- every slice in the group is built by this skill together; mark each as done individually afterwards
- a lone processor with a generic default name (e.g. `automation`) is **not** a signal — names must be meaningful; if several
  unrelated processors all carry the default name, don't group them, and treat the signal as absent

For each slice, output a classification:

```
Slice: "ProcessOrderFulfillment"   → WORKFLOW  (reason: multi-step with compensation)
Slice: "SendWelcomeEmail"          → AUTOMATION (reason: single-step fire-and-forget)
Slice: "ApproveExpenseReport"      → WORKFLOW  (reason: human approval with timeout/escalation)
```

Ask the user to confirm before proceeding if any classification is ambiguous.

---

## Step 2: Ensure Events and Commands Exist

For each workflow slice, verify all trigger events and dispatched commands exist. If they don't,
create them **first** following `build-state-change` Step 4a (sealed event interface + concrete
event records).

---

## Step 3: Implement the Workflow

Start from [assets/java/OrderWorkflow.java](assets/java/OrderWorkflow.java) (+ `Steps.java`) — it is compiled and tested on 5.4.0 — and
adapt it to the slice. Read [references/workflow-patterns.md](references/workflow-patterns.md) for the rules that decide the shape
(identity, wait ordering, replay determinism, timers/retries, compensation). Everything — events, commands, fields, timeouts,
compensation — comes from slice.json; do not invent steps.

```java
// File: {slicename}/{SliceName}Workflow.java
package {basePackage}.slices.{context}.automation.{slicename};

import io.axoniq.framework.workflow.annotation.Workflow;
import io.axoniq.framework.workflow.dsl.simple.SimpleWorkflowContext;
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "slices.{context}.automation", name = "{slicename}.enabled")
public class {SliceName}Workflow {

    private final CommandGateway commands;

    public {SliceName}Workflow(CommandGateway commands) {
        this.commands = commands;
    }

    @Workflow(workflowName = "{SliceName}", workflowNamespace = "{reverse.dns.namespace}",
              idProperty = "{triggerEventIdField}", startOnEventClass = {TriggerEvent}.class)
    public void execute(SimpleWorkflowContext context) {
        var id = (String) context.workflowPayload().get("{triggerEventIdField}");
        // same-named processors from other slices: one wait/step block each, in timeline order
        // 1. register every event wait BEFORE the command that can cause it
        // 2. send commands inside durable steps (Steps.send / sendAndWait)
        // 3. await the waits; branch on timeout / failure; compensate; publish the terminal event
    }
}
```

- The workflow class is a plain Spring `@Component` gated by the slice feature flag; **no hand-written `WorkflowModule` bean** under
  Spring Boot — `axoniq-spring-boot-starter` discovers `@Workflow` methods. Confirm the workflow actually starts (see Step 6) rather
  than assuming.
- Commands go through the `CommandGateway` to the existing `build-state-change` command handlers; never mutate state in the workflow.
- Which command contract to use (`Steps.send` dispatch-only vs `sendAndWait` result-aware) is decided by the slice: if an error from the
  command must change the process, it is result-aware.
- Return from `execute` to complete; `context.fail(e)` only for an unresolved technical failure. A compensated business rejection
  still completes, after publishing its terminal event.

---

## Step 4: Common Patterns

All of these are covered, with the exact API, in [references/workflow-patterns.md](references/workflow-patterns.md): human
approval/timeout/escalation (wait with timeout, staged waits), compensation (catch `StepTimedOutException` before
`StepFailedException`), fan-out/fan-in (`execute` + join on `WorkflowStepResult::isCompleted`), delays
(`awaitSleep`), retries (`maxRetries(n)` = n retries after the first attempt).

---

## Step 5: Feature Flag Configuration

`src/main/resources/application.properties`:
```properties
slices.{context}.automation.{slicename}.enabled=true
```

`src/test/resources/application.properties`:
```properties
slices.{context}.automation.{slicename}.enabled=false
```

`META-INF/additional-spring-configuration-metadata.json` — add the property.

See [references/feature-flag-patterns.md](references/feature-flag-patterns.md) for the full pattern.

---

## Step 6: Tests

`WorkflowTestFixture` (no Spring context), exactly as in [assets/java/OrderWorkflowTest.java](assets/java/OrderWorkflowTest.java) and
[assets/java/RecordingCommandGateway.java](assets/java/RecordingCommandGateway.java). Rules and the list of branches to cover:
[references/workflow-testing.md](references/workflow-testing.md). The fixture does not run command steps by itself — release each one
explicitly with `.execute("<stepName>")`, and wait for a wait to be registered before advancing time.

The fixture does not prove Spring wiring or durability: after the build, start the app and confirm the workflow starts on its trigger
event. If you could not, say so in the report.

---

## Files to Create / Modify

```
src/main/java/.../slices/{context}/automation/{slicename}/
├── {SliceName}Workflow.java        ← @Component with the @Workflow method
└── Steps.java                      ← only if the slice needs the dispatch helpers (copy used methods from assets/java/Steps.java)

src/test/java/.../slices/{context}/automation/{slicename}/
├── {SliceName}WorkflowTest.java    ← WorkflowTestFixture tests
└── RecordingCommandGateway.java    ← test helper (from assets/java/)
```

---

## References

- [Workflow API](references/workflow-api.md) — dependencies, packages, annotation, context calls (verified on 5.4.0)
- [Workflow patterns](references/workflow-patterns.md) — rules for waits, determinism, timers, retries, compensation (Axoniq)
- [Workflow testing](references/workflow-testing.md) — fixture usage and branches to cover (Axoniq)
- [Feature Flag Patterns](references/feature-flag-patterns.md) — `@ConditionalOnProperty` and alternatives
- [Axoniq workflow documentation](https://docs.axoniq.io/axon-framework-reference/development/workflows/)
