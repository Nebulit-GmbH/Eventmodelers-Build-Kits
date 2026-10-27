# Verify behavior and durability

> Source: Axoniq `saga-to-workflow` (Apache-2.0, `AxonIQ/agent-skills`). Adapted for slices built from slice.json.

One test per GWT scenario in slice.json `specifications[]`, plus the branches below.

## Fixture tests

Use the `WorkflowTestFixture` for the selected release. The bundled Java example targets 5.4.0 APIs. It releases execute steps explicitly; the fixture does not automatically run every command step.

| Saga assertion | Workflow assertion |
| --- | --- |
| A command was dispatched | Recorded command type, payload, order, and count, not just the existence of a step |
| An event advances the saga | Publish it, release any resulting execute steps, and assert the expected waits/outcome |
| Time elapsed | First assert the expected wait exists, then advance the fixture clock |
| No active saga after rejection | Expected terminal domain event and the chosen workflow terminal status |
| Failure callback compensates | Inject command failure on a result-aware step and assert its compensation guards |

Cover happy path, each failure event, timeout-only versus general failure, duplicate and reordered events, late success after timeout, retry attempts/backoff, compensation failure, and failure after the point of no return. Include null start fields and representative serialized numeric values.

Use barriers before advancing time: a published event is processed asynchronously, and a wait must be registered before its timeout can be exercised. Keep test deadlines distinct so advancing one does not inadvertently expire an unrelated step. If a fixture cannot exercise retry exhaustion or restart faithfully, cover those with an integration test and report the limitation; do not silently skip that branch.

Fixture success does not validate Spring wiring, serialization, token transactions or the production event store; say so in your report rather than calling a fixture test proof of durability.
