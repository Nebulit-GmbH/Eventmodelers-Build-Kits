---
name: build-state-change
description: Implements an emmett state-change slice (command handler, tests, route) from a slice.json definition
---

# Build State Change Slice

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for all fields, events, and metadata. Never invent fields not defined there.

---

## What a State Change Slice is

A state-change slice processes a command using event sourcing. It:
1. Loads the current aggregate state by replaying past events (`evolve`)
2. Validates the command against that state (`decide`)
3. Returns new events if valid, throws if not

---

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the slice title (becomes the Command name)
- **context** — the bounded context (used to find `[Context]Events.ts`)
- **commands[]** — list of commands with their data fields
- **events[]** — list of events emitted by each command
- **specifications[]** — test scenarios (given/when/then)
- **storylines[]** (optional) — narrated walkthroughs that may yield additional command-handler tests; see Step 4b
> **Comments & description**: Each element (commands, events, readmodels, processors, screens, tables) carries a `comments: string[]` array (board comments on that node) and a `description` field. The slice itself also has `comments: string[]`. Use these as implementation hints — pass them as code comments, documentation, or validation logic where they add value. When done, resolve each used comment: `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get comment IDs first via GET on the same path without the last two segments).


---

## Step 2 — Ensure the shared events union exists

Each context has one `[Context]Events.ts` file that exports a union of all event types.

File location: `src/slices/{context}/[Context]Events.ts` (or wherever the existing one lives — search for it).

### Event type shape

```typescript
import type {Event} from '@event-driven-io/emmett';

type CommonMeta = {
    stream_name?: string;
    userId?: string;
    correlation_id?: string;
    causation_id?: string;
};

export type {EventName} = Event<'{EventName}', {
    // data fields from slice.json
}, CommonMeta>;

// Add the new event to the union
export type {Context}Events = /* existing events */ | {EventName};
```

Add each new event type and update the union. Do NOT remove existing types.

---

## Step 3 — Create `{SliceName}Command.ts`

File: `src/slices/{context}/{SliceName}/{SliceName}Command.ts`

### Full structure

```typescript
import type {Command} from '@event-driven-io/emmett';
import {CommandHandler} from '@event-driven-io/emmett';
import {type {Context}Events} from '../{Context}Events';
import {findEventstore} from '../../../common/loadPostgresEventstore';

// 1. Command type — data fields come from slice.json commands[]
export type {SliceName}Command = Command<'{SliceName}', {
    id: string;
    // ... other data fields from the slice definition
}, {
    correlation_id?: string;
    causation_id?: string;
}>;

// 2. State — only fields needed for validation
export type {SliceName}State = {
    // e.g. { processed: boolean } or { assignedIds: Set<string> }
    // Use {} if no validation state is needed
};

export const {SliceName}InitialState = (): {SliceName}State => ({
    // initial values
});

// 3. Evolve — pure function, updates state from past events
export const evolve = (
    state: {SliceName}State,
    event: {Context}Events,
): {SliceName}State => {
    const {type} = event;

    switch (type) {
        case '{EmittedEventName}':
            return {...state, /* update field */};
        default:
            return state;
    }
};

// 4. Decide — validates command, returns events or throws
export const decide = (
    command: {SliceName}Command,
    state: {SliceName}State,
): {Context}Events[] => {
    // idempotency / business rule check
    if (state.processed) {
        throw {code: 'already_processed', message: 'Already processed'};
    }

    return [{
        type: '{EmittedEventName}',
        data: {
            id: command.data.id,
            // ... map all fields from command.data per slice.json
        },
        metadata: {
            correlation_id: command.metadata?.correlation_id,
            causation_id: command.metadata?.causation_id,
            userId: command.data.userId,
        },
    }];
};

// 5. CommandHandler + exported handle function
const {SliceName}CommandHandler = CommandHandler<{SliceName}State, {Context}Events>({
    evolve,
    initialState: {SliceName}InitialState,
});

export const handle{SliceName} = async (id: string, command: {SliceName}Command) => {
    const eventStore = await findEventstore();
    const result = await {SliceName}CommandHandler(
        eventStore,
        id,
        (state: {SliceName}State) => decide(command, state),
    );
    return {
        nextExpectedStreamVersion: result.nextExpectedStreamVersion,
        lastEventGlobalPosition: result.lastEventGlobalPosition,
    };
};
```

### State complexity guide

| Scenario | State shape |
|----------|-------------|
| Simple create-once | `{ created: boolean }` |
| Idempotency by user | `{ processedUserIds: Set<string> }` |
| Count validation | `{ count: number; limit: number }` |
| No validation needed | `{}` (empty object) |

---

## Step 4 — Create `{SliceName}.test.ts`

File: `src/slices/{context}/{SliceName}/{SliceName}.test.ts`

Use `DeciderSpecification` for unit tests. Derive test scenarios from `specifications[]` in the slice.json.

```typescript
import {DeciderSpecification} from '@event-driven-io/emmett';
import {
    {SliceName}Command,
    {SliceName}InitialState,
    decide,
    evolve,
} from './{SliceName}Command';
import {describe, it} from 'node:test';

describe('{SliceName} Specification', () => {
    const given = DeciderSpecification.for({
        decide,
        evolve,
        initialState: {SliceName}InitialState,
    });

    it('spec: {SliceName} - creates event on empty stream', () => {
        const command: {SliceName}Command = {
            type: '{SliceName}',
            data: {
                id: 'test-id',
                // ... test values
            },
            metadata: {},
        };

        given([])
            .when(command)
            .then([{
                type: '{EmittedEventName}',
                data: {
                    id: 'test-id',
                    // ... expected event data
                },
                metadata: {},
            }]);
    });

    it('spec: {SliceName} - throws when already processed', () => {
        const command: {SliceName}Command = {
            type: '{SliceName}',
            data: {id: 'test-id'},
            metadata: {},
        };

        given([{
            type: '{EmittedEventName}',
            data: {id: 'test-id'},
            metadata: {},
        }])
            .when(command)
            .thenThrows();
    });
});
```

Add one test per specification in the slice.json. If the spec has no precondition events, use `given([])`.

---

## Step 4b — Storyline-derived tests (optional)

> **Note beats**: an entry with `type: STORYLINE_NOTE` is a note the board author placed in the walkthrough — its `description` is markdown context (an assumption, an external condition, a time gap), and its `id` is not a board node. Read it as background for the beats around it, but it is never a step: skip it when looking for COMMAND/EVENT/READMODEL beats or judging which beats are adjacent, and never turn it into test setup or an assertion on its own.

Some slices also have a `storylines[]` array in slice.json — narrated walkthroughs of one use case as an ordered sequence of beats (`elements[]`). Most slices have no storylines; skip this step silently when `storylines[]` is empty or absent.

A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need to match beats against `commands[]` by id/title. For each storyline, find a `type: COMMAND` beat directly followed by its EVENT beat(s). That pair is a command-handler test — the same shape as the specifications-derived tests above:
- `given` — the cumulative ordered EVENT beats from the start of the storyline up to (but not including) the command beat
- `when` — the command, built from the beat's `fields`
- `then` — the event(s) immediately following the command beat, built from their `fields`

Add these alongside the specifications-derived tests in the same `describe` block, or in their own block named after the storyline's `title` if it helps distinguish them.

A storyline walking COMMAND → EVENT → READMODEL is **not** one test here: the READMODEL half belongs to **build-state-view** — `DeciderSpecification` can only assert emitted events, never read-model state.

Skip (do not fabricate) a segment when the command beat has no immediately-following event beat relevant to this slice, or when the beat's fields don't give enough to construct a valid command.

---

## Step 5 — Create `routes.ts`

File: `src/slices/{context}/{SliceName}/routes.ts`

> **Pattern reference**: the template below is the full pattern — auth, error mapping, and the mandatory `@openapi` annotation (Step 5a). If the project already has slices under `src/slices/`, open one of their `routes.ts` files first and match it.

```typescript
import {Request, Response, Router} from 'express';
import {WebApiSetup} from '@event-driven-io/emmett-expressjs';
import {requireUser} from '../../../supabase/requireUser';
import {{SliceName}Command, handle{SliceName}} from './{SliceName}Command';

export const api = (): WebApiSetup => (router: Router): void => {

    /**
     * @openapi
     * /api/{slicename}/{id}:
     *   post:
     *     tags: [{Context}]
     *     summary: {slice title from slice.json}
     *     description: {slice.json description — plus any comments that explain the endpoint}
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Stream id this command is applied to
     *       - in: header
     *         name: correlation_id
     *         required: false
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [{command fields without optional: true}]
     *             properties:
     *               {fieldName}:
     *                 type: string
     *                 example: {the field's own example from slice.json, if it has one}
     *     responses:
     *       '201':
     *         description: Accepted — {EmittedEventName} appended
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                 next_expected_stream_version:
     *                   type: string
     *                 last_event_global_position:
     *                   type: string
     *       '401':
     *         description: Not authenticated
     *       '409':
     *         description: {message errorMapping returns — one line per error code}
     *       '500':
     *         description: Server error
     */
    router.post('/api/{slicename}/:id', async (req: Request, res: Response) => {
        const auth = await requireUser(req, res);
        if (auth.error) return;

        const id = req.params.id;
        const correlationId = req.header('correlation_id') ?? id;

        try {
            const command: {SliceName}Command = {
                type: '{SliceName}',
                data: {
                    id,
                    // ... map from req.body
                },
                metadata: {
                    correlation_id: correlationId,
                    causation_id: id,
                },
            };

            const result = await handle{SliceName}(id, command);

            res.set('correlation_id', correlationId);
            res.set('causation_id', id);

            return res.status(201).json({
                ok: true,
                next_expected_stream_version: result.nextExpectedStreamVersion?.toString(),
                last_event_global_position: result.lastEventGlobalPosition?.toString(),
            });
        } catch (err: any) {
            const errorMessage = errorMapping(err?.code);
            if (errorMessage) {
                return res.status(409).json({error: errorMessage});
            }
            console.error(err);
            return res.status(500).json({ok: false, error: 'Server error'});
        }
    });
};

const errorMapping = (code: string): string | null => {
    switch (code) {
        case 'already_processed': return 'This action has already been performed.';
        // add other error codes from slice.json specifications
        default: return null;
    }
};
```

---

### Step 5a — OpenAPI annotation (required)

`src/swagger.ts` builds the published OpenAPI document by scanning `./src/slices/**/routes.ts` for `@openapi` JSDoc blocks. A handler without one is **invisible** in Swagger UI (`/api-docs`) and in `/swagger.json` — the endpoint works, but nobody can find it. `src/swagger.ts` is shared infra and outside a slice's commit scope, so the block in this slice's own `routes.ts` is the only place the endpoint can be documented. The `openapi-annotation` commit check rejects a `routes.ts` whose handlers have no matching block.

Everything in the block comes from slice.json — same rule as the code: no invented fields, no guessed types.

| slice.json field `type` | OpenAPI schema |
|---|---|
| `String` | `type: string` |
| `UUID` | `type: string`, `format: uuid` |
| `Int` | `type: integer`, `format: int32` |
| `Long` | `type: integer`, `format: int64` |
| `Double` | `type: number`, `format: double` |
| `Decimal` | `type: number` |
| `Boolean` | `type: boolean` |
| `Date` | `type: string`, `format: date` |
| `DateTime` | `type: string`, `format: date-time` |
| `Custom` | `type: object` |

Mapping rules:

- **path key** — the express path with `:param` rewritten as `{param}` (`/api/foo/:id` → `/api/foo/{id}`). If the two disagree, Swagger publishes a path that does not exist.
- **tags** — `[{Context}]`, the slice's context, so every slice of one context groups under one heading.
- **summary** — the slice title. **description** — slice.json `description`, plus any `comments[]` that explain what the endpoint does.
- **requestBody properties** — exactly `commands[].fields`, minus the ones taken from the URL path or a header. Types from the table above.
- **required** — every command field not marked `optional: true`.
- **example** — only from the field's own `example` in slice.json. A field with no example gets no `example:` line; do not invent one.
- **responses** — `'201'` with the body the handler actually returns; one `'409'` per error code in `errorMapping` (i.e. per failing specification); `'401'` whenever the handler enforces auth; `'500'`.

A placeholder left unreplaced ships straight into the published spec, and `npm run build` will not catch it — open `/api-docs` and look at the rendered endpoint before marking the slice `Done`.

---

## Step 6 — Wire up the route

Find the application's router registration (usually `src/index.ts` or `src/app.ts`) and add:

```typescript
import {api as {SliceName}Api} from './slices/{context}/{SliceName}/routes';

// inside the router setup:
{SliceName}Api()(router);
```

---

## Key patterns

- **Metadata optional chaining**: always use `command.metadata?.correlation_id` (metadata may be absent in tests)
- **Throw with code**: `throw {code: 'snake_case_code', message: '...'}` — routes catch by `err?.code`
- **Idempotency in evolve**: track processed IDs in state, check in decide
- **Stream ID**: pass the aggregate ID as the first argument to `handle{SliceName}(id, command)` — the stream is `{context}-{id}`
- **No side effects in evolve**: evolve must be a pure function; all side effects go in decide or the route

---

## UI Contract

**Only when handover is on** (the task's `Handover: on` line, else `"handover": true` in `.eventmodelers/config.json`; with it off, skip this section): once the command endpoint is built, invoke the `ui-contract` skill (write contract, `POST`): it publishes
the endpoint's contract as the `## UI Contract` section of the slice's feedback-lane markdown node, which the slice export then carries in `slice.json` `notes[]`. Do not restate the format here — the skill owns it
(a build kit may override it).

**Source for this stack:** derive the contract from the handler's `@openapi` block, using `references/ui-contract-from-openapi.md`.

## Files to create

```
src/slices/{context}/{SliceName}/
├── {SliceName}Command.ts    ← command handler (decide/evolve/handle)
├── {SliceName}.test.ts      ← DeciderSpecification tests
└── routes.ts                ← Express POST endpoint

src/slices/{context}/
└── {Context}Events.ts       ← add new event types here (update union)
```

---

## Final Verification: Does the Implementation Match slice.json?

Before marking this slice as `Done`, verify the implementation against slice.json:

- [ ] Every field in `commands[].data` has a corresponding field in the Command type — no invented fields, none missing
- [ ] Every event in `events[]` has a corresponding type in `{Context}Events.ts` — names match exactly
- [ ] Every field in each event's data has a corresponding field in the TypeScript event type
- [ ] Every entry in `specifications[]` maps to a test case in `{SliceName}.test.ts`
- [ ] If `storylines[]` is present, each command-to-event transition relevant to this slice has a corresponding test (or a documented reason it was skipped)
- [ ] No business rules, defaults, or constraints were added that do not appear in slice.json `description` or `comments`
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
- [ ] `routes.ts` carries an `@openapi` JSDoc block above every handler, and its path key matches the registered route with `:param` written as `{param}`
- [ ] The documented request body is exactly `commands[].fields`, and every error code in `errorMapping` has a `'409'` line — no undocumented fields, no invented ones