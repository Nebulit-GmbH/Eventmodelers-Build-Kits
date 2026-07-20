# Automation / Translation Patterns — Cratis Arc + Chronicle

Complete code for automation and translation slices. The reactor lives in the slice's single
`<Module>/<Feature>/<Slice>/<Slice>.cs` (the shipped starter uses `SomeModule/SomeFeature/...` — match
whatever the existing slices use). The example slices use no file header (match the project); namespace
mirrors the folders and drops any `.Features.`. Examples below use short illustrative names; mirror your
project's actual module/feature layout instead.

---

## 1. Automation — react with a side effect

```csharp
// Features/Projects/RegistrationNotifications/RegistrationNotifications.cs
namespace MyApp.Projects.RegistrationNotifications;

using Cratis.Chronicle.Events;
using Cratis.Chronicle.Reactors;

public class ProjectRegisteredNotifier(INotificationService notifications) : IReactor
{
    /// <summary>Sends a notification when a project is registered.</summary>
    public async Task ProjectRegistered(ProjectRegistered @event, EventContext context) =>
        await notifications.Notify($"Project '{@event.Name}' was registered.");
}
```

---

## 2. Translation — event → command via ICommandPipeline

```csharp
// Features/Inventory/StockKeeping/StockKeeping.cs
namespace MyApp.Inventory.StockKeeping;

using Cratis.Arc.Commands;
using Cratis.Chronicle.Events;
using Cratis.Chronicle.Reactors;

public class StockKeeping(IStockKeeper stock, ICommandPipeline commands) : IReactor
{
    /// <summary>Decreases stock when a book is reserved.</summary>
    public async Task BookReserved(BookReserved @event, EventContext context) =>
        await commands.Execute(new DecreaseStock(@event.Isbn, await stock.GetStock(@event.Isbn)));
}
```

The `DecreaseStock` command lives in its own slice (build it with the build-state-change skill first if
it doesn't exist). The reactor only triggers it.

---

## 3. Multiple handlers in one reactor (same concern)

```csharp
public class OrderFulfillment(ICommandPipeline commands) : IReactor
{
    public Task OrderPlaced(OrderPlaced @event, EventContext context) =>
        commands.Execute(new ReserveInventory(@event.OrderId, @event.Items));

    public Task PaymentCaptured(PaymentCaptured @event, EventContext context) =>
        commands.Execute(new ShipOrder(@event.OrderId));
}
```

---

## 4. Idempotency

A reactor may be invoked more than once for the same event (replay, recovery, redelivery). Use only the
event's own data, keep the reactor stateless, and make the triggered command/side effect safe to repeat
(e.g. the target command is itself idempotent, or carries a key that de-duplicates). Never read the read
model back inside the reactor to "check if already done".

---

## 5. Reactor spec (translation — assert the command was executed)

```csharp
namespace MyApp.Inventory.StockKeeping.for_StockKeeping.when_a_book_is_reserved;

public class and_stock_is_available : Specification
{
    IStockKeeper _stock;
    ICommandPipeline _commands;
    StockKeeping _reactor;

    void Establish()
    {
        _stock = Substitute.For<IStockKeeper>();
        _stock.GetStock("123").Returns(Task.FromResult(5));
        _commands = Substitute.For<ICommandPipeline>();
        _reactor = new StockKeeping(_stock, _commands);
    }

    async Task Because() => await _reactor.BookReserved(new BookReserved("123"), EventContext.Empty);

    [Fact] void should_decrease_stock() =>
        _commands.Received(1).Execute(Arg.Is<DecreaseStock>(c => c.Isbn == "123" && c.Quantity == 5));
}
```

For automations, mock the side-effect service (e.g. `INotificationService`) and assert it was called.
Match the project's existing reactor-spec harness (`IReactorInvoker` / `ReactorHandler`) for full
event-store-driven specs — discover it from an existing reactor's specs.

---

## Checklist

- One `.cs` file, namespace without `.Features.` (no file header unless the project uses one).
- `IReactor` marker; dispatch by **first parameter type**; `Task Method(TEvent, EventContext)`.
- New writes only via `ICommandPipeline.Execute(...)` — never `IEventLog` from a reactor.
- Stateless and idempotent; constructor-injected dependencies only.
- One spec per scenario; `dotnet build` clean; specs pass.
