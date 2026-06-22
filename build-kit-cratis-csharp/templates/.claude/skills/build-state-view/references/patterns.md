# Read Slice Patterns — Cratis Arc + Chronicle

Complete code for state-view (read) slices. All artifacts go in a single
`Features/<Feature>/<Slice>/<Slice>.cs`. The example slices use no file header (match the project); namespace drops `.Features.`.

---

## 1. Read model + queries (snapshot + observable)

```csharp
// Features/Authors/Listing/Listing.cs
namespace MyApp.Authors.Listing;

using System.Reactive.Subjects;
using Cratis.Arc.Queries.ModelBound;
using MongoDB.Driver;

[ReadModel]
public record AuthorListItem(AuthorId Id, AuthorName Name, int BookCount)
{
    public static async Task<IEnumerable<AuthorListItem>> AllAuthors(
        IMongoCollection<AuthorListItem> collection)
        => await collection.Find(Builders<AuthorListItem>.Filter.Empty).ToListAsync();

    public static async Task<AuthorListItem?> GetAuthor(
        AuthorId id, IMongoCollection<AuthorListItem> collection)
        => await collection.Find(a => a.Id == id).FirstOrDefaultAsync();

    public static ISubject<IEnumerable<AuthorListItem>> ObserveAllAuthors(
        IMongoCollection<AuthorListItem> collection)
        => collection.Observe();

    public static ISubject<AuthorListItem> ObserveAuthor(
        AuthorId id, IMongoCollection<AuthorListItem> collection)
        => collection.Observe(a => a.Id == id);
}
```

Rules: `[ReadModel]` required; methods `public static`; observable methods return `ISubject<T>`
directly (never `Task<ISubject<T>>`); `ConceptAs<T>` for identity fields; one read model per use case.

---

## 2A. Projection (declarative mapping)

```csharp
public class AuthorListItemProjection : IProjectionFor<AuthorListItem>
{
    public void Define(IProjectionBuilderFor<AuthorListItem> builder) => builder
        .From<AuthorRegistered>(from => from
            .Set(m => m.Name).To(e => e.Name)
            .Set(m => m.BookCount).WithValue(0))
        .From<BookAdded>(from => from
            .Add(m => m.BookCount).With(_ => 1))
        .From<BookRemoved>(from => from
            .Subtract(m => m.BookCount).With(_ => 1));
}
```

- Keyed by **event source id** by default (the id passed to `IEventLog.Append`).
- AutoMap is on — `.From<E>()` directly; matching property names map automatically.
- Builder verbs: `Set(...).To(...)` / `.WithValue(...)`, `Add(...).With(...)`, `Subtract(...).With(...)`,
  `.Join<T>()`, `.Children(...)`. Projections **join events, never read models**.

### Model-bound shorthand (simple cases)
```csharp
[ReadModel]
public record AuthorInfo(
    [Key] Guid Id,
    [FromEvent<AuthorRegistered>] string Name,
    [SetFrom<AuthorRegistered>(nameof(AuthorRegistered.Country))] string Country);
```

---

## 2B. Reducer (running aggregate)

```csharp
public class AccountBalanceReducer : IReducerFor<AccountBalance>
{
    public AccountBalance Opened(DebitAccountOpened @event, AccountBalance? current, EventContext context)
        => new(0m, context.Occurred);

    public AccountBalance Deposited(FundsDeposited @event, AccountBalance? current, EventContext context)
        => (current ?? new(0m, context.Occurred)) with { Balance = (current?.Balance ?? 0m) + @event.Amount };

    public AccountBalance Withdrawn(FundsWithdrawn @event, AccountBalance? current, EventContext context)
        => (current ?? new(0m, context.Occurred)) with { Balance = (current?.Balance ?? 0m) - @event.Amount };
}

public record AccountBalance(decimal Balance, DateTimeOffset LastUpdated);
```

Return the complete new state; never mutate `current` (`null` on the first event). Add
`[FilterEventsByTag]` / `[EventSourceType]` / `[EventStreamType]` when filtering by metadata.

---

## 3. Spec — projection result from a sequence of events

```csharp
namespace MyApp.Authors.Listing.for_AuthorListItem.when_an_author_registered_and_added_two_books;

// Use the project's projection-spec harness (e.g. a ProjectionSpecificationContext / Given<context>).
// The shape: append events, observe the resulting read model, assert fields.

public class and_projecting : Specification
{
    AuthorListItem _result;

    void Establish() { /* append AuthorRegistered, BookAdded, BookAdded to the test event store */ }
    void Because()   { /* run the projection / read the resulting model */ }

    [Fact] void should_have_the_name()      => _result.Name.Value.ShouldEqual("John");
    [Fact] void should_count_two_books()     => _result.BookCount.ShouldEqual(2);
}
```

Match the project's existing projection-spec harness — discover it from an existing read slice's specs.

---

## 4. React — render the query proxy

The query proxy (`AllAuthors.ts`) is generated **next to** `Listing.cs` — import it from the same
folder. The simplest list UI uses the Cratis `DataTableForObservableQuery` component (see the shipped
example slice's `ListingDataTable.tsx`):

```tsx
// Authors/Listing/ListingDataTable.tsx
import { DataTableForObservableQuery } from '@cratis/components/DataTables';
import { Column } from 'primereact/column';
import { AllAuthors } from './AllAuthors';   // co-located generated proxy

export const ListingDataTable = () => (
    <DataTableForObservableQuery query={AllAuthors} dataKey='id' emptyMessage='No authors yet.'>
        <Column field='name' header='Name' />
        <Column field='bookCount' header='Books' />
    </DataTableForObservableQuery>
);
```

Hook form (manual rendering):

```tsx
const [authors] = AllAuthors.use();              // snapshot or observable, depending on the proxy
const [result, , setPage] = AllAuthors.useWithPaging(10);   // paging
// result.data, result.paging.totalItems, result.paging.page
```

Observable queries generate an `ObservableQueryFor` proxy (from `collection.Observe()`); snapshot
queries generate `QueryFor`. PrimeReact CSS variables / Tailwind for styling; no `any`; full
descriptive names. Add a barrel `index.ts` for the slice.

---

## Checklist

- One `.cs` file, namespace without `.Features.` (no file header unless the project uses one).
- `[ReadModel]` record; `public static` query methods; observable returns `ISubject<T>` directly.
- Projection (mapping) or reducer (aggregate) — discovered automatically, no registration.
- Projections map from events only; one read model per use case.
- `ConceptAs<T>` for identity fields; one spec per scenario; `dotnet build` clean; specs pass.
