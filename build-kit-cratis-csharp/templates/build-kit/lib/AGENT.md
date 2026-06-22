# Agent Learnings

Patterns and gotchas discovered during task processing. Update this file whenever you encounter something reusable.

## Cratis non-negotiables (seed — full detail in `.claude/skills/_shared/cratis-conventions.md`)

- ALL backend artifacts for a slice go in ONE `.cs` file: `Features/<Feature>/<Slice>/<Slice>.cs`. Never split into `Commands/`, `Handlers/`, `Events/`.
- `[Command]` records define `Handle()` directly on the record — never a separate handler class.
- `[EventType]` takes NO arguments (the type name is the id); events are past-tense and never nullable.
- Use `ConceptAs<T>` for every identity/value — no raw `Guid`/`string` in the domain.
- Read models: `[ReadModel]` record with `public static` query methods on it; observable queries return `ISubject<T>` directly (never `Task<ISubject<T>>`). Projections join events, never read models.
- Reactors implement the marker `IReactor`; dispatch is by the first parameter type. Write new events only via `ICommandPipeline.Execute(...)`, never `IEventLog`. Reactors must be idempotent and stateless.
- Namespace is `<Root>.<Feature>.<Slice>` — drop the `.Features.` segment. Find `<Root>` from `global.json` / existing slices; never hard-code.
- `dotnet build` generates the TypeScript proxies — backend must compile before a slice's frontend can reference them. Order: Backend → build → Specs → Frontend → Composition.
- Quality gate: `dotnet build` with zero warnings/errors (warnings = errors); `dotnet test --filter "FullyQualifiedName~<SliceName>"`. Copyright header on every `.cs` file.

## tasks.json

- Tasks are objects with `id`, `createdAt`, and `payload` (a `SliceChangedPayload`).
- After completing a task, remove it from the array entirely — do not add a status field.
- Write `[]` to `tasks.json` if the last task is completed.

## SliceChangedPayload fields

```
event           always "slice:changed"
organizationId  org UUID or null
boardId         board UUID
sliceId         SLICE_BORDER node UUID — use this with /load-slice
sliceTitle      human-readable slice name (may be null)
sliceStatus     e.g. "Created", "InProgress", "Done", "Blocked" (may be null)
timestamp       unix ms when the change was emitted
```

## Slice files

The realtime agent writes one file per slice on startup and after each `slice:changed` event:

```
.slices/<context>/<sliceName>/slice.json
```

- `<context>` is the slice's context value, or `default` if none.
- `<sliceName>` is the slice title lowercased with spaces removed (e.g. `"Enable User"` → `enableuser`).

These files are always up to date — read them directly before invoking any skill.

## Skill Usage

- Always run `/connect` first to load credentials from `.eventmodelers/config.json` before calling any other skill.
- `/load-slice sliceId=<uuid>` re-fetches all slices from the API, refreshes the slice files, and returns the requested slice. Use it when you need a guaranteed-fresh view of a specific slice.
- Read `.slices/<context>/<sliceName>/slice.json` directly when you already know the context and name and the file is recent enough.

## Board API

- The `boardId` and `organizationId` from each payload provide full context — pass them to skills.
- Node events use `node:created`, `node:changed`, `node:deleted` — always POST to `/api/org/:orgId/boards/:boardId/nodes/events`.
- Slice metadata (title, status) lives on the SLICE_BORDER node under `meta.sliceStatus` and `meta.title`.
