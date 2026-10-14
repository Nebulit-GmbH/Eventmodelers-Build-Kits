# UI Contract — take the operation from the `@openapi` block

Used by the `ui-contract` skill. This stack's `routes.ts` carries an `@openapi` JSDoc block above every
handler (guarded by the `openapi-annotation` commit check). The contract **is** that operation —
publish it as is, don't translate it into another shape.

1. Take the YAML from the handler's `@openapi` block (strip the ` * ` comment prefix) — one path, one verb.
2. Keep it keyed by its path (`/api/...:` → `get:`/`post:`), with `summary`, `description`, `parameters`,
   `requestBody` and every `responses` entry. Follow a `$ref` into `components.schemas` and inline it, so
   the operation is self-contained.
3. Drop `tags` and anything internal. Add nothing the block doesn't say — examples come from the block.
4. Write it as the ```` ```yaml ui-contract ```` block of the `## UI Contract` section, with real line
   breaks and 2-space indentation (see the skill's formatting rule).
