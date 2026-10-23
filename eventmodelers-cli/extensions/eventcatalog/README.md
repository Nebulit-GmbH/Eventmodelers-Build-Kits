# EventCatalog export

```
eventmodelers export --type eventcatalog [--context <name> | --all] [--local [path]] [--out <dir>] [--owner <id>]... [-i, --interactive] [--flows] [--check] [-f, --force]
```

Reads the slices of an event model and writes EventCatalog resources into `--out` (default: cwd), using the
**EventCatalog SDK** (`@eventcatalog/sdk`).

- Source: the board by default (no `--context` → pick from the board's contexts). `--local` reads `./.slices/`, then `./config.json`, or the path you give.
- The SDK is resolved from the target catalog's `node_modules` — it is not a dependency of this CLI. If the catalog lacks it, the CLI asks before running `npm install @eventcatalog/sdk` there.
- `--all` exports every context (board or local), one after the other. `--local` reads the `.slices/<context>/<slice>/slice.json` files `listen`/`fetch` write; with several contexts and no `--context`/`--all` it asks which.
- `--owner <id>` (repeatable) sets `owners` on every resource; the id must be a team or user in the catalog, or the linter flags it.
- `--check` compares the model with the last export (new / changed / removed) and writes nothing; exit 1 when out of sync.
- `--interactive` lists the resources that differ from the catalog as a checkable list (space toggles, `a` all/none, enter confirms), tagged `new` or `changed` and all pre-checked; in-sync ones are not shown, and a context with nothing pending prints "in sync" and exports nothing. Only the ticked ones are written, and ticked resources that already exist are overwritten (like `--force`, for those only).
- Flows are only exported with `--flows`; without it they (and the domain's reference to them) are left out. `--check` and `--interactive` honour it too.
- Resources already in the catalog (same id and version) are skipped. `--force` overwrites them, and — reading the board — asks for credentials again.

| Event model | EventCatalog |
|---|---|
| context | `domains/<Context>` |
| chapter (with `--flows`) | `flows/<Chapter>Flow` (steps ordered by first appearance, edges from dependencies) |
| events, commands | `events/`, `commands/` with `schema.json` (de-duplicated by title) |
| read models | `queries/` with `schema.json` |
| processors, screens | not exported: the event model has no services, so none is imported or created |

`model.js` (slices → model) and `render.js` (model → SDK resources) are pure; `write.js` is the only part that touches the catalog.
