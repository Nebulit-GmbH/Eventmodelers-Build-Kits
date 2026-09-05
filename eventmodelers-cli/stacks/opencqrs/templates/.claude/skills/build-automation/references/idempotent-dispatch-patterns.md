# Idempotent Command Dispatch — Why And How

## The delivery guarantee you're actually working with

`EventHandlingProcessor` (the machinery behind every `@EventHandling` method, automations included)
guarantees **at-least-once** delivery, never exactly-once. Quoting its own documented contract: event
handler code "is assumed to be idempotent, in order to be repeatable for a specific event, in case of
errors." A crash, restart, or fail-over between a handler's side effect succeeding and its checkpoint
advancing means the same event is redelivered and the handler runs again. An automation's whole job is
a side effect with an external consequence (dispatching a command) — it cannot opt out of this
contract, so it must be written to tolerate running twice for the same trigger.

## The mechanism that makes redelivery safe: the target command's own `SubjectCondition`

You do not need a separate idempotency table or a "have I seen this event id before" check. The target
command already has a `SubjectCondition` (see `build-state-change` Step 1), checked by `CommandRouter`
before the handler runs — reuse it:

| Target command's `SubjectCondition` | What a redelivered dispatch throws | What to do |
|---|---|---|
| `PRISTINE` (creation) | `CommandSubjectAlreadyExistsException` | Catch at the `commandRouter.send(...)` call site; do nothing — this is the expected "already handled" case |
| `EXISTS` | `CommandSubjectDoesNotExistException` | Catch the same way if a redelivery-caused re-check is expected to no-op harmlessly |
| `NONE` | nothing — no built-in check | Give the command a stable, derivable subject/business key so the *slice's own business rule* rejects a genuine duplicate instead; otherwise the automation double-executes silently |

## Why "catch it, don't just log and continue elsewhere" matters

The failure mode if you get this wrong is **not** "this one event silently fails and gets skipped" —
it's much worse. Per `EventHandlingProcessor`'s own documented error-handling table, an escaping
`CqrsFrameworkException.NonTransientException` (which `CommandSubjectAlreadyExistsException` is)
**terminates that processing group's entire loop**. Every other event this group would otherwise still
be handling — including completely unrelated ones — stops being processed until something restarts the
processor. Swallowing the exception locally, right where `commandRouter.send(...)` is called, is what
keeps the rest of the group's event stream flowing.

Do **not**:
- catch `Exception` or `Throwable` broadly around the whole handler method — that would also hide
  genuine bugs (a real mapping error, a real business-rule violation on the target command) as if they
  were harmless redeliveries
- rely on logging the exception without catching it — an exception that's logged via, e.g., a
  `@Transactional` rollback listener but still propagates out of the method still terminates the loop

Do:
- catch the *specific* exception type your target command's `SubjectCondition` implies, at the
  `commandRouter.send(...)` call site only
- let every other exception type propagate normally — those represent real problems this project's
  retry/backoff policy (`opencqrs.event-handling.groups.<name>.retry.*`) or an operator should see

## Iterating over multiple dispatches

When one trigger event fans out to several `commandRouter.send(...)` calls (one per matching entry in a
private read model), wrap **each individual call**, not the loop as a whole — one entry's already-
handled conflict must not prevent the others from being attempted:

```java
for (var entry : matchingEntries) {
    try {
        commandRouter.send(new {TargetCommand}Command(entry.id() /*, ... */));
    } catch (CommandSubjectAlreadyExistsException e) {
        // this entry was already dispatched on a prior attempt — continue with the rest
    }
}
```
