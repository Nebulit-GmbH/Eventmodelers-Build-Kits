---
name: build-state-view
description: Implements an emmett state-view slice (projection, tests, route, migration) from a slice.json definition
---

# Build State View Slice

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for all fields, events, and read model shape. Never invent fields not defined there.

---

## What a State View Slice is

A state-view slice is a **read model projection**. It listens to events from the event store and materializes them into a queryable PostgreSQL table. It does not emit events or process commands.

---

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the projection name
- **context** — bounded context
- **events[]** — events this projection handles (its `canHandle` list)
- **readModel / fields** — the columns of the output table
- **storylines[]** (optional) — present only when the board author built an explicit walkthrough for this flow; most slices have none. See "Storyline-derived tests" under Step 5.
> **Comments & description**: Each element (commands, events, readmodels, processors, screens, tables) carries a `comments: string[]` array (board comments on that node) and a `description` field. The slice itself also has `comments: string[]`. Use these as implementation hints — pass them as code comments, documentation, or validation logic where they add value. When done, resolve each used comment: `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (get comment IDs first via GET on the same path without the last two segments).


---

## Step 2 — Create the migration

File: `supabase/migrations/V{N}__{tablename}.sql`

Choose the next available version number by checking existing migration files.

```sql
CREATE TABLE IF NOT EXISTS "public"."{tablename}"
(
    id          TEXT PRIMARY KEY,
    -- other columns from read model fields in slice.json
    -- use snake_case for all column names
    created_at  TIMESTAMP DEFAULT NOW()
);
```

**Column type guide** — field `type` values are the canonical set from the [event-modeling-spec schema](https://github.com/dilgerma/event-modeling-spec/blob/main/eventmodeling.schema.json):

| Field type | SQL type |
|-----------|---------|
| `String` | `TEXT` |
| `UUID` | `TEXT` |
| `Int` | `INTEGER` |
| `Long` | `BIGINT` |
| `Double` | `DOUBLE PRECISION` |
| `Decimal` | `NUMERIC` |
| `Boolean` | `BOOLEAN` |
| `Date` | `DATE` |
| `DateTime` | `TIMESTAMP` |
| `Custom` | `JSONB` |

Nullable columns (`optional: true` on the field): allow `NULL` instead of adding a default.

The PRIMARY KEY column is the one used in `.onConflict(...)` in the projection.

---

## Step 3 — Create `{SliceName}Projection.ts`

File: `src/slices/{context}/{SliceName}/{SliceName}Projection.ts`

### Full structure

```typescript
import {postgreSQLRawSQLProjection} from '@event-driven-io/emmett-postgresql';
import {sql, SQL} from '@event-driven-io/dumbo';
import knex, {Knex} from 'knex';
import {type {EventA}, type {EventB}} from '../{Context}Events';

export const tableName = '{tablename}';

// TypeScript shape of one row in the read model
export type {SliceName}ReadModel = {
    id: string;
    // ... fields from slice.json readModel
};

// Knex here is used purely as a SQL builder/executor — it is never given its
// own connection string or pool. Building a query with `.toQuery()` never
// opens a connection at all. Any query that needs to actually *execute*
// inside evolve() (see "Async DB lookup" below) must be run via
// `.connection(context.connection.client)`, which pins it to the same raw pg
// client Emmett already holds open for this event's transaction — instead of
// opening a brand-new Postgres connection per event. That matters for two
// reasons: it avoids extra connection churn against the pool (a real
// contributor to connection exhaustion under load), and it means the query
// commits or rolls back atomically with the event append — a lookup or write
// done on a separate connection would not see the current transaction's
// uncommitted state and would not be undone if the append later fails
// (e.g. an optimistic-concurrency conflict).
export const getKnexInstance = (): Knex => knex({client: 'pg'});

type {SliceName}Events = {EventA} | {EventB};

export const {SliceName}Projection = postgreSQLRawSQLProjection<{SliceName}Events>({
    name: '{SliceName}Projection',
    canHandle: ['{EventA}', '{EventB}'],
    evolve: async (event, context): Promise<SQL[]> => {
        const db = getKnexInstance();

        switch (event.type) {
            case '{EventA}':
                // Insert with upsert — use for create/update events
                return [sql(db(tableName)
                    .withSchema('public')
                    .insert({
                        id:     event.data.id,
                        field1: event.data.field1,
                        field2: event.data.field2,
                    })
                    .onConflict('id')
                    .merge(['field1', 'field2'])
                    .toQuery())];

            case '{EventB}':
                // Delete — use for cancellation/removal events
                return [sql(db(tableName)
                    .withSchema('public')
                    .where({id: event.data.id})
                    .delete()
                    .toQuery())];

            default:
                return [];
        }
    },
});
```

Note: nothing here calls `db.destroy()` — this Knex instance never opens its own
connection or pool, so there is nothing to tear down. `evolve()`'s returned SQL
is executed later by Emmett itself (`context.execute.batchCommand(...)`), on
its own transaction — that part is already atomic with the event append
without any extra work.

### SQL operation patterns

**Insert with upsert (create or update):**
```typescript
return [sql(db(tableName)
    .withSchema('public')
    .insert({ id: event.data.id, field: event.data.field })
    .onConflict('id')
    .merge(['field'])   // list only columns to update on conflict
    .toQuery())];
```

**Update only (record already exists):**
```typescript
return [sql(db(tableName)
    .withSchema('public')
    .where({id: event.data.id})
    .update({field: event.data.field})
    .toQuery())];
```

**Delete:**
```typescript
return [sql(db(tableName)
    .withSchema('public')
    .where({id: event.data.id})
    .delete()
    .toQuery())];
```

**Async DB lookup before update** (when you need to read current state first):
```typescript
// This query actually executes (unlike the .toQuery()-only patterns above),
// so it MUST be pinned to Emmett's own client via .connection(...) — otherwise
// it opens a brand-new, untransacted Postgres connection just to do a read.
const row = await db(tableName)
    .withSchema('public')
    .where({id: event.data.id})
    .select('field')
    .connection(context.connection.client)
    .first();

if (!row) return [];

const newValue = row.field + delta;
return [sql(db(tableName)
    .withSchema('public')
    .where({id: event.data.id})
    .update({field: newValue})
    .toQuery())];
```

Do not call `db.destroy()` anywhere in `evolve()` — this Knex instance never owns
a connection or pool (see Step 3), so there's nothing to destroy, and destroying
it would tear down `context.connection.client` before Emmett is done with it.

---

## Step 4 — Register the projection in the event store

File: `src/common/loadPostgresEventstore.ts`

Add the new projection to the `projections.inline([...])` array:

```typescript
import {{SliceName}Projection} from '../slices/{context}/{SliceName}/{SliceName}Projection';

// inside getPostgreSQLEventStore options:
projections: projections.inline([
    // ... existing projections ...
    {SliceName}Projection,
]),
```

---

## Step 5 — Create `{SliceName}.test.ts`

File: `src/slices/{context}/{SliceName}/{SliceName}.test.ts`

Uses `PostgreSQLProjectionSpec` with a real PostgreSQL container (Testcontainers). Flyway runs actual migrations so the schema matches production exactly.

```typescript
import {before, after, describe, it} from 'node:test';
import {PostgreSQLProjectionAssert, PostgreSQLProjectionSpec} from '@event-driven-io/emmett-postgresql';
import {{SliceName}Projection} from './{SliceName}Projection';
import {PostgreSqlContainer, StartedPostgreSqlContainer} from '@testcontainers/postgresql';
import knex, {Knex} from 'knex';
import assert from 'assert';
import {runFlywayMigrations} from '../../../common/testHelpers';

const TEST_ID = 'test-id-001';

describe('{SliceName} Specification', () => {
    let postgres: StartedPostgreSqlContainer;
    let connectionString: string;
    let db: Knex;
    let given: PostgreSQLProjectionSpec<any>;

    before(async () => {
        postgres = await new PostgreSqlContainer('postgres').start();
        connectionString = postgres.getConnectionUri();

        db = knex({client: 'pg', connection: connectionString});

        await runFlywayMigrations(connectionString);

        // Insert any prerequisite rows required by foreign keys:
        // await db('parent_table').withSchema('public').insert({...});

        given = PostgreSQLProjectionSpec.for({
            projection: {SliceName}Projection,
            connectionString,
        });
    });

    after(async () => {
        await db?.destroy();
        await postgres?.stop();
    });

    it('spec: {SliceName} - inserts row on {EventA}', async () => {
        const assertReadModel: PostgreSQLProjectionAssert = async ({connectionString: connStr}) => {
            const queryDb = knex({client: 'pg', connection: connStr});
            try {
                const result = await queryDb('{tablename}')
                    .withSchema('public')
                    .where({id: TEST_ID})
                    .first();

                assert.ok(result, 'row should exist');
                assert.strictEqual(result.id, TEST_ID);
                assert.strictEqual(result.field1, 'expected-value');
            } finally {
                await queryDb.destroy();
            }
        };

        await given([{
            type: '{EventA}',
            data: {id: TEST_ID, field1: 'expected-value'},
            metadata: {stream_name: `{context}-${TEST_ID}`},
        }])
            .when([])
            .then(assertReadModel);
    });

    it('spec: {SliceName} - removes row on {EventB}', async () => {
        const assertReadModel: PostgreSQLProjectionAssert = async ({connectionString: connStr}) => {
            const queryDb = knex({client: 'pg', connection: connStr});
            try {
                const result = await queryDb('{tablename}')
                    .withSchema('public')
                    .where({id: TEST_ID})
                    .first();

                assert.strictEqual(result, undefined, 'row should be deleted');
            } finally {
                await queryDb.destroy();
            }
        };

        await given([
            {
                type: '{EventA}',
                data: {id: TEST_ID, field1: 'value'},
                metadata: {stream_name: `{context}-${TEST_ID}`},
            },
            {
                type: '{EventB}',
                data: {id: TEST_ID},
                metadata: {stream_name: `{context}-${TEST_ID}`},
            },
        ])
            .when([])
            .then(assertReadModel);
    });
});
```

Write one `it` block per specification in the slice.json. Use `given([events]).when([]).then(assertReadModel)`.

### Storyline-derived tests (optional)

`storylines[]` in slice.json is optional — present only when the board author explicitly built a walkthrough for this flow; most slices have none. When present, mine it for **additional** read-model-chain tests, on top of (never instead of) the specifications-derived tests above.

A storyline is `{ id, title, elements: [...] }`, where `elements` is an ordered list of beats — the same element can repeat to show its state at different points in the flow. A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need to match beats against `readmodels[]` by id/title. Just scan for a pair of adjacent beats that are both `type: READMODEL`, with only EVENT beat(s) between them and no COMMAND beat in that run. That pair is one self-contained projection test:

- `given` — the cumulative ordered events from the start of the storyline through the intervening event beat(s)
- `then` — assert the read model matches the later READMODEL beat's `fields`/`examples`/`expectEmptyList`, same as a specifications-derived assertion

Put these in their own `describe` block, named after the storyline, so they're never confused with the exhaustive `specifications[]` suite:

```typescript
describe('{SliceName} Storyline: {storyline.title}', () => {
    it('spec: {storyline.title} — after {EventA}', async () => {
        // same given([...]).when([]).then(assertReadModel) shape as above
    });
});
```

Skip a beat pair when a COMMAND beat sits in between (that half belongs to build-state-change's command-handler test, not this one) or when the run includes a SCREEN/AUTOMATION beat with no traceable event — don't fabricate a test for those; a one-line comment noting the storyline segment exists is enough.

---

## Step 6 — Create `routes.ts`

File: `src/slices/{context}/{SliceName}/routes.ts`

> **Concrete example**: `src/slices/example/routes.ts` — shows the full pattern with `requireUser`, `assertNotEmpty`, error mapping, and OpenAPI annotations. Read it before implementing.

```typescript
import {Request, Response, Router} from 'express';
import {WebApiSetup} from '@event-driven-io/emmett-expressjs';
import {requireUser} from '../../../supabase/requireUser';
import {{SliceName}ReadModel, tableName} from './{SliceName}Projection';
import {readmodel} from '../../../core/readmodel';
import createClient from '../../../supabase/api';

export const api = (): WebApiSetup => (router: Router): void => {

    router.get('/api/query/{slicename}-collection', async (req: Request, res: Response) => {
        try {
            const principal = await requireUser(req, res, true);
            if (principal.error) return;

            const id = req.query._id?.toString();
            const supabase = createClient();

            const data: {SliceName}ReadModel | {SliceName}ReadModel[] | null =
                id
                    ? await readmodel(tableName, supabase).findById<{SliceName}ReadModel>('id', id)
                    : await readmodel(tableName, supabase).findAll<{SliceName}ReadModel>({});

            const sanitized = JSON.parse(
                JSON.stringify(data ?? [], (_, value) =>
                    typeof value === 'bigint' ? value.toString() : value,
                ),
            );

            return res.status(200).json(sanitized);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ok: false, error: 'Server error'});
        }
    });
};
```

---

## Step 7 — Wire up the route

Find the application's router registration (usually `src/index.ts` or `src/app.ts`) and add:

```typescript
import {api as {SliceName}Api} from './slices/{context}/{SliceName}/routes';

{SliceName}Api()(router);
```

---

## Files to create / modify

```
src/slices/{context}/{SliceName}/
├── {SliceName}Projection.ts    ← projection logic
├── {SliceName}.test.ts          ← PostgreSQLProjectionSpec tests
└── routes.ts                    ← GET query endpoint

supabase/migrations/
└── V{N}__{tablename}.sql        ← table DDL

src/common/
└── loadPostgresEventstore.ts    ← add projection to inline([...]) list
```

---

## Checklist

- [ ] Migration file created with correct version number and all columns
- [ ] `tableName` constant matches the migration table name exactly
- [ ] Projection registered in `loadPostgresEventstore.ts`
- [ ] `canHandle` lists every event type the projection reacts to
- [ ] `getKnexInstance()` takes no connection string/pool — it's a pure SQL builder
- [ ] Any query in `evolve()` that actually executes (not just `.toQuery()`) is run via `.connection(context.connection.client)`
- [ ] No `db.destroy()` calls in `evolve()` — the projection never owns its own connection
- [ ] Tests use `runFlywayMigrations()` to apply the real schema
- [ ] One test scenario per specification in slice.json
o- [ ] Every field in the read model definition in slice.json has a column in the migration and a field in the TypeScript type — no invented columns
- [ ] Every event type in `events[]` is listed in the projection's `canHandle` — no assumed events
- [ ] No extra columns or fields were added beyond what slice.json defines
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
- [ ] If `storylines[]` is present, a storyline-derived test was added for every isolable read-model-chain transition (adjacent READMODEL beats with only EVENT beats between them)