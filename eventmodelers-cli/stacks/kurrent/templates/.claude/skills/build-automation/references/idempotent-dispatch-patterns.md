# Idempotent Command Dispatch — Why And How

## The delivery guarantee you're actually working with

A KurrentDB persistent subscription guarantees **at-least-once** delivery, never exactly-once. Quoting
its own documented contract: "clients must acknowledge (or not acknowledge) messages"; an unacked or
nacked-and-retried message is redelivered, and a crash between a handler's side effect succeeding and
its `ack` reaching the server has exactly the same effect. An automation's whole job is a side effect
with an external consequence (dispatching a command) — it cannot opt out of this contract, so it must
be written to tolerate running twice for the same trigger.

## Which exception to catch depends on how the target dispatches

Unlike a framework with one uniform "subject already exists" exception regardless of which slice you're
calling, this stack's automations call directly into the target slice's own `*Handling.handle(command)`
(see `build-state-change`) — so the exception a redelivery produces is whatever **that target's own
`decide`** throws for its "already done" branch.

| How the automation dispatches | What a redelivered dispatch throws | What to catch |
|---|---|---|
| `targetHandling.handle(command)`, target's `decide` has a business rule for "already done" (state != null, or a specific flag) | Whatever that `decide` throws — often `IllegalStateException`, sometimes a dedicated exception class | That exact exception type — read the target's `decide` implementation (or its own `specifications[]`) to find out, don't guess |
| Raw `eventStore.append(streamId, StreamState.noStream(), events)` with no target `*Handling` at all (a bare fact stream) | `WrongExpectedVersionException` (KurrentDB's own optimistic-concurrency exception) | `io.kurrent.dbclient.WrongExpectedVersionException` |

**Never guess the exception type for the first row.** A too-broad catch (`catch (Exception e)`) around
the whole dispatch would also silently swallow a genuine mapping bug or a real validation failure as if
it were a harmless redelivery. A too-narrow catch (the wrong exception class) lets a genuine redelivery
conflict propagate uncaught, which is exactly the failure mode described next.

## Why "catch it, don't just log and continue elsewhere" matters

If the idempotency exception is allowed to escape the persistent-subscription listener's `onEvent`
method entirely (not just fall through to the outer `catch (Exception ex)` safety net), it gets nacked
as `Park` by that outer catch — the message is parked (put on the poison queue), not acknowledged. A
parked message stops making progress; it does not silently retry forever, but it does sit there
unresolved until someone manually replays it (`replayParkedMessagesToStream`/`ToAll`), which is not what
you want for an entirely expected, harmless redelivery.

Do **not**:
- catch `Exception`/`Throwable` broadly around the whole `react`/`onSetupEvent` method — that would
  also hide genuine bugs (a real mapping error, a real, unexpected validation failure) as if they were
  harmless redeliveries
- rely on the outer `catch (Exception ex)` in `onEvent` to mask redelivery — it parks the message
  instead of acking it, which is the opposite of "safe to ignore"

Do:
- catch the *specific* exception type the target's own idempotency check produces, at the
  `targetHandling.handle(...)` (or `eventStore.append(...)`) call site only
- let every other exception type propagate normally into `onEvent`'s outer catch, which parks it for
  operator attention — that's the correct outcome for a real failure

## Iterating over multiple dispatches

When one trigger event fans out to several dispatches (one per matching entry in a private read model),
wrap **each individual call**, not the loop as a whole — one entry's already-handled conflict must not
prevent the others from being attempted:

```java
for (var entry : matchingEntries) {
    try {
        targetHandling.handle(new {TargetCommand}Command(entry.id() /*, ... */));
    } catch ({TargetAlreadyDoneException} e) {
        // this entry was already dispatched on a prior attempt — continue with the rest
    }
}
```
