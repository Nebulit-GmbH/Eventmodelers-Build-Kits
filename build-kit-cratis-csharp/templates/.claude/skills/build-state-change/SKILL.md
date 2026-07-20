---
name: build-state-change
description: >
  Implement Event Sourcing write slices the Cratis way — using Cratis Arc (CQRS) + Cratis Chronicle
  (event sourcing) in a .NET / C# project. A write slice is: Command → Handle() → Event(s), with
  optional validators, constraints, and DCB business rules. Use when: (1) implementing a new write
  slice / command in a Cratis project, (2) a slice.json has a non-empty commands[] / events[] section,
  (3) the user provides an Event Modeling artifact, specification, or natural-language description of a
  command and asks to implement it, (4) the user says "implement", "create", "add" a write slice,
  command, or state change in a Cratis Arc / Chronicle project.
---

# Cratis — Write Slice (State Change)

A write slice mutates state by recording events. In Cratis Arc the whole path lives in **one `.cs`
file**:

```
[Command] record + Handle()  →  validator/constraint  →  [EventType] record(s)  →  dotnet build  →  specs
```

> **Read first:** [../_shared/cratis-conventions.md](../_shared/cratis-conventions.md) — the
> non-negotiable Cratis rules. Everything below assumes them.

## Step 0 — Discover the target project's conventions

Before writing code, read the project's `CLAUDE.md` and **at least one existing slice** (the starter
ships one under `SomeModule/SomeFeature/`). Confirm:

- The namespace root (read the `.csproj` `<RootNamespace>` and existing `.cs` files — never
  hard-code it; the namespace mirrors the folders and drops any `.Features.` segment).
- How existing commands return results (single event / tuple / `Result<,>` / `void`).
- How `ConceptAs<T>` identity types are declared and where they live.
- Whether existing `.cs` files use a file header (the starter uses none).

> **Comments & description:** each slice element carries a `comments: string[]` array and a
> `description`. Use them as implementation hints. When done, resolve each used comment:
> `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`
> (get IDs first via GET on the same path).

## Step 1 — Understand the input (`slice.json` is the source of truth)

Extract, regardless of input format:

| Element | What to extract |
|---|---|
| **Command** | Name (imperative), fields, which field is the event source / `[Key]` |
| **Events** | Names (past tense), fields, which events this command appends |
| **Business rules** | Preconditions, invariants, idempotency — from `description` / `comments` only |
| **State needed for rules** | Which read model must be inspected (DCB) to evaluate a rule |
| **Specifications** | Each GWT / scenario maps 1:1 to an executable spec |

**If a field is not in `slice.json`, it does not go in the code.** If requirements are unclear, ask
the user before proceeding.

### Determine the trigger
If unclear how the command is dispatched, ask:
> - **UI / REST** — exposed automatically by Arc; add a React component + integration spec.
> - **Automation only** — dispatched internally by a reactor (no UI). The command still exists; no `.tsx`.

## Step 2 — Create concept types (if needed)

For any new identity / value, add one `ConceptAs<T>` per file in the feature folder. Use the canonical
Guid-identity pattern (with `NotSet`, `New()`, and the `EventSourceId` conversion) — see the shared
conventions doc and [references/patterns.md](references/patterns.md).

## Step 3 — Write the slice `.cs` file

`<Module>/<Feature>/<Slice>/<Slice>.cs` — ALL backend artifacts in this one file; namespace
`<Root>.<Module>.<Feature>.<Slice>` (no file header unless the project uses one).

### Events first
```csharp
[EventType]                                   // NEVER any arguments
public record AuthorRegistered(AuthorName Name);
```
Past tense, no nullable properties, one purpose each. If the context's events already exist elsewhere,
reuse them — don't redefine.

### Command with `Handle()` on the record
```csharp
[Command]
public record RegisterAuthor(AuthorName Name)
{
    public AuthorRegistered Handle() => new(Name);   // Arc appends the returned event
}
```

Pick the return shape that matches the slice:
- **single event** → `EventName Handle()`
- **generate + return a new id** → `(NewId, EventName) Handle()` (Arc returns the id as
  `CommandResult<T>.response`)
- **multiple events** → `IEnumerable<object> Handle() => [ new A(...), new B(...) ];`
- **success/error** → `Result<TSuccess, TError> Handle()`
- **side-effect only** → `void Handle()`

Event source: a `[Key]` parameter, an `EventSourceId`-convertible concept, or `ICanProvideEventSourceId`.

### Business rules (DCB) — inject the read model
When a rule depends on event-sourced state, take the read model as a `Handle()` parameter; Arc injects
current state. Throw / return an error for violations:
```csharp
[Command]
public record RegisterAuthor(AuthorName Name)
{
    public Result<AuthorRegistered, RegistrationError> Handle(AuthorByName existing) =>
        existing is not null
            ? RegistrationError.NameAlreadyTaken
            : new AuthorRegistered(Name);
}
```
Only encode rules that appear in the slice `description` / `comments`. See
[references/patterns.md](references/patterns.md) for the full DCB and constraint patterns.

### Validation (optional but recommended)
```csharp
public class RegisterAuthorValidator : CommandValidator<RegisterAuthor>
{
    public RegisterAuthorValidator() =>
        RuleFor(c => c.Name).NotEmpty().WithMessage("Name is required").MaximumLength(100);
}
```
Extend `CommandValidator<T>` — auto-discovered, no registration. One `RuleFor` per validation in the slice.

## Step 4 — Build

From the project root: `dotnet build`. Fix ALL warnings and errors before continuing (warnings = errors).
This also regenerates the TypeScript proxies the frontend depends on.

## Step 5 — Write specs (one per scenario in `slice.json`)

Put integration specs in `<Module>/<Feature>/<Slice>/when_<behavior>/and_<scenario>.cs`. Cover, from the
slice's specifications:
- **Happy path** — command succeeds, correct event appended.
- **Each validation failure** — one spec per rule.
- **Each DCB business-rule violation** — one spec per read-model condition in `Handle()`.
- **Each constraint violation.**

Use the Cratis BDD pattern (`Specification`, `Establish` / `Because` / `[Fact] should_*`). For
Chronicle integration specs use `Given<context>` + `ChronicleOutOfProcessFixture` and assert with
`Context.ShouldHaveAppendedEvent<T>(...)`. See [references/patterns.md](references/patterns.md).

Run `dotnet test --filter "FullyQualifiedName~<SliceName>"`. Fix all failures.

## Step 6 — Frontend (only if the command is UI-triggered)

After `dotnet build` generated the proxy (co-located next to the `.cs`), add
`<Module>/<Feature>/<Slice>/<Component>.tsx` importing the proxy from `./`, using `CommandDialog` /
inline form. Add a barrel `index.ts`. Register it in the feature's composition
page. See the shared conventions doc's React section and [references/patterns.md](references/patterns.md).

## Final verification — does the implementation match `slice.json`?

- [ ] Every `commands[]` field → a Command record property (no invented, none missing).
- [ ] Every `events[]` entry → an `[EventType]` record; names match exactly; fields match.
- [ ] Every specification / GWT scenario → an executable spec.
- [ ] No business rule in `Handle()` that is absent from the slice `description` / `comments`.
- [ ] `dotnet build` is clean (0 warnings / 0 errors); slice specs pass.

## References
- [references/patterns.md](references/patterns.md) — full command/event/validator/constraint/DCB code,
  integration specs, and the React command UI patterns.
- [../_shared/cratis-conventions.md](../_shared/cratis-conventions.md) — the Cratis conventions.
