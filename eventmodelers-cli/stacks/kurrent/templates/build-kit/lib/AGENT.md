# Agent Learnings

Patterns and gotchas discovered during task processing. Update this file whenever you encounter something reusable.

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
- `/update-slice-status` rejects moving a slice into a status it's already in — this is a concurrency guard, not a bug. It means another agent already claimed the slice. Treat it as `ALREADY_IN_STATUS`, skip that slice, and move on to the next `Planned` one instead of erroring out.

## KurrentDB-specific

- Forgetting to register a new event type in a context's `{Context}EventTypes` class doesn't fail at
  compile time — it fails silently: `evolve`/a projection/an automation just never sees that event type
  when scanning a stream (it's treated as an unrecognized foreign event and skipped). Always add the
  registration line when a slice introduces a new event.
- An automation dispatching a command by appending to another stream must catch
  `WrongExpectedVersionException` locally when a retried (at-least-once persistent-subscription)
  redelivery is expected to re-hit an already-applied conflict — do not let it propagate out of the
  persistent-subscription listener's `onEvent`, or the message will be nacked/retried forever for no
  reason. Ack after catching it.
- Creating a persistent subscription group that already exists throws a raw `io.grpc.StatusRuntimeException`
  with status code `ALREADY_EXISTS` (not one of the SDK's own exception classes) — catch and ignore this
  specific case at startup, since subscription-group creation must be idempotent across app restarts.
  `io.grpc:grpc-api` is only a *runtime*-scope transitive dependency of `kurrentdb-client` — declared
  explicitly (compile scope) in `pom.xml` so `io.grpc.Status`/`StatusRuntimeException` are usable in
  application code at all; verified by compiling against the real dependency.
- Spring Boot 4 moved classic Jackson 2 (`com.fasterxml.jackson.core`) off the default compile
  classpath (its own internals now use Jackson 3, `tools.jackson.core`) — this project declares
  `com.fasterxml.jackson.core:jackson-databind` explicitly in `pom.xml` for that reason. Similarly,
  `@DataJpaTest`/`@WebMvcTest` moved to `org.springframework.boot.data.jpa.test.autoconfigure`/
  `org.springframework.boot.webmvc.test.autoconfigure` respectively.
- The `docker.kurrent.io/kurrent-latest/kurrentdb:latest` image can be slow or occasionally flaky to
  start under ARM/amd64 emulation (e.g. Apple Silicon Docker Desktop) — a container startup timeout or
  one-off failure there is usually transient; retry before assuming a real problem.
