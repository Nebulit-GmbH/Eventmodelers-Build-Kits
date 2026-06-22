---
name: build-state-view
description: >
  Implement read slices the Cratis way — a [ReadModel] record with static query methods, fed by a
  Chronicle projection or reducer, plus the React component that renders it. Use when: (1) implementing
  a new read slice / projection in a Cratis project, (2) a slice.json has a non-empty readModel /
  projections / queries section, (3) the user provides a read-slice Event Modeling artifact or
  specification and asks to implement it, (4) the user says "implement", "create", "add" a read slice,
  read model, projection, reducer, or query in a Cratis Arc / Chronicle project.
---

# Cratis — Read Slice (State View)

A read slice projects events into a queryable read model. In Cratis the path lives in **one `.cs`
file**:

```
[ReadModel] record + static queries  →  projection or reducer  →  dotnet build  →  React
```

> **Read first:** [../_shared/cratis-conventions.md](../_shared/cratis-conventions.md). Everything
> below assumes those rules.

## Step 0 — Discover conventions

Read `CLAUDE.md` and one existing read slice. Confirm the namespace root, how existing read models
declare queries (snapshot vs observable), whether projections use model-bound attributes or
`IProjectionFor<T>`, and the MongoDB collection wiring. Resolve slice `comments` when done (see the
state-change skill's Step 0 for the resolve endpoint).

## Step 1 — Understand the input (`slice.json` is the source of truth)

| Element | What to extract |
|---|---|
| **Read model** | Name, fields, the key field |
| **Source events** | Which events feed each field (projections **join events, never read models**) |
| **Queries** | The queries to expose; whether each is snapshot or real-time (observable) |
| **Specifications** | Each scenario → an executable spec proving the projection result |

If a field has no source event in `slice.json`, do not invent one. One read model per use case —
never reuse a model across slices.

## Step 2 — Write the slice `.cs` file

`<Module>/<Feature>/<Slice>/<Slice>.cs` — namespace `<Root>.<Feature>.<Slice>`.

### Read model + static query methods
```csharp
[ReadModel]
public record AuthorListItem(AuthorId Id, AuthorName Name, int BookCount)
{
    public static async Task<IEnumerable<AuthorListItem>> AllAuthors(
        IMongoCollection<AuthorListItem> collection)
        => await collection.Find(_ => true).ToListAsync();

    public static async Task<AuthorListItem?> GetAuthor(
        AuthorId id, IMongoCollection<AuthorListItem> collection)
        => await collection.Find(a => a.Id == id).FirstOrDefaultAsync();

    // Real-time push — return ISubject<T> directly (never Task<ISubject<T>>)
    public static ISubject<IEnumerable<AuthorListItem>> ObserveAllAuthors(
        IMongoCollection<AuthorListItem> collection)
        => collection.Observe();
}
```
- `[ReadModel]` required. Query methods are **`public static`** on the record; the method name becomes
  the TS query proxy class name. No controller, no `IReadModels`.
- Favor reactive (`ISubject<T>`) queries when the slice wants live updates.

### Choose projection vs reducer
- **Projection** — shaped read models, field mapping, joins, children (most read slices).
- **Reducer** — running aggregates (balances, counts, sums) where state accumulates across events.

### Projection (declarative; AutoMap on by default)
```csharp
public class AuthorListItemProjection : IProjectionFor<AuthorListItem>
{
    public void Define(IProjectionBuilderFor<AuthorListItem> builder) => builder
        .From<AuthorRegistered>(from => from.Set(m => m.Name).To(e => e.Name))
        .From<BookAdded>(from => from.Add(m => m.BookCount).With(_ => 1));
}
```
Or model-bound shorthand for simple cases:
```csharp
[ReadModel]
public record AuthorInfo([Key] Guid Id, [FromEvent<AuthorRegistered>] string Name);
```

Projections/reducers are discovered automatically — no registration. See
[references/patterns.md](references/patterns.md) for joins, children, composite keys, and reducers.

## Step 3 — Build

`dotnet build` from the project root — zero warnings / errors. This generates the query proxy the
frontend imports.

## Step 4 — Specs

Write specs proving the projection/reducer produces the expected read model from a sequence of events —
one spec per scenario in `slice.json`. Run `dotnet test --filter "FullyQualifiedName~<SliceName>"`.
See [references/patterns.md](references/patterns.md).

## Step 5 — Frontend

Add `<Module>/<Feature>/<Slice>/<Component>.tsx` importing the co-located generated query proxy from
`./` (`MyQuery.use()` snapshot, `MyQuery.useWithPaging(pageSize)` for paging, observable proxy for live
data; or `DataTableForObservableQuery` for a table). Add a barrel `index.ts`. Register it in the
feature's composition page; add routing in `App.tsx` if it's a new page.

## Final verification — does the implementation match `slice.json`?

- [ ] Every read-model field → a record property fed by a projection/reducer mapping.
- [ ] Every source event used exists; projections map from **events**, never read models.
- [ ] Every query in the slice is exposed as a static method; observable where the slice wants live data.
- [ ] Every scenario → an executable spec.
- [ ] `dotnet build` clean; specs pass.

## References
- [references/patterns.md](references/patterns.md) — full projection/reducer/query/spec code + React.
- [../_shared/cratis-conventions.md](../_shared/cratis-conventions.md) — the Cratis conventions.
