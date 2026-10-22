# EventCatalog export

```
eventmodelers export --type eventcatalog [--context <name>] [--local [path]] [--out <dir>] [--owner <id>]... [-f, --force]
```

Reads the slices of an event model and writes EventCatalog resources into `--out` (default: cwd), using the
**EventCatalog SDK** (`@eventcatalog/sdk`).

- Source: the board by default (no `--context` → pick from the board's contexts). `--local` reads `./.slices/`, then `./config.json`, or the path you give.
- The SDK is resolved from the target catalog's `node_modules` — it is not a dependency of this CLI. If the catalog lacks it, the CLI asks before running `npm install @eventcatalog/sdk` there.
- `--owner <id>` (repeatable) sets `owners` on every resource; the id must be a team or user in the catalog, or the linter flags it.
- Resources already in the catalog (same id and version) are skipped. `--force` overwrites them, and — reading the board — asks for credentials again.

| Event model | EventCatalog |
|---|---|
| context | `domains/<Context>` |
| chapter | `flows/<Chapter>Flow` (steps ordered by first appearance, edges from dependencies) |
| events, commands | `events/`, `commands/` with `schema.json` (de-duplicated by title) |
| read models | `queries/` with `schema.json` |
| processors, screens | not exported: the event model has no services, so none is imported or created |

`model.js` (slices → model) and `render.js` (model → SDK resources) are pure; `write.js` is the only part that touches the catalog.
