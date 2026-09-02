# Node.js / TypeScript Event-Sourced Service

An event-sourced backend scaffolded by [`@eventmodelers/cli`](https://www.npmjs.com/package/@eventmodelers/cli).
It uses [Emmett](https://event-driven-io.github.io/emmett/) over Postgres for the event store,
Express for the HTTP layer, and Flyway for schema migrations.

Features are built as **vertical slices** under `src/slices/`, generated from the slices on your
Eventmodelers board by the agent in `.build-kit/`.

## Prerequisites

- Node.js 20 or later (the dev/start scripts use `node --env-file`)
- Docker and Docker Compose (for local Postgres)
- Flyway CLI on your `PATH` (for `npm run flyway:migrate`)
- [Claude Code](https://claude.com/claude-code) if you want to run the build agent

## Getting started

1. Start Postgres:

   ```bash
   docker compose up -d
   ```

2. Create your `.env`:

   ```bash
   cp .env.example .env
   ```

   Or run `./setup-env.sh` to be prompted for host, port, database, user and password.

3. Activate the baseline migration and apply it:

   ```bash
   mv migrations/V1__schema.sql.example migrations/V1__schema.sql
   npm install
   npm run flyway:migrate
   ```

   `V1__schema.sql` creates the processor dead-letter queue table the runtime expects. Add your own
   `V2__*.sql`, `V3__*.sql` and so on as slices introduce projections.

4. Run the server:

   ```bash
   npm run build   # slice routes and processors are loaded from dist/
   npm run dev
   ```

The API is on http://localhost:3000, with Swagger UI at http://localhost:3000/api-docs and the raw
OpenAPI document at http://localhost:3000/swagger.json.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the server locally with `.env` loaded |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Start in production mode |
| `npm test` | Run `src/**/*.test.ts` via `tsx --test` |
| `npm run flyway:migrate` | Apply pending migrations from `migrations/` |

## Learn more

- [Eventmodelers](https://eventmodelers.ai)
- [Emmett documentation](https://event-driven-io.github.io/emmett/)
