# Agent Learnings

Patterns and gotchas discovered during task processing. Update this file
whenever you encounter something reusable.

## tasks.json

- Tasks are objects with `id`, `createdAt`, and `payload` (a
  `SliceChangedPayload`).
- Unlike build-kit, every status change is queued (not just non-`Planned`
  ones) — see `queueAllStatuses` in `lib/ralph.js`.
- After completing a task, remove it from the array entirely — do not add a
  status field.
- Write `[]` to `tasks.json` if the last task is completed.

## SliceChangedPayload fields

```
event           always "slice:changed"
organizationId  org UUID or null
boardId         board UUID
sliceId         SLICE_BORDER node UUID
sliceTitle      human-readable slice name (may be null)
sliceStatus     e.g. "Created", "Planned", "InProgress", "Done" (may be null)
timestamp       unix ms when the change was emitted
```

## Bridge target

- The active target framework lives in `.bridge-kit/bridge.json`'s `target`
  field, written at `init --bridge --target <name>` time. This file is
  committed (unlike `.eventmodelers/config.json`, which is gitignored) since
  it's project policy shared by every teammate and CI runner, not a
  per-machine credential.
- Skill naming convention: `bridge-<target>-specify` (kept in sync every
  task) and `bridge-<target>-tasks` (invoked separately, by that framework's
  own task-planning phase — not from this loop).

## Executors

- Claude (`ralph-claude.js`, this prompt) is the default. `bridge --ollama`
  swaps in a local model instead — same prompt, different executor.
- `bridge --hook "<command>"` (or a `hookCommand` persisted in
  `bridge.json`) bypasses this prompt entirely: `ralph-hook.js` runs an
  arbitrary shell command per batch of changes instead of any AI agent — e.g.
  commit + push `.slices/` and let a CI pipeline do the actual translation.
  If you're reading this file, a hook wasn't configured for this run.
