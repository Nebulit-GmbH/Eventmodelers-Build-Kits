# Project Configuration

Read Events in src/events to understand the global structure.

## File Structure Constraints

- **Strict Path Limitation**: if not instructed otherwise, only check `src/slices/{slicename}/*.ts`
- **Slice Organization**: Each feature/domain should be organized as a separate slice

## Code Standards

- **Language**: TypeScript only
- **Module System**: Use ES modules (import/export)
- **Type Safety**: Ensure all code is properly typed

## Development Guidelines

1. Each slice should be self-contained and focused on a specific domain
2. Maintain clear separation of concerns within each slice
3. Follow TypeScript best practices for type definitions and interfaces

Only check src/slices/{slice}/*.ts, do not check subfolders unless explicitely tasked to.
If not tasked explicitely to change routes, ignore routes*.ts — except the `routes.ts` of the slice you are
building: the build skill owns that file, and its `@openapi` block has to stay in step with the slice's
fields (the `openapi-annotation` check blocks the commit otherwise).

Ignore case for files and slices in prompts. "CartItems" slice is the same as "cartitems"

Do not change files with tests unless explicitely instructed, or the change brings the test in line with slice.json (e.g. step 4's field/spec diff): *.test.ts

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project learnings.

When starting to work on a slice, invoke the `update-slice-status` skill with `InProgress` status before doing anything else.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do NOT invent, assume, or guess any field or logic not present in the slice definition.**

**Default: make a reasonable assumption and build the slice.** If a detail is unclear or missing (an example value, a field type, a status mapping, a referenced event that isn't modeled yet, ...), pick the most sensible interpretation from `slice.json`, its specifications and the surrounding model, build it, and record each assumption in one line in `progress.txt` and as a code comment. Ambiguity alone is never a reason to stop. **Only if the slice literally cannot be built** — nothing runnable can be produced even with sensible assumptions — invoke `/request-feedback` with the specific question; it posts the question as a comment on the slice and marks it `Blocked`. That must be the absolute exception; a `Blocked` slice should mean "impossible without a human", never "the agent preferred to ask".

When asked to build a slice, always follow this flow:

1. Read the slice definition from `.build-kit/.slices/<context>/<slicename>/slice.json`.
2. Determine the slice type:
   - **Translation** — `sliceType === "TRANSLATION"` → read `description` and `notes` from slice.json for hints; default to `/build-automation` if nothing else is specified
   - **Automation** — `processors` array is non-empty → invoke `/build-automation`
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`
3. Invoke the matching skill and follow its instructions completely. Do not deviate.
4. **Verify against slice.json**: After the skill completes, check that every command field, event field, and specification in slice.json appears in the implementation. No invented fields — if it is not in slice.json, it must not be in the code. This applies even when the slice was previously `Done` and reappears as `Planned` — never dismiss a mismatch as "already implemented" or harmless drift; diff slice.json against the code field by field and update the code to match every change.
5. Run quality checks (`npm run build`, then the slice tests only).
6. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done`.

After you are done, automatically run the tests for the slice that was edited.

## Commit Scope Guard

A pre-commit hook (`.githooks/pre-commit`, installed via `init --hooks` — see its own project's setup)
runs `.build-kit/lib/check-commit-scope.cjs` on every commit that touches `src/slices/{context}/{slice}/`.
It loads every check under `.build-kit/lib/checks/` and rejects the commit if any of them find a problem:

- **blocked-paths** — `package.json`/lockfiles and `server.ts` are never touched by slice work
- **slice-scope** — everything staged must be inside the slice folder or a documented exception:
  `src/slices/{context}/{Context}Events.ts` or `src/common/loadPostgresEventstore.ts`
- **append-only-migrations** — `migrations/V{n}__*.sql` may only be **added**, never edited
- **test-file-present** — a changed Command/Projection/processor file needs a sibling `*.test.ts`
- **no-invented-fields** — heuristic: flags a field used in code that isn't declared anywhere in
  `.build-kit/.slices/{context}/{slice}/slice.json`
- **spec-coverage** — heuristic: the test file needs at least as many `it(...)` blocks as slice.json
  has `specifications[]` entries
- **openapi-annotation** — every handler in a slice's `routes.ts` needs an `@openapi` JSDoc block
  above it, keyed on the registered path (`:param` written as `{param}`); without it the endpoint
  never reaches `/api-docs` or `/swagger.json`
- **tsc-build** — `npx tsc --noEmit` must still pass

If a commit is rejected, split it — commit the out-of-scope file separately from the slice work, or add
the missing test/fix the field — rather than passing `--no-verify`. Run `npm run run:checks` any time
you want to check your current work (by default this checks every uncommitted change — staged,
unstaged, and untracked; pass `-- --staged` to check only what's staged, matching what the pre-commit
hook itself checks). To add a new check, read `.build-kit/lib/checks/README.md` and drop in a file
following its interface — no other wiring needed.

## Example Slice Structure

```
src/slices/
├── {slice-name}/
│   ├── CommandHandler.ts
│   └── routes.ts
```