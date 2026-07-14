# Write Slice Patterns — Cratis Arc + Chronicle

Complete code for state-change (write) slices. All artifacts go in a single
`<Module>/<Feature>/<Slice>/<Slice>.cs` file (the shipped starter uses `SomeModule/SomeFeature/...` —
match whatever the existing slices use). The example slices use no file header (match the project).
Namespace mirrors the folders and drops any `.Features.`. The examples below use short illustrative
names (`MyApp.Authors.Registration`); mirror your project's actual module/feature layout instead.

---

## 1. Concept (one per file, in the feature folder)

```csharp
// Features/Authors/AuthorId.cs
namespace MyApp.Authors;

public record AuthorId(Guid Value) : ConceptAs<Guid>(Value)
{
    public static readonly AuthorId NotSet = new(Guid.Empty);
    public static implicit operator Guid(AuthorId id) => id.Value;
    public static implicit operator AuthorId(Guid value) => new(value);
    public static implicit operator EventSourceId(AuthorId id) => new(id.Value.ToString());
    public static AuthorId New() => new(Guid.NewGuid());
}

// Features/Authors/AuthorName.cs
public record AuthorName(string Value) : ConceptAs<string>(Value)
{
    public static readonly AuthorName NotSet = new(string.Empty);
    public static implicit operator string(AuthorName name) => name.Value;
    public static implicit operator AuthorName(string value) => new(value);
}
```

---

## 2. Simplest write slice — single event

```csharp
// Features/Authors/Registration/Registration.cs
namespace MyApp.Authors.Registration;

using Cratis.Arc.Commands.ModelBound;
using Cratis.Chronicle.Events;

[Command]
public record RegisterAuthor([Key] AuthorId Id, AuthorName Name)
{
    public AuthorRegistered Handle() => new(Name);
}

[EventType]
public record AuthorRegistered(AuthorName Name);

public class RegisterAuthorValidator : CommandValidator<RegisterAuthor>
{
    public RegisterAuthorValidator() =>
        RuleFor(c => c.Name).NotEmpty().WithMessage("Name is required").MaximumLength(100);
}
```

The `[Key]` parameter is the event source id. With a concept that converts to `EventSourceId`, you may
omit `[Key]` and let Arc resolve it.

---

## 3. Generate-and-return a new id

```csharp
[Command]
public record RegisterAuthor(AuthorName Name)
{
    public (AuthorId, AuthorRegistered) Handle()
    {
        var id = AuthorId.New();
        return (id, new AuthorRegistered(Name));   // id flows back as CommandResult<AuthorId>.response
    }
}
```

---

## 4. Multiple events

```csharp
[Command]
public record TransferFunds(AccountId FromId, AccountId ToId, decimal Amount)
{
    public IEnumerable<object> Handle() =>
    [
        new FundsWithdrawn(FromId, Amount),
        new FundsDeposited(ToId, Amount),
    ];
}
```

---

## 5. Injected dependency / constraint

`Handle()` parameters are DI-resolved. Use for external services or constraints (e.g. uniqueness):

```csharp
[Command]
public record OpenDebitAccount([Key] AccountId Id, string Name, OwnerId OwnerId)
{
    public async Task<DebitAccountOpened> Handle(IUniqueAccountConstraint constraint)
    {
        await constraint.Validate(Name);          // throws on violation
        return new DebitAccountOpened(Name, OwnerId);
    }
}
```

---

## 6. Business rule via DCB (inject a read model)

When a rule depends on event-sourced state, accept the relevant read model as a `Handle()` parameter.
Arc materializes current state from the event log and injects it. Return a `Result<,>` for a clean
success/error contract:

```csharp
[Command]
public record ReserveBook([Key] BookId Id, MemberId Member)
{
    public Result<BookReserved, ReservationError> Handle(BookAvailability availability)
    {
        if (availability is null || !availability.IsAvailable)
            return ReservationError.NotAvailable;
        return new BookReserved(Member);
    }
}

public enum ReservationError { NotAvailable }
```

Only encode rules that appear in the slice `description` / `comments`.

---

## 7. Integration spec (Chronicle, full stack)

`Features/Authors/Registration/when_registering/and_there_are_no_authors.cs`

```csharp
using context = MyApp.Authors.Registration.when_registering.and_there_are_no_authors.context;

namespace MyApp.Authors.Registration.when_registering;

[Collection(ChronicleCollection.Name)]
public class and_there_are_no_authors(context context) : Given<context>(context)
{
    public class context(ChronicleOutOfProcessFixture fixture) : given.an_http_client(fixture)
    {
        public CommandResult<AuthorId>? Result;

        async Task Because() =>
            Result = await Client.ExecuteCommand<RegisterAuthor, AuthorId>(
                "/api/authors/register",
                new RegisterAuthor(AuthorId.New(), new AuthorName("John Doe")));
    }

    [Fact] void should_be_successful() => Context.Result!.IsSuccess.ShouldBeTrue();
    [Fact] void should_have_appended_one_event() =>
        Context.ShouldHaveTailSequenceNumber(EventSequenceNumber.First);
    [Fact] void should_append_author_registered_event() =>
        Context.ShouldHaveAppendedEvent<AuthorRegistered>(
            EventSequenceNumber.First, Context.Result!.Response,
            evt => evt.Name.Value.ShouldEqual("John Doe"));
}
```

### Pure unit spec on `Handle()` (no I/O)

```csharp
namespace MyApp.Authors.Registration.for_RegisterAuthor;

public class when_registering : Specification
{
    RegisterAuthor _command;
    AuthorRegistered _event;

    void Establish() => _command = new(AuthorId.New(), new AuthorName("John"));
    void Because() => _event = _command.Handle();

    [Fact] void should_carry_the_name() => _event.Name.Value.ShouldEqual("John");
}
```

---

## 8. React command UI (after `dotnet build` generated the proxy)

The proxy (`RegisterAuthor.ts`) is generated **next to** `Registration.cs` (the starter's `.csproj`
sets `CratisProxiesUseSourceFileAsOutputFile=true`), so import it from the **same folder**. Add a barrel
`index.ts` (`export * from './AddAuthor'`) like the shipped example slice.

```tsx
// Authors/Registration/AddAuthor.tsx
import { CommandDialog } from '@cratis/components/CommandDialog';
import { InputTextField } from '@cratis/components/CommandForm';
import { RegisterAuthor } from './RegisterAuthor';   // co-located generated proxy

export const AddAuthor = () => (
    <CommandDialog command={RegisterAuthor} title="Add author" okLabel="Add" cancelLabel="Cancel">
        <InputTextField<RegisterAuthor> value={c => c.name} title="Name" />
    </CommandDialog>
);
```

Inline form alternative:

```tsx
const [command] = RegisterAuthor.use();
const submit = async () => {
    const result = await command.execute();
    if (result.isSuccess) onSuccess(result.response);
};
```

Never import `Dialog` from `primereact/dialog` — use the Cratis wrappers. PrimeReact CSS variables for
colors. No `any`. Full descriptive variable names.

---

## Checklist

- One `.cs` file, namespace without `.Features.` (no file header unless the project uses one).
- `[Command]` with `Handle()` on the record — no handler class.
- `[EventType]` with **no** arguments; past-tense names; no nullable fields.
- `ConceptAs<T>` for every identity / value — no raw `Guid` / `string` in the domain.
- `CommandValidator<T>` for validations; read-model parameter for DCB rules.
- One spec per scenario in `slice.json`; `dotnet build` clean; specs pass.
