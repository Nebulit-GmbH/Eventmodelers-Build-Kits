---
name: build-automation
description: >
  Implement automation and translation slices the Cratis way — an IReactor that observes events and
  produces side effects, triggering further writes via ICommandPipeline. Use when: (1) implementing a
  new automation / reactor in a Cratis project, (2) a slice.json has a non-empty processors[] section
  or sliceType === "TRANSLATION", (3) the user provides an Event Modeling artifact or description of an
  event-driven reaction and asks to implement it, (4) the user says "implement", "create", "add" an
  automation, reactor, translation, or event-to-command flow in a Cratis Arc / Chronicle project.
---

# Cratis — Automation / Translation Slice

An automation *reacts* to events and *does things* (side effects). A translation adapts an event by
triggering a command in its own slice. Both are implemented with an **`IReactor`**.

```
event  →  IReactor method (dispatch by first param type)  →  side effect / ICommandPipeline.Execute(command)
```

> **Read first:** [../_shared/cratis-conventions.md](../_shared/cratis-conventions.md). Everything
> below assumes those rules.

## Step 0 — Discover conventions

Read `CLAUDE.md` and one existing reactor. Confirm the namespace root, how reactors are placed within a
slice, which services are available for side effects, and how existing translations call
`ICommandPipeline`. Resolve slice `comments` when done (see the state-change skill's Step 0).

## Step 1 — Understand the input (`slice.json` is the source of truth)

| Element | What to extract |
|---|---|
| **Trigger event(s)** | Which event(s) the reactor observes (the method's first parameter type) |
| **Reaction** | The side effect — notify, call a service, or trigger a command |
| **Target command** | For translation: which command to `Execute`, and how its fields map from the event |
| **Idempotency** | The reaction must be safe to run more than once (replay/recovery) |
| **Specifications** | Each scenario → an executable spec |

If a command field has no source in the trigger event or an injected service, do not invent it.

## Step 2 — Write the reactor in the slice `.cs` file

`<Module>/<Feature>/<Slice>/<Slice>.cs` — namespace `<Root>.<Module>.<Feature>.<Slice>` (mirror the folders; drop any `.Features.`).

### Automation — side effect
```csharp
public class ProjectRegisteredNotifier(INotificationService notifications) : IReactor
{
    public async Task ProjectRegistered(ProjectRegistered @event, EventContext context) =>
        await notifications.Notify($"Project '{@event.Name}' was registered.");
}
```

### Translation — event → command via ICommandPipeline
```csharp
public class StockKeeping(IStockKeeper stock, ICommandPipeline commands) : IReactor
{
    public async Task BookReserved(BookReserved @event, EventContext context) =>
        await commands.Execute(new DecreaseStock(@event.Isbn, await stock.GetStock(@event.Isbn)));
}
```

**Critical rules:**
- `IReactor` is a **marker interface** — dispatch is by the **first parameter type**. Method name is
  for readability only. Signature: `Task Method(TEvent @event, EventContext context)` (`EventContext`
  optional).
- To write new events, inject `ICommandPipeline` and `Execute` a command — **never** use `IEventLog`
  directly from a reactor.
- **Design for idempotency** — a reactor may run more than once. Use event data directly; never query
  the read model back inside a reactor. Keep the reactor stateless (constructor-injected deps only).
- One focused concern per reactor class; multiple handler methods are fine if they serve that concern.

If the translation's target command doesn't exist yet, implement it first with the
**build-state-change** skill, then reference it here.

## Step 3 — Build

`dotnet build` from the project root — zero warnings / errors.

## Step 4 — Specs

Write specs proving the reactor reacts correctly — for translations, assert the expected command was
executed (mock `ICommandPipeline` with NSubstitute and verify `Execute` was called with the mapped
command); for automations, assert the side-effect service was invoked. Cover idempotency where the
slice calls for it. One spec per scenario. Run `dotnet test --filter "FullyQualifiedName~<SliceName>"`.
See [references/patterns.md](references/patterns.md).

## Final verification — does the implementation match `slice.json`?

- [ ] The reactor observes exactly the trigger event(s) named in the slice.
- [ ] For translation: the executed command and its field mapping match the slice; the command exists.
- [ ] No new events written via `IEventLog` — only via `ICommandPipeline`.
- [ ] The reaction is idempotent; the reactor is stateless.
- [ ] Every scenario → an executable spec; `dotnet build` clean; specs pass.

## References
- [references/patterns.md](references/patterns.md) — full reactor/translation code and reactor specs.
- [../_shared/cratis-conventions.md](../_shared/cratis-conventions.md) — the Cratis conventions.
