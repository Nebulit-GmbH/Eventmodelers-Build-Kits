---
name: local-prototype-model
description: Turn a change request for the local prototype into edits of the model JSON (slice.json files) and the local screens — fields, descriptions, scenarios, examples, HTML screens. First half of every prototype change; invoke local-prototype-build afterwards. Use for any prompt about what the prototype should do, show or contain.
---

# Prototype model — prompt → JSON

The prototype is a reflection of the model. This skill is the only place a request becomes a change; it edits the model and nothing else. It never touches `.prototype/index.html`, a slice block, or the board.

## Where the model is

| What | Where |
|---|---|
| The model — one file per slice | `.slices/<context>/<slice>/slice.json` |
| HTML screens and sketches, one folder per screen | `.prototype/screens/<node id>/` — `screen.json` (title, type, marks, css frameworks, sketch) and `page-1.html`, `page-2.html`, … |
| The model as last fetched or synced | `.prototype/baseline/<slice id>.json` — never edit |

A slice's `screens[]` names the screen nodes it shows; the screen's folder is `linkedId` when set, else `id`.

## Steps

1. **Find what the request touches.** Read the affected `slice.json` files (and the chain they sit in — follow `dependencies`, INBOUND/OUTBOUND). Even a request that sounds like UI ("add a currency input") starts here: that is a new field on the command. A request that is purely visual (colours, spacing, a layout change) has no expression in the model: it is a change to the screen's HTML only, so make it there when asked — and say that it stays local.
2. **Edit the JSON.** Rules:
   - **Carry a change through the chain.** An attribute added to a command goes to its event and to every read model that shows it. A rename is applied everywhere the name appears: `mapping`s, scenario steps, screen fields and marks. Keep the `fields` shape exactly (`name`, `type`, `example`, `optional`, `cardinality`, `idAttribute`, `subfields`, `mapping`) and use the types the model already uses.
   - **Obvious typos and plainly wrong flags are fixed directly**, then carried through the chain; say what you fixed. Only a genuinely non-obvious call (changing what an element means) is stated instead of done.
   - **Keep ids.** Never change or reuse one. An element with `elementCopy: true` is a linked copy: change the original, not the copy.
   - **Carry only what is needed.** Commands and events carry the ids and fields they need, not copies of upstream payloads.
   - **Examples:** fill the values a scenario turns on; leave the rest empty.
   - **Scenarios** (`specifications`, `storylines`) are where the prototype's logic comes from — change them like any other model data. A failing scenario in the page means the logic is wrong, not the scenario.
   - **The screens are part of the chain — the prototype is built 1:1 from them.** A change that shows up in the UI is not done until the HTML screen shows it too: a new command field gets an input (bound by `screen.json`'s `fields`/marks, label ↔ field name) on the screen that fires the command; a new read-model field gets a column, card line or row value where that read model is shown; a rename changes the label, `name`/`id` attributes and marks; a removed field disappears from the markup. Edit the page files in `.prototype/screens/<node id>/` for every screen the slice shows — the shared ones too — and keep `screen.json` (`fields`, `marks`) in step. Match the markup, classes and CSS framework the screen already uses; no redesign. A new screen element the request does not name still follows the screen's existing look. A prototype whose screen lacks the change would show nothing of it.
   - **Never touch** `status`, `comments`, ticket or assignee data.
3. **Say what you changed**, per slice, and what will and will not reach the board:
   - synced: the `fields` and the `description` of an element that owns its node;
   - **synced too:** the pages of an HTML screen (`.prototype/screens/<id>/page-N.html`) — a screen edited here is written to the board as the `node:changed` of its `meta.pages` (never over a change the board made meanwhile).
   - **not synced** (do it when asked, and tell the person): new or removed elements, renames, wiring (`dependencies`), changes on linked copies, scenarios and storylines, and a sketch screen's drawing.

   A change the board made in the meantime is never overwritten — `sync` reports it as a conflict. Do not run `sync` unless asked; `{{CLI}} prototype sync --dry-run` shows what is pending.
4. **Invoke `local-prototype-build`** so the page reflects the edits.
