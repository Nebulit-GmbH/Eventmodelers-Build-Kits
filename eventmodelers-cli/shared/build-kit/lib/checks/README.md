# Commit-scope guard checks

Every `*.cjs` file in this folder is loaded and run automatically by
`../check-commit-scope.cjs` against the staged changeset of a slice commit
(a commit that touches `src/slices/{context}/{slice}/**`). Files run in
filename sort order — that's why they're numbered.

## Adding a check

Create a new file here, e.g. `60-my-check.cjs`, exporting:

```js
'use strict';

module.exports = {
  name: 'my-check',            // short id, prefixed onto any violation it reports
  skipIfAlreadyFailing: false, // optional: true = skip this check once an earlier
                                // one already found a violation (use for slow checks,
                                // e.g. a build/typecheck — no point running it if the
                                // commit is already going to be rejected)
  run(ctx) {
    // Inspect ctx and return an array of violations. No violations → return
    // [] (or undefined/null).
    return [
      { path: 'src/slices/cart/AddItem/AddItemCommand.ts', reason: 'why this is a problem' },
    ];
  },
};
```

### `ctx` passed to every check

| field           | type            | meaning                                                              |
|-----------------|-----------------|-----------------------------------------------------------------------|
| `changes`       | `{status, path}[]` | staged files — `status` is git's single-letter code (`A`/`M`/`D`/...) |
| `touchesSlice`  | `boolean`       | always `true` — the runner only loads checks once this is true        |
| `repoRoot`      | `string`        | absolute path to the repo root (`git rev-parse --show-toplevel`)       |
| `SLICE_PATTERN` | `RegExp`        | matches a path inside a slice's own folder: `src/slices/{ctx}/{slice}/`|

### Return value

An array of `{ path, reason }` objects — one per violation. `path` should be
the offending file (or a synthetic label like `'(slice.json)'` if the problem
isn't tied to one staged file). `reason` is a short, human-readable sentence
explaining what's wrong; the runner prefixes it with `[<check name>]`.

Return `[]`, `undefined`, or `null` when there's nothing to report. Throwing
is treated as a violation too (`[<check name>] threw: <message>`), so a check
doesn't need its own top-level try/catch.

### Conventions used by the existing checks

- Prefer **not blocking** over a false positive when a check can't determine
  the answer confidently (e.g. slice.json isn't found, or a file's shape isn't
  recognized) — these are heuristics layered on top of the hard path-scope
  rules, not a full compiler/schema validator.
- If two checks would flag the *same file*, only the first one to run reports
  it (the runner dedupes by path) — so keep genuinely distinct concerns in
  separate files rather than trying to avoid overlap yourself.
