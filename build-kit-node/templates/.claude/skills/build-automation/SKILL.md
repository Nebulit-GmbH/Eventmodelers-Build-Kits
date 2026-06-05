---
name: build-automation
description: Implements an emmett automation slice (reactor processor + command handler) from a slice.json definition
---

# Build Automation Slice

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for which trigger event drives the automation and what command it fires.

---

## What an Automation Slice is

An automation slice reacts to events from the event store and fires a command in response. It replaces the old CRON + TODO-list pattern with an event-driven **reactor**.

Architecture:

```
Event Store
    │  (TriggerEvent emitted by another slice)
    ▼
processor.ts   ← reactor — listens, maps, fires command
    │
    ▼
{SliceName}Command.ts   ← command handler (decide/evolve)
    │
    ▼
Event Store   ← new events appended
```

An automation slice is a **state-change slice with a reactor**. Always build the command handler first, then wire the processor.

---

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the command being fired by the automation
- **context** — bounded context
- **processors[]** — each processor defines:
  - `triggerEvent` — the event that starts the automation
  - `command` — the command to fire
  - `processorId` — unique kebab-case identifier
- **commands[]** — command data fields
- **events[]** — events emitted by the command

---

## Step 2 — Build the command handler

Follow the **build-state-change** skill to create:
- `{SliceName}Command.ts` (Command type, evolve, decide, handle{SliceName})
- `{SliceName}.test.ts` (DeciderSpecification tests)

**Do NOT create a `routes.ts`** for automations — the command is fired internally by the processor, not via HTTP.

Refer to the build-state-change skill for the full command handler structure.

---

## Step 3 — Ensure the trigger event type exists

The trigger event must be defined in `[Context]Events.ts`. If it belongs to a different context, import it from that context's events file.

If the trigger event is missing from the union type, add it:

```typescript
// in {TriggerContext}Events.ts
export type {TriggerEventName} = Event<'{TriggerEventName}', {
    id: string;
    // fields the processor will use to construct the command
}, CommonMeta>;

export type {TriggerContext}Events = /* existing */ | {TriggerEventName};
```

---

## Step 4 — Create `processor.ts`

File: `src/slices/{context}/{SliceName}/processor.ts`

```typescript
import {type {TriggerEventName}} from '../{TriggerContext}Events';
import {{SliceName}Command, handle{SliceName}} from './{SliceName}Command';
import {PostgresEventStore, PostgreSQLEventStoreConsumer} from '@event-driven-io/emmett-postgresql';
import {storeDlqMessage} from '../../../common/processorDlq';
import {v4} from 'uuid';

const PROCESSOR_ID = '{unique-kebab-case-processor-id}';

let _consumer: PostgreSQLEventStoreConsumer<{TriggerEventName}> | null = null;

export const processor = {
    start: async (eventStore: PostgresEventStore) => {
        _consumer = eventStore.consumer<{TriggerEventName}>();

        _consumer.reactor<{TriggerEventName}>({
            processorId: PROCESSOR_ID,
            processorInstanceId: v4(),   // new UUID each restart — enables competing consumers
            canHandle: ['{TriggerEventName}'],
            lock: {
                timeoutSeconds: 30,
                acquisitionPolicy: {type: 'retry', retries: 60, minTimeout: 1000, maxTimeout: 2000},
            },
            eachMessage: async (message) => {
                try {
                    console.log(`Processing ${message.type} for ${message.data.id}`);

                    const command: {SliceName}Command = {
                        type: '{SliceName}',
                        data: {
                            id: message.data.id,
                            // map fields from message.data to the command's data shape
                        },
                        metadata: {
                            correlation_id: message.data.id,
                            causation_id: message.metadata?.correlation_id,
                        },
                    };

                    await handle{SliceName}(message.data.id, command);
                } catch (err) {
                    console.error(`${PROCESSOR_ID}: failed to process message`, message.data, err);
                    await storeDlqMessage(PROCESSOR_ID, message, err);
                }
            },
        });

        _consumer?.start().catch(err =>
            console.error(`${PROCESSOR_ID} consumer error:`, err),
        );
    },

    stop: async () => {
        await _consumer?.stop();
    },
};
```

### Key decisions when filling in the template

**`PROCESSOR_ID`** — unique kebab-case string identifying this processor across restarts. Use format: `{slicename}-automation` (e.g. `assign-user-to-organization-automation`). Never reuse IDs between processors.

**`processorInstanceId`** — `v4()` UUID generated at startup. A new UUID each time the server restarts allows multiple competing consumers to run safely in parallel.

**`canHandle`** — must list only the exact event type string(s) this reactor listens to.

**`lock`** — do not change the lock configuration unless there is a specific reason. The defaults provide safe at-least-once delivery with retry.

**Metadata mapping:**
- `correlation_id` in the command → pass the trigger message's `id` (aggregate identifier)
- `causation_id` in the command → pass the trigger message's `metadata?.correlation_id`

**DLQ** — always wrap `eachMessage` in try/catch and call `storeDlqMessage` on failure. Failed messages are not retried automatically; the DLQ record allows manual reprocessing.

---

## Step 5 — Register the processor in application startup

Find the app startup file (usually `src/index.ts` or `src/server.ts`) where other processors are started. Add:

```typescript
import {processor as {SliceName}Processor} from './slices/{context}/{SliceName}/processor';

// during startup, after eventStore is initialized:
await {SliceName}Processor.start(eventStore);

// during shutdown:
await {SliceName}Processor.stop();
```

The `eventStore` instance is the one returned by `findEventstore()` — reuse the shared instance, do not create a second one.

---

## Step 6 — Verify the event store bootstrap

The event store **must** call `schema.migrate()` before any processor starts. Check `src/common/loadPostgresEventstore.ts`:

```typescript
export const findEventstore = async () => {
    // ...
    await eventStoreInstance.schema.migrate();  // ← must be present
    return eventStoreInstance;
};
```

If this line is missing, add it. Without it, the emmett schema functions (`emt_try_acquire_processor_lock` etc.) are not created and the reactor will fail to start.

---

## Processor patterns reference

### Single trigger event → single command (standard)

```typescript
eachMessage: async (message) => {
    const command: MyCommand = {
        type: 'MyCommand',
        data: {id: message.data.id},
        metadata: {
            correlation_id: message.data.id,
            causation_id: message.metadata?.correlation_id,
        },
    };
    await handleMyCommand(message.data.id, command);
},
```

### Conditional processing (skip if condition not met)

```typescript
eachMessage: async (message) => {
    if (!message.data.someField) {
        console.log(`Skipping — someField not set for ${message.data.id}`);
        return;
    }
    // proceed normally
},
```

### Multiple commands from one trigger

```typescript
eachMessage: async (message) => {
    await handleFirstCommand(message.data.id, firstCommand);
    await handleSecondCommand(message.data.id, secondCommand);
},
```

---

## Files to create / modify

```
src/slices/{context}/{SliceName}/
├── {SliceName}Command.ts    ← command handler (decide/evolve/handle) — see build-state-change
├── {SliceName}.test.ts      ← DeciderSpecification tests — see build-state-change
└── processor.ts             ← reactor (start/stop)

src/
└── index.ts (or server.ts)  ← register processor.start() / processor.stop()

src/common/
└── loadPostgresEventstore.ts ← verify schema.migrate() is called
```

---

## Checklist

- [ ] `PROCESSOR_ID` is unique across all processors in the codebase (grep to verify)
- [ ] `processorInstanceId` uses `v4()` — not a hardcoded string
- [ ] `canHandle` matches the exact event type string from `{Context}Events.ts`
- [ ] `eachMessage` is wrapped in try/catch with `storeDlqMessage` fallback
- [ ] Processor registered in application startup (start + stop)
- [ ] `schema.migrate()` is called in `loadPostgresEventstore.ts`
- [ ] No `routes.ts` created (automations are not exposed via HTTP)
- [ ] Command handler tests cover idempotency (what happens if the command fires twice)