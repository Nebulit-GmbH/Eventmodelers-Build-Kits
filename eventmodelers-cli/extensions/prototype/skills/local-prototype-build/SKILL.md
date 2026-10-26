---
name: local-prototype-build
description: Rebuild the local prototype page from the model JSON — only the slices whose model changed. Second half of every prototype change (after local-prototype-model), and the way to build the page for the first time. Use when slice.json files or local screens changed, or when asked to rebuild or build the prototype.
---

# Prototype build — JSON → page

The page `.prototype/index.html` is derived from the model: slice by slice, one block per slice, each carrying a hash of its slice. This skill makes the blocks match the JSON. It never edits the model — if the model is wrong, go back to `local-prototype-model`.

## Steps

1. **What changed.**
   ```bash
   {{CLI}} prototype status
   ```
   Lists every slice as `new`, `changed` or `unchanged`, and puts the blocks of unchanged slices into `.prototype/work/slices/`. The hash covers the slice's elements, scenarios and its screens — not its status or comments.
2. **Write a block for every `new` slice and patch the block of every `changed` one** in `.prototype/work/slices/<slice id>.html`, with exactly the `data-em-hash` that `status` printed. A `changed` slice's previous block is already in that file: change only what the model change touched (`Edit` the field, the `evolve` branch, the markup — never rewrite the block from nothing) and set the new hash. A `new` slice gets a whole block. Read the slice from `.slices/<context>/<slice>/slice.json` and its screens from `.prototype/screens/<node id>/` (`screen.json` + `page-N.html`).
   How to write a block — its logic from the scenarios, its part of the screen, its exact shape — is `references/block-rules.md`; follow its steps 4, 5 and 6, and the contract in `references/slices.example.html`. Ignore everything there about `connect`, MCP tools, reading from the board, `prototype.mjs` and uploading: the files above replace all of it.
3. **Assemble.**
   ```bash
   {{CLI}} prototype assemble
   ```
   Refuses while a flagged slice has no valid block — fix the block it names. The browser page reloads by itself.
4. **Report** how many slices you built, which were unchanged and kept, and any gap you ran into (a button the model gives no meaning, a command nothing issues, contradictory scenarios). Gaps are findings about the model: report them, do not fix the board from here, and do not "fix" them in a block.

Each slice is its own block — its own component(s), logic and specs — so a change to one slice touches one file and nothing else is rebuilt. Name the pieces after the model (`Customers`, `RegisterCustomerForm`), one component per command part and read-model part, so a patch is a few lines.

Never hand-edit `index.html` or a kept block expecting it to survive: the model is the source, and the next change to a slice rebuilds its block.

## Learnings from real builds

Things the block rules do not spell out, found while building a context from scratch:

- **Compact the model before reading it.** `slice.json` is mostly field boilerplate. Print one line per element (title, id, `copy`, `list`, fields with `(id)`/`(gen)`/`<-mapping`, INBOUND/OUTBOUND titles) and one block per specification with `node -e`, instead of reading nine files raw. The scenarios' `then` READMODEL steps usually carry no example fields — derive the expected rows from the `given` events.
- **Blocks are isolated.** Each block runs in its own `new Function`, so helpers (a shared shell, styles) must be repeated in every block that needs them — no shared top-level scope. Generating the blocks with a small script that prepends a shared snippet and fills id/title/order/hash from `.prototype/work/status.json` keeps nine blocks consistent; never put the closing script tag in the snippet.
- **Hooks.** `useNav()` returns `{ go, params }` and every part also receives `params` as a prop; `go(title, params)` replaces the params, so a screen that needs an id must get it from the previous `go`. Reached directly through its tab it has no params — default to the first row of the relevant read model rather than crashing. `useReadModel(name, params)` works across slices (the registry is global), which is how a sidebar or a heading can come from a read model another slice owns.
- **Linked copies (`elementCopy: true`) define nothing.** The slice holding a copy of a read model contributes only its screen part and its scenarios (`kind: 'readmodel'` against the original's name). The original's `evolve` must therefore satisfy the copy's scenarios too — read them all before writing it.
- **`expectEmptyList` fixes the row shape.** If a scenario expects `[]` while the parent entity still exists (a list with its only todo removed), the read model is flat — one row per child (`listId, listName, todoId, text`) — not one row per parent holding an array. Check every `expectEmptyList` scenario before choosing the shape.
- **Same screen name in several slices = one tab with stacked parts** in `order`. When a later slice shows the same screen in another state (empty state, after a rename), make each part render only its own state — the first returns `null` when the list is empty, the later one returns `null` when it is not — otherwise both render.
- **Generated ids.** A command field with `generated: true` is `ctx.uuid()` in `decide`; leave it out of the spec's `then` (it cannot match the scenario's example id), but keep non-generated ids (`listId`) in `when` and `then`.
- **Rejections check history by the id the scenario's `given` carries** (the reject scenarios often give only `todoId`/`listId`, not the full event) — match on that field alone.
- **Modal / overlay screens** (rename, delete confirmation) are drawn over another screen in the mockup. Build only the dialog the slice owns inside the same shell; the screen behind it belongs to another slice.
- **Gaps worth reporting:** a screen in the model with no button leading to it (here *Remove Todo* has no entry from *List Detail*; a small "Remove…" link was added only so the flow is reachable — report it as a modelling gap), and scenarios whose READMODEL steps have no field values.
