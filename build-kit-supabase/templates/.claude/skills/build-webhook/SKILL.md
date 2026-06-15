---
name: build-webhook
description: Implements a webhook slice as a self-contained Supabase Edge Function using the Emmett framework — exposes an HTTP endpoint, fires a command, emits events
---

# Build Webhook Slice (Supabase Edge Function)

> Before doing anything else, read the slice definition from `.build-kit/.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for all commands, events, and endpoint behaviour.

---


## What a Webhook Slice is

A webhook slice exposes an HTTP endpoint (Supabase Edge Function) that accepts an external request (e.g. payment provider callback), translates it into an Emmett command, and appends events to the PostgreSQL event store.

Architecture:

```
HTTP Request (external webhook / API call)
    │
    ▼
supabase/functions/{name}/index.ts   ← edge function — parse, build command, handle
    │
    ▼
CommandHandler (Emmett)              ← evolve state, decide events
    │
    ▼
PostgreSQL Event Store               ← new events appended
```

The edge function is **self-contained** — it does not import from the Node.js backend. Emmett imports use Deno's `npm:` specifier; the runtime scaffold uses `jsr:@supabase/server`.

---

## Step 1 — Read the slice.json

Extract:
- **sliceName** — becomes the Command name and function folder name (PascalCase / kebab-case)
- **context** — bounded context
- **commands[]** — command data fields (build the request body shape from these)
- **events[]** — events emitted when the command succeeds
- **endpoint** (if present) — preferred URL path; default to kebab-case slice name
> **Comments & description**: Each element carries a `comments: string[]` array and a `description` field. The slice also has `comments: string[]`. Use as implementation hints. When done, resolve each used comment: `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get IDs first via GET on same path).

---

## Step 2 — Ensure the shared events union exists

Check whether `src/slices/{context}/{Context}Events.ts` already has the event types. If not, add them using the same pattern as `build-state-change`:

```typescript
// src/slices/{context}/{Context}Events.ts
import type {Event} from '@event-driven-io/emmett';

type CommonMeta = {
    stream_name?: string;
    userId?: string;
    correlation_id?: string;
    causation_id?: string;
};

export type {EventName} = Event<'{EventName}', {
    id: string;
    // fields from slice.json events[]
}, CommonMeta>;

export type {Context}Events = /* existing */ | {EventName};
```

This keeps backend event types in sync even though the edge function is self-contained.

---

## Step 3 — Create the Supabase Edge Function

File: `supabase/functions/{function-name}/index.ts`

Function name is the slice name in kebab-case (e.g. `activate-license`).

```typescript
// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {withSupabase} from "jsr:@supabase/server@^1";
import {CommandHandler, type Command} from 'npm:@event-driven-io/emmett';
import {getPostgresEventStore} from 'npm:@event-driven-io/emmett-postgresql';

// ── Types ─────────────────────────────────────────────────────────────────────

type CommonMeta = {
    correlation_id?: string;
    causation_id?: string;
    userId?: string;
};

// Event type(s) — mirror src/slices/{context}/{Context}Events.ts
type {EventName} = {
    type: '{EventName}';
    data: {
        id: string;
        // fields from slice.json events[]
    };
    metadata: CommonMeta;
};

type {Context}Events = {EventName}; // extend union if multiple events

// Command type — fields from slice.json commands[]
type {SliceName}Command = Command<'{SliceName}', {
    id: string;
    // other fields from slice.json commands[].fields
}, CommonMeta>;

// Request body shape — derived from commands[].fields
interface {SliceName}Payload {
    id?: string;
    // other fields from slice.json commands[].fields
}

// ── State (idempotency) ───────────────────────────────────────────────────────

type {SliceName}State = {
    processed: boolean;
};

const initialState = (): {SliceName}State => ({processed: false});

const evolve = (state: {SliceName}State, event: {Context}Events): {SliceName}State => {
    switch (event.type) {
        case '{EventName}':
            return {...state, processed: true};
        default:
            return state;
    }
};

const decide = (
    command: {SliceName}Command,
    state: {SliceName}State,
): {Context}Events[] => {
    if (state.processed) {
        throw {code: 'already_processed', message: 'Already processed'};
    }

    return [{
        type: '{EventName}',
        data: {
            id: command.data.id,
            // map all fields from command.data per slice.json
        },
        metadata: {
            correlation_id: command.metadata?.correlation_id,
            causation_id: command.metadata?.causation_id,
        },
    }];
};

// ── Handler ───────────────────────────────────────────────────────────────────

const {SliceName}Handler = CommandHandler<{SliceName}State, {Context}Events>({
    evolve,
    initialState,
});

async function handle{SliceName}(id: string, command: {SliceName}Command) {
    const connectionString = Deno.env.get('SUPABASE_DB_URL');
    if (!connectionString) throw new Error('SUPABASE_DB_URL not set');

    const eventStore = getPostgresEventStore(connectionString);
    const result = await {SliceName}Handler(
        eventStore,
        id,
        (state: {SliceName}State) => decide(command, state),
    );
    return {
        nextExpectedStreamVersion: result.nextExpectedStreamVersion?.toString(),
        lastEventGlobalPosition: result.lastEventGlobalPosition?.toString(),
    };
}

// ── HTTP Handler ──────────────────────────────────────────────────────────────

console.info('{function-name} started');

export default {
    fetch: withSupabase({auth: ['publishable', 'secret']}, async (req, _ctx) => {
        try {
            const body: {SliceName}Payload = await req.json();
            const id = body.id ?? crypto.randomUUID();

            const command: {SliceName}Command = {
                type: '{SliceName}',
                data: {
                    id,
                    // map fields from body per slice.json commands[].fields
                },
                metadata: {
                    correlation_id: req.headers.get('x-correlation-id') ?? id,
                    causation_id: id,
                },
            };

            const result = await handle{SliceName}(id, command);

            return Response.json({ok: true, id, ...result}, {status: 201});
        } catch (err: unknown) {
            const error = err as {code?: string; message?: string};
            if (error.code) {
                return Response.json({error: error.message}, {status: 409});
            }
            console.error('[{function-name}] Unhandled error:', err);
            return Response.json({error: 'Internal server error'}, {status: 500});
        }
    }),
};
```

### Key decisions when filling in the template

**Function name** — use kebab-case of the slice name as the directory (e.g. `activate-license`). This becomes the function URL: `/functions/v1/activate-license`.

**`withSupabase` auth modes** — `"publishable"` allows calls with the anon key; `"secret"` allows calls with the service role key. Use `ctx.authMode` to branch on privileged vs. unprivileged behaviour if needed. For payment webhooks where the provider cannot supply a Supabase key, you may need to verify a provider-specific signature header instead (e.g. Stripe's `x-stripe-signature`).

**`id` field** — always use the aggregate identifier as both the stream key and response `id`. Generate with `crypto.randomUUID()` if not provided in the request body.

**Idempotency** — `state.processed` guards against replaying the same command. Match the guard to the emitted event: the `evolve` case for `{EventName}` sets `processed: true`.

**Error codes** — throw `{code: 'snake_case_code', message: '...'}` from `decide`. The handler maps those to `409 Conflict`.

**`SUPABASE_DB_URL`** — PostgreSQL connection string. Available automatically as a built-in secret in Supabase Edge Functions — no manual configuration needed.

**CORS** — `withSupabase` handles preflight automatically. No manual `OPTIONS` handler needed.

---

## Step 4 — Verify event store schema migration

The Emmett schema must be migrated before the edge function can write events. This happens once in the **backend startup**. Confirm that `src/common/loadPostgresEventstore.ts` calls `schema.migrate()`:

```typescript
await eventStoreInstance.schema.migrate();  // must be present
```

If the project has no Node.js backend yet, run the migration manually via a one-off script before deploying the edge function.

---

## Step 5 — Register the function in supabase config

Add to `supabase/config.toml`:

```toml
[functions.{function-name}]
verify_jwt = false   # false for public webhooks; true for internal API calls
```

Payment providers (Stripe, Paddle, etc.) cannot supply a Supabase JWT, so `verify_jwt = false` is the correct choice for webhook endpoints. Verify the provider's own signature header in the handler body instead.

---

## Step 6 — Test the edge function locally

```bash
supabase functions serve {function-name} --env-file .env.local
```

Then call it:

```bash
curl -i -X POST http://localhost:54321/functions/v1/{function-name} \
  -H "Content-Type: application/json" \
  -d '{ "id": "test-123", ... }'
```

---

## Checklist

- [ ] `supabase/functions/{function-name}/index.ts` created
- [ ] All `{SliceName}`, `{EventName}`, `{Context}`, `{function-name}` placeholders replaced
- [ ] Fields in `command.data` match `commands[].fields` from slice.json exactly
- [ ] Fields in emitted event `data` match `events[].fields` from slice.json exactly
- [ ] Idempotency guard in `decide` (throws `already_processed` on duplicate)
- [ ] Error `code` used in `throw` so the 409 mapping works
- [ ] Event type added to `src/slices/{context}/{Context}Events.ts`
- [ ] `supabase/config.toml` entry added with correct `verify_jwt` setting
- [ ] `schema.migrate()` confirmed in backend startup (or run manually)
- [ ] Local test with `supabase functions serve` passes

---

## Files to create / modify

```
supabase/functions/{function-name}/
└── index.ts    ← self-contained Deno edge function

src/slices/{context}/
└── {Context}Events.ts    ← add new event type and update union

supabase/
└── config.toml    ← register the new function
```
