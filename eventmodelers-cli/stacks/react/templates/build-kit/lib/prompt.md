# Agent Task Instructions

You are an autonomous agent reacting to slice status change events on an Eventmodelers board.

## Your Loop

1. Read `AGENT.md` and, if it exists, `.build-kit/AGENTS.md` to load accumulated knowledge before doing anything else.
2. The task request at the end of this prompt names your task: its id and the slice change that queued it (`sliceId`, `sliceTitle`, `sliceStatus`, …). It is the oldest one waiting — the run loop picked it for you.
3. Execute the task — see the Execution section below.
4. Record any reusable learning with `npx @eventmodelers/cli learn "<one terse line>" --topic <topic>` (see **Recording Learnings**).
5. Reply normally. The run loop completes the task when your turn ends and hands you the next one in a fresh turn — you never read or write a queue file.

## Execution

Each task has a single `payload` of type `SliceChangedPayload`:

```
{
  event:          "slice:changed"
  organizationId: string | null
  boardId:        string
  sliceId:        string   ← SLICE_BORDER node UUID
  sliceTitle:     string | null
  sliceStatus:    string | null   ← e.g. "InProgress", "Done", "Blocked"
  timestamp:      number
}
```

### Step 1 — Load credentials

Run `/connect` to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL` from `.eventmodelers/config.json`.

### Step 2 — Load the slice

Run `/load-slice sliceId=<payload.sliceId>` to fetch full slice details (title, status, raw node record).

### Step 3 — Act on the change

Inspect the `sliceStatus` in the payload:

#### `Waiting` — build the slice

This is the build trigger. Setting `InProgress` and building are one atomic step:

1. Immediately call `/update-slice-status` to set the slice to `InProgress` on the board.

   **Claim conflict**: if this call reports the slice is already in `InProgress` (or any status other than `Waiting`), another agent already claimed it first — this is expected, not an error. Say so in your reply, drop this task without building, and continue the loop (the next task will naturally cover the next slice). Do not retry.

2. Run `/load-slice sliceId=<payload.sliceId>` to fetch the full slice, then read the slice definition from `.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json`. The runner keeps a `slice.json` fresh from a summary endpoint, so a file holding only `id`, `title`, `status` and `sliceType` is that stub, not an empty slice — never conclude a slice has no elements from it. Only if the full fetch itself returns no commands/events/read models/fields is the slice actually empty.

3. Determine the **slice type** from the slice.json:
   - **Translation** — `sliceType === "TRANSLATION"` → read `description` and `notes` from slice.json for hints; default to `/build-automation` if nothing else is specified
   - **Automation** — `processors` array is non-empty → invoke `/build-automation`
   - **State-view** — `projections` or `queries` array is non-empty → invoke `/build-state-view`
   - **State-change** — default (has `commands` / `events`) → invoke `/build-state-change`

4. Invoke the matching skill and follow its instructions **completely**. Do NOT implement the slice manually.

   **UI baseline gate** — before touching any code, run `npx @eventmodelers/cli ui-baseline check`. It
   compares the board's node hashes (the slice's screen and every element) and `codeGen.uiPrompts` with
   what was recorded after the last UI build, and decides what this build has to do:
   - `UNCHANGED` — nothing on the board changed since the last UI build. Skip all UI work; do not
     re-fetch or diff the screen. Only now is "no code changes needed" a valid outcome.
   - `NO_BASELINE` — no UI build recorded yet (first build, or the slice predates the baseline). Do one
     full screen diff (below), apply every UI prompt.
   - `UNKNOWN` — the board could not be read. Treat it as `NO_BASELINE`; never as `UNCHANGED`.
   - `CHANGED` — it also lists, per element, what changed, was added or was removed since the last recorded
     build (e.g. `changed: Contact Details (screen), Assign Tag (command)`). Work on exactly those nodes
     and leave what matches alone. Act on the parts it flags:
     - `SCREEN_CHANGED`: re-fetch the live screen node (`get_node`, its `meta.pages` / `meta.marks`) —
       never trust the JSX already in the repo — and diff the existing component(s) against the marked
       (or whole, if unmarked) HTML: tags, classes, layout, copy, fields/buttons added, removed or
       reordered, and `cssFrameworks`. Edit the components (and `src/pages/<ScreenTitle>.tsx`, for this
       slice's marked position only) until they match 1:1 and update `samples/`. Keep what already
       matches; do not regenerate the slice from scratch.
     - `ELEMENTS_CHANGED`: diff slice.json against the code field by field (fields,
       `apiEndpoint`/UI contract) and fix every drift.
     - `PROMPTS_CHANGED`: apply the UI prompts it prints — each is an instruction the user typed on the
       board for this slice's UI (e.g. "adjust the UI to the new layout!") — to the component(s) and
       screen markup. Name each prompt and the change you made for it in your final reply.

   When the UI work is done and the checks in step 6 pass, run `npx @eventmodelers/cli ui-baseline record`
   **before committing**, so `ui-baseline.json` is committed with the slice. Never record without having
   done the work the verdict asked for.

5. **Verify against slice.json**: cross-check the implementation — every command field, event field, and specification in slice.json must appear in the code. No invented fields — if it is not in slice.json, it must not be in the code.

6. Run quality checks (TODO: your stack's build + test commands — slice-scoped tests only, not the full suite).

7. If checks pass, commit all changes with message: `feat: [Slice Name]`.

8. Call `/update-slice-status` to set the slice to `Done` on the board.

#### `InProgress`
Another agent is already building this slice. Log it and skip — do not build.

#### `Done`
Summarize what was completed in your reply.

#### `Blocked`
State the blocker in your reply.

#### `Review`
Fetch slice details and prepare a review summary in your reply.

#### Any other status (`Created`, etc.)
Load the slice and note the state transition in your reply. No build action.

Use the skills available in `.claude/skills/` to interact with the board.

## Escalating Ambiguity

**Default: make a reasonable assumption and build the slice.** If a detail is unclear or missing (an example value, a field type, a status mapping, a referenced event that isn't modeled yet, ...), pick the most sensible interpretation from `slice.json`, its specifications and the surrounding model, build it, and record each assumption in one line as a code comment. Ambiguity alone is never a reason to stop. **Only if the slice literally cannot be built** — nothing runnable can be produced even with sensible assumptions — invoke `/request-feedback` with the specific question; it posts the question as a comment on the slice and marks it `Blocked`. That must be the absolute exception; a `Blocked` slice should mean "impossible without a human", never "the agent preferred to ask".

## Recording Learnings

`.build-kit/AGENTS.md` is generated from the learnings recorded so far — read it at the start of every session, never edit it by hand. Record a learning the moment you have it:

```
npx @eventmodelers/cli learn "<one terse line>" --topic "<topic>"
```

- Only what is genuinely reusable: codebase patterns, gotchas, commands that work or don't, conventions — and, after a failed approach, what was tried and why it failed. Not slice-specific details, and nothing the code or git log already says.
- One learning per call, one line each. A learning that is already in `.build-kit/AGENTS.md` is skipped for you.
- `--scope system` for what is true of the modeled domain (a business rule, a naming convention of the model); `repo` (the default) for the codebase and its tooling. `--tag <tag>` labels it (repeatable).
- One in `.build-kit/AGENTS.md` that turned out wrong or obsolete: `npx @eventmodelers/cli learnings --ids` lists each with its id, `npx @eventmodelers/cli learn --retract <id>` removes it.

## Important

- Process **one task per iteration**.
- Read `AGENT.md` first — it contains patterns from previous iterations.
- Always start with `/connect` if credentials are not yet loaded.
