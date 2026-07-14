# Ralph Agent Instructions — Cratis (Arc + Chronicle)

You are an autonomous coding agent building software slices in a **Cratis** .NET / C# project. You
apply your skills to implement one slice at a time, the Cratis way.

The conventions in `.claude/skills/_shared/cratis-conventions.md` are authoritative — read them before
implementing.

## Your Task

0. Do not read the entire codebase. Focus on the task in this description.
1. Read `.build-kit-cratis-csharp/.slices/current_context.json` to find the active context name, then
   read `.build-kit-cratis-csharp/.slices/<contextName>/index.json`. Every item with status "Planned"
   is a task.
2. Read the progress log at `progress.txt` (check the **Codebase Patterns** section first) and the
   accumulated learnings in `AGENT.md`.
3. Make sure you are on the right branch `feature/<slicename>`; if unsure, start from `main`.
4. Pick the **highest priority** slice where status is **exactly** "Planned" (case insensitive). This
   becomes your PRD. Set its status to "InProgress" in `index.json` **and** on the board via the
   `update-slice-status` skill (or MCP if available).
   **Only work on slices with status "Planned". Never pick up "InProgress", "Done", "Blocked",
   "Created", or any other status — even if it looks incomplete. If no slice is "Planned", reply with**
   `<promise>NO_TASKS</promise>` **and stop immediately.**
5. Read the slice definition from
   `.build-kit-cratis-csharp/.slices/<contextName>/<folder>/slice.json` — it is the source of truth.
   Never work on more than one slice per iteration.
6. A slice may define additional `codegen` / `backendPrompt` hints — take them into account and note in
   `progress.txt` when used.
7. Determine the slice type and load the matching skill:
   - **State Change** (has `commands` / `events`, no `processors`) → `/build-state-change`
   - **State View** (has `readModel` / `projections` / `queries`) → `/build-state-view`
   - **Automation** (`processors` array non-empty) → `/build-automation`
   - **Translation** (`sliceType === "TRANSLATION"`) → read `description` / `notes` for hints; default
     to `/build-automation` (a reactor that triggers a command in its own slice)
8. Write a short one-line progress note to `progress.txt` after each step.
9. Implement that single slice using the matching skill as guidance. Make a TODO list of what's needed.
   The JSON is the desired state — carefully compare events, fields, commands, and specifications
   against the code. A "Planned" task may be **added specifications** on an existing slice: always look
   at the slice AND its specifications, and add any missing specs in code.
10. The JSON is always true — the code follows what the JSON defines.
11. A slice is only "Done" when the business logic is implemented as defined, the read/write/automation
    artifacts exist, every specification in the JSON has an executable equivalent in code, and it
    fulfills `slice.json`. There must be no specification in the JSON without a code equivalent.
12. **Follow the Cratis non-negotiables** (full detail in `cratis-conventions.md`):
    - ALL backend artifacts for the slice in ONE `.cs` file under the project's slice folder
      (the shipped starter uses `<Module>/<Feature>/<Slice>/<Slice>.cs` — discover the real
      top-level folder from an existing slice and match it).
    - `[Command]` records with `Handle()` on the record — never separate handler classes.
    - `[EventType]` with NO attribute arguments; past-tense names; no nullable properties.
    - `ConceptAs<T>` for every identity / value — no raw `Guid` / `string` in the domain.
    - Namespace mirrors the folders and drops any `.Features.` segment
      (`<Root>.<Module>.<Feature>.<Slice>`; the starter's `<Root>` is `CratisApp`). Read the
      `<RootNamespace>` in the `.csproj` and existing slices to find the root; never hard-code it.
    - File header: only if the project's existing `.cs` files already carry one — the shipped
      example slices use none, so default to no header.
13. Run quality checks — it is enough to run the tests for the slice only, not all tests. Run from the
    **project root** (where the `.csproj`/solution lives), not the kit folder:
    - Build: `dotnet build`  (zero warnings, zero errors — warnings are treated as errors; this also
      regenerates the TypeScript proxies)
    - Test (slice only): `dotnet test --filter "FullyQualifiedName~<SliceName>"`
    If the slice is UI-triggered, also implement the React component(s) AFTER the build generated the
    proxies, then register them in the feature's composition page.
14. If checks pass, commit ALL changes with message `feat: <Slice Name>` and merge back to `main` as a
    fast-forward merge (update first).
15. Set `status: Done` for the slice in `index.json` **and** on the board via `update-slice-status`.
16. Append progress to `progress.txt` after each step.
17. Append new reusable learnings to `AGENT.md` in compressed form (only if not already there).
18. Finish the iteration.

## Sequencing (Cratis-specific)

`dotnet build` generates the TypeScript proxies — **the frontend of a slice cannot reference its proxy
until the backend compiles**. Always: Backend → `dotnet build` → Specs → Frontend → Composition.
Never implement a slice's frontend before its backend builds.

## Progress Report Format

APPEND to `progress.txt` (never replace):

```
## [Date/Time] - [Slice]

- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this project's namespace root is `Library`")
  - Gotchas (e.g., "observable queries must return ISubject<T>, never Task<ISubject<T>>")
  - Useful context
---
```

## Consolidate Patterns

If you discover a **reusable** pattern, add it to a `## Codebase Patterns` section at the TOP of
`progress.txt` (create it if missing). Only general, reusable patterns — not slice-specific details.

```
## Codebase Patterns
- Namespace root is `<Root>`; slices live under <Module>/<Feature>/<Slice>/
- Read models expose queries as public static methods on the [ReadModel] record
- DCB rules: inject the read model as a Handle() parameter
```

## Quality Requirements

- ALL commits must pass `dotnet build` (zero warnings/errors) and the slice's `dotnet test`.
- Do NOT commit broken code. Keep changes focused and minimal. Follow existing patterns.

## Specifications

For every specification on the slice, implement one executable spec in code (Cratis.Specifications BDD:
`Establish` / `Because` / `[Fact] should_*`). A slice is not complete if specifications are missing or
cannot execute.

## Stop Condition

**After completing ONE slice, always stop** — the ralph loop will invoke you again for the next slice.
Never chain multiple slices in one iteration.

- Slice completed and committed → reply `<promise>DONE</promise>`
- No slice has status "Planned" → reply `<promise>NO_TASKS</promise>`
- ALL slices across the index are Done → reply `<promise>COMPLETE</promise>`

## Important

- If `.build-kit-cratis-csharp/.eventmodelers/config.json` is absent, skip all platform communication
  (MCP calls, `update-slice-status`, board sync) and continue working locally.
- Work on ONE slice per iteration. Commit frequently. Update `progress.txt` frequently.
- Read the Codebase Patterns section in `progress.txt` and `AGENT.md` before starting.
