# Derive the workflow

> Source: Axoniq `saga-to-workflow` (Apache-2.0, `AxonIQ/agent-skills`). Written for saga upgrades — "saga" below means the process you are modelling; for a new slice there is no legacy saga, so apply the rules to the slice.json steps instead.

Use the original saga inventory and tests. The target is a workflow for new process instances; existing serialized saga state stays with the draining saga runtime.

## 1. Identity and data

Choose an `idProperty` unique per process run and an explicit workflow namespace. A customer ID or reusable resource ID can incorrectly identify two separate runs as one workflow. Preserve secondary correlations as associations on the waits that need them.

Read start data from `ctx.workflowPayload()` once. In the simple context, the payload is a map; use `((Number) value).longValue()` / `.intValue()` for numeric fields and preserve nullability. Later data comes from completed event waits or durable step results. Do not read the saga store to reconstruct a new workflow instance.

## 2. Order, waits, and branching

| Saga shape | Workflow shape and invariant |
| --- | --- |
| Command causes an event handled by the next saga handler | Register the event wait, send the command inside a step, then await the event |
| Event can arrive independently from the start | Register its wait early enough to preserve the original accepted event order |
| Several flags joined by a condition | Start the corresponding waits/steps, then join them; `allMatch(isCompleted)` only establishes completion, so check each result |
| Success and failure events compete | Register both waits before dispatch, await the first terminal outcome, settle the losing wait, and define late-event behavior |
| Several parallel outcomes, first failure compensates | Fail the join as soon as one branch fails; waiting for every branch would delay compensation |
| Branch on event data | Read the durable wait result and express the branch explicitly |
| Repeated process or timer loop | Use a deterministic loop and unique step names that include the iteration |

Use `WorkflowStepResult::isCompleted` in combinator predicates. `success()`, `failure()`, `timeout()`, and `canceled()` wait for the result and can block a predicate. After an `anyMatch`, guard reads of a losing step with `isCompleted()`.

When two answers can both be ready before inspection, do not assume checking success first preserves the saga's first-arrival behavior. Specify how ties and late answers are resolved and test that ordering.

## 3. Commands, effects, and replay

Keep commands inside `execute` / `awaitExecute` steps. The bundled `Steps` helpers demonstrate three different contracts:

- `send`: dispatch and ignore the command result, matching a fire-and-forget saga send.
- `sendAndWait`: await the command result; use when the saga handled a callback or synchronous failure.
- `sendAsync`: start a result-aware command step without awaiting it immediately, for parallel work.

Pass the execute step's `ProcessingContext` to `gateway.send(command, processingContext)`. The one-argument overload supplies a null context. If the saga contract propagated explicit metadata, adapt the helper to `send(command, metadata, processingContext)` and test those values; context propagation alone does not prove that metadata contract.

A command response is not automatically equivalent to its resulting event. Retain the event wait unless the handler and its consumers prove equivalence. Replacing a publish-only terminal command with `awaitPublish` also requires checking its validation, metadata, side effects, and other callers.

Queries, service calls, clocks, and randomness belong inside durable steps when their result affects replay. Store the result as the step output. Code between steps must reproduce the same decisions from recorded results. Durable steps do not make an external side effect exactly-once: retain idempotency keys and duplicate protection for retries and crash windows.

Use stable, descriptive step names. Once workflow histories exist, changing names or order requires the framework's workflow versioning strategy; a Java refactor must not silently reinterpret running histories.

## 4. Timers and retries

| Original deadline purpose | Translation |
| --- | --- |
| Timeout for an awaited response | Timeout on that wait, with the original timeout handler's behavior |
| Deadline starts later than an already registered wait | Create a timer at the original scheduling point and race it against the wait; preserve total waiting limits separately |
| Pure delay | `ctx.awaitSleep(name, s -> s.timeout(duration))` |
| Retry after a failed command | Step retry policy with the same attempts, backoff, and failure handling |
| Reminder then escalation | Staged waits/actions, preserving whether durations are absolute or relative; 2 days then a 3-day absolute deadline leaves 1 day after the reminder |
| Repeating business timer | Deterministic loop with a fresh step name per round |
| Logging-only timer | Drop only after checking operational consumers and recording the decision |

`RetryPolicy.maxRetries(n)` means n retries after the initial attempt. Three total saga attempts become `maxRetries(2)`. Bounded retries do not silently replace an unlimited retry process.

Set intentional timeouts on waits and command steps rather than relying on a framework default. Added bounds and late-commit behavior are business decisions. A timer's placement matters as much as its duration. Do not turn two concurrently scheduled deadlines into two full sequential durations.

## 5. Compensation and termination

Keep the original compensation conditions unless the command handler proves unnecessary compensation harmless. For example, refund only a payment that succeeded if the refund handler does not guard that itself.

Put compensation in a named handler reached by the matching failure branch. A timeout-only compensation catches `StepTimedOutException` before `StepFailedException`; the broader exception includes timeouts. Preserve failure-event paths separately when they have different business meaning.

After the point of no return, later failures must not undo a completed business action. Put those steps outside the compensating scope. If compensation itself fails, report technical failure through `ctx.fail(e)` rather than letting an unhandled exception accidentally leave an execution active.

Returning from the method completes the workflow. A compensated business rejection can still be COMPLETED after publishing its required terminal event; `ctx.fail(e)` is for an unresolved technical failure. Preserve the application's distinction rather than deriving it from event names.

Use `awaitPublish` when the terminal event must be recorded before the method finishes. Verify that its consumers receive workflow-published events through their actual event source and processor configuration. Do not move all projections to the head: existing projections must preserve their position and new projections may need historical events.
