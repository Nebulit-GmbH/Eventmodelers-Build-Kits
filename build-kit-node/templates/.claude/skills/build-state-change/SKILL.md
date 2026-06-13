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

## Step 5 — Create `routes.ts`

File: `src/slices/{context}/{SliceName}/routes.ts`

> **Concrete example**: `src/slices/example/routes.ts` — shows the full pattern with `requireUser`, `assertNotEmpty`, error mapping, and OpenAPI annotations. Read it before implementing.

```typescript
import {Request, Response, Router} from 'express';
import {WebApiSetup} from '@event-driven-io/emmett-expressjs';
import {requireUser} from '../../../supabase/requireUser';
import {{SliceName}Command, handle{SliceName}} from './{SliceName}Command';

export const api = (): WebApiSetup => (router: Router): void => {

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

## Files to create

```
src/slices/{context}/{SliceName}/
├── {SliceName}Command.ts    ← command handler (decide/evolve/handle)
├── {SliceName}.test.ts      ← DeciderSpecification tests
└── routes.ts                ← Express POST endpoint

src/slices/{context}/
└── {Context}Events.ts       ← add new event types here (update union)
```