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

**Column type guide:**

| Field type | SQL type |
|-----------|---------|
| string / UUID | `TEXT` |
| number (integer) | `INTEGER` |
| number (float) | `NUMERIC` |
| boolean | `BOOLEAN` |
| date | `TIMESTAMP` |
| nullable number | `INTEGER` (allow NULL) |

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

export const getKnexInstance = (connectionString: string): Knex =>
    knex({client: 'pg', connection: connectionString, pool: {min: 0, max: 1}});

type {SliceName}Events = {EventA} | {EventB};

export const {SliceName}Projection = postgreSQLRawSQLProjection<{SliceName}Events>({
    name: '{SliceName}Projection',
    canHandle: ['{EventA}', '{EventB}'],
    evolve: async (event, context): Promise<SQL[]> => {
        const db = getKnexInstance(context.connection.connectionString);

        try {
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
        } finally {
            await db.destroy();
        }
    },
});
```

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
const row = await db(tableName)
    .withSchema('public')
    .where({id: event.data.id})
    .select('field')
    .first();

if (!row) return [];

const newValue = row.field + delta;
return [sql(db(tableName)
    .withSchema('public')
    .where({id: event.data.id})
    .update({field: newValue})
    .toQuery())];
```

Always wrap in `try/finally` and call `db.destroy()` in the `finally` block.

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
- [ ] `finally { await db.destroy() }` present in every `evolve` handler
- [ ] Tests use `runFlywayMigrations()` to apply the real schema
- [ ] One test scenario per specification in slice.json