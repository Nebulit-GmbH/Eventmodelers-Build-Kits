# Project Configuration

TODO — one-line pointer to where domain events live in your stack's scaffold (e.g. "Read Events in src/events to understand the global structure").

## File Structure Constraints

- **Strict Path Limitation**: TODO — the one directory glob the agent should stay inside by default (e.g. `src/slices/{slicename}/*`)
- **Slice Organization**: Each feature/domain should be organized as a separate slice

## Code Standards

- **Language**: TODO
- **Module System**: TODO
- **Type Safety**: TODO (delete this line if the language has no static typing)

## Development Guidelines

1. Each slice should be self-contained and focused on a specific domain
2. Maintain clear separation of concerns within each slice
3. TODO — your stack's own idioms/best practices

TODO — any other guardrails worth stating up front (e.g. ignore routes files unless
asked, ignore tests unless asked, slice names are case-insensitive) — copy the ones
that still apply from an existing stack's build-kit/CLAUDE.md.

At the start of every session, read `.build-kit/AGENTS.md` if it exists to load accumulated project learnings.

When starting to work on a slice, invoke the `update-slice-status` skill with `InProgress` status before doing anything else.

## Building a Slice

**CRITICAL: You MUST always use the provided skills to build slices. NEVER implement a slice manually.**
**ALL fields, event names, command names, and business rules MUST come exclusively from slice.json. Do NOT invent, assume, or guess any field or logic not present in the slice definition.**

**If, at any point below, the slice's requirements are genuinely ambiguous, contradictory, or missing
a decision you need in order to proceed — do not guess, and do not build anyway.** Invoke the
`request-feedback` skill with the specific question; it posts the question as a comment on the slice
and marks it `Blocked`, and you then stop work on this slice for this run. This is an escalation path,
not a routine step — read `slice.json` and the matching build skill's own instructions fully first;
most slices are fully specified and need none of this.

When asked to build a slice, always follow this flow:

1. Read the slice definition from `.build-kit/.slices/<context>/<slicename>/slice.json`.
2. Determine the slice type:
   - **Translation** — `sliceType === "TRANSLATION"` → read `description` and `notes` from slice.json for hints; default to `/build-automation` if nothing else is specified
   - **Automation** — `processors` array is non-empty → invoke `/build-automation`
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`
3. Invoke the matching skill and follow its instructions completely. Do not deviate.
4. **Verify against slice.json**: After the skill completes, check that every command field, event field, and specification in slice.json appears in the implementation. No invented fields — if it is not in slice.json, it must not be in the code.
5. Run quality checks (TODO: this stack's build + test commands), then the slice tests only.
6. If checks pass, commit with `feat: [Slice Name]` and set slice status to `Done`.

After you are done, automatically run the tests for the slice that was edited.

## Example Slice Structure

TODO — a short tree showing where one slice's files land, e.g.:
```
TODO
```
