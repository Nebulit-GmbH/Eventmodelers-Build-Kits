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
- **storylines[]** (optional) — narrated walkthroughs that may yield additional projection tests; see Step 5b
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

## Step 5b — Storyline-derived tests (optional)

> **Note beats**: an entry with `type: STORYLINE_NOTE` is a note the board author placed in the walkthrough — its `description` is markdown context (an assumption, an external condition, a time gap), and its `id` is not a board node. Read it as background for the beats around it, but it is never a step: skip it when looking for COMMAND/EVENT/READMODEL beats or judging which beats are adjacent, and never turn it into test setup or an assertion on its own.

Some slices also have a `storylines[]` array in slice.json — narrated walkthroughs where the *same* read model repeats across several beats in one ordered `elements[]` list, showing its state at different points in a single flow. Most slices have no storylines; skip this step silently when `storylines[]` is empty or absent.

A storyline embedded in this slice's slice.json already belongs entirely to this slice — no need to match beats against `readmodels[]` by id/title. For each storyline, scan `elements[]` for pairs of adjacent `type: 'READMODEL'` beats with only EVENT beat(s) in between. Each such pair is a clean, self-contained projection test — the same shape as the specifications-derived tests above:
- `given` — the cumulative ordered EVENT beats from the start of the storyline through the intervening event(s), not just the two beats either side (earlier events in the same storyline still apply to accumulated state)
- `then` — assert the read model matches the later beat's shape, using its `fields`/`examples`/`expectEmptyList` exactly like a specifications-derived assertion

Put these in their own `describe` block per storyline, named after the storyline's `title` (e.g. `describe('Storyline: {storyline.title}', ...)`) — never merge them into the `specifications[]` suite; storylines are a supplementary narrative check, not a replacement for scenario coverage.

Skip (do not fabricate) a segment when:
- a COMMAND beat sits between two read-model beats — that half belongs to **build-state-change** (the command → event transition); only the event → read-model half after it is testable here
- a beat (e.g. SCREEN) can't be traced to an event affecting the read model

---

## Step 6 — Create `routes.ts`

File: `src/slices/{context}/{SliceName}/routes.ts`

> **Pattern reference**: the template below is the full pattern — auth, error mapping, and the mandatory `@openapi` annotation (Step 6a). If the project already has slices under `src/slices/`, open one of their `routes.ts` files first and match it.

```typescript
import {Request, Response, Router} from 'express';
import {WebApiSetup} from '@event-driven-io/emmett-expressjs';
import {requireUser} from '../../../supabase/requireUser';
import {{SliceName}ReadModel, tableName} from './{SliceName}Projection';
import {readmodel} from '../../../core/readmodel';
import createClient from '../../../supabase/api';

export const api = (): WebApiSetup => (router: Router): void => {

    /**
     * @openapi
     * /api/query/{slicename}-collection:
     *   get:
     *     tags: [{Context}]
     *     summary: {slice title from slice.json}
     *     description: {slice.json description — what this read model answers}
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: _id
     *         required: false
     *         schema:
     *           type: string
     *         description: When set, returns the single row with this id instead of the full collection
     *     responses:
     *       '200':
     *         description: The {SliceName} read model
     *         content:
     *           application/json:
     *             schema:
     *               oneOf:
     *                 - $ref: '#/components/schemas/{SliceName}ReadModel'
     *                 - type: array
     *                   items:
     *                     $ref: '#/components/schemas/{SliceName}ReadModel'
     *       '401':
     *         description: Not authenticated
     *       '500':
     *         description: Server error
     * components:
     *   schemas:
     *     {SliceName}ReadModel:
     *       type: object
     *       properties:
     *         id:
     *           type: string
     *         {fieldName}:
     *           type: string
     *           example: {the field's own example from slice.json, if it has one}
     */
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

### Step 6a — OpenAPI annotation (required)

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

- **path key** — the express path exactly as registered (a query read model has no path params; if you do add one, rewrite `:param` as `{param}`).
- **tags** — `[{Context}]`, the slice's context, so every slice of one context groups under one heading.
- **summary** — the slice title. **description** — slice.json `description`, plus any `comments[]` that explain what the read model answers.
- **schema properties** — exactly the read model fields from slice.json, the same set as the migration columns and the `{SliceName}ReadModel` type. Keep the JSON field spelling the route returns, not the snake_case column name, when they differ.
- **required** — omit it unless slice.json marks fields as mandatory; a projection row can legitimately be sparse.
- **example** — only from the field's own `example` in slice.json. A field with no example gets no `example:` line; do not invent one.
- **`components.schemas`** — declaring the read model once and `$ref`-ing it keeps the single-row and collection responses in sync. swagger-jsdoc merges the `components` block from every scanned file, so name the schema `{SliceName}ReadModel` to avoid colliding with another slice's.
- **responses** — `'200'` with the shape above, `'401'` whenever the handler enforces auth, `'500'`.

A placeholder left unreplaced ships straight into the published spec, and `npm run build` will not catch it — open `/api-docs` and look at the rendered endpoint before marking the slice `Done`.

---

## Step 7 — Wire up the route

Find the application's router registration (usually `src/index.ts` or `src/app.ts`) and add:

```typescript
import {api as {SliceName}Api} from './slices/{context}/{SliceName}/routes';

{SliceName}Api()(router);
```

---

## UI Contract

**Only when handover is on** (the task's `Handover: on` line, else `"handover": true` in `.eventmodelers/config.json`; with it off, skip this section): once the read endpoint is built, invoke the `ui-contract` skill (read contract, `GET`): it publishes
the endpoint's contract as the `## UI Contract` section of the slice's feedback-lane markdown node, which the slice export then carries in `slice.json` `notes[]`. Do not restate the format here — the skill owns it
(a build kit may override it).

**Source for this stack:** derive the contract from the handler's `@openapi` block, using `../build-state-change/references/ui-contract-from-openapi.md`.

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
- [ ] If `storylines[]` is present, each read-model-to-read-model transition relevant to this slice has a corresponding storyline test (or a documented reason it was skipped)
- [ ] Storyline-derived tests live in their own `describe` block, separate from the specifications suite
- [ ] Every field in the read model definition in slice.json has a column in the migration and a field in the TypeScript type — no invented columns
- [ ] Every event type in `events[]` is listed in the projection's `canHandle` — no assumed events
- [ ] No extra columns or fields were added beyond what slice.json defines
- [ ] No field names were assumed or guessed — if a field is not in slice.json, it is not in the code
- [ ] `routes.ts` carries an `@openapi` JSDoc block above every handler, and its path key matches the registered route
- [ ] The documented response schema lists exactly the read model fields from slice.json — same set as the migration columns and the `{SliceName}ReadModel` type