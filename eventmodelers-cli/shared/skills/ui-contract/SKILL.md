---
name: ui-contract
description: When handover is on (`run --handover`), publish the slice's UI contract — the OpenAPI operation of its endpoint (read = GET, write/state-change = POST) — as its own `## UI Contract` section in the slice's MARKDOWN node in the feedback lane, which the slice export carries in `slice.json` `notes[]` — so the UI build kit finds the contract in one lookup instead of parsing the whole note. Called by every build-state-view / build-state-change skill after the endpoint is built. A build kit can override it by shipping its own `ui-contract` skill.
---

# UI Contract

The UI build kit builds the frontend against what the backend slice **actually exposes**. This skill
records that as a contract — the endpoint's **OpenAPI operation**, one per slice, in a fixed, machine-findable place.

> Invoke `connect` first if not already connected (`BOARD_ID`). Prefer `mcp__eventmodelers__*` tools;
> the REST equivalents are in `learn-eventmodelers-api`.
>
> **Override**: a build kit that needs a different contract shape or location ships its own
> `.claude/skills/ui-contract/SKILL.md`. The kit's copy replaces this one at install time (stack
> templates are applied after the shared skills). Callers only say "invoke `ui-contract`" — they never
> restate the format.

## When

**Only when handover is on** — the task request's `Handover: on|off` line (authoritative; the runner resolves `run --handover` over the project setting), else `"handover": true` in `.eventmodelers/config.json`. With handover **off/unset**, do nothing: publish no contract, write no `## UI Contract` section, and finish the slice as `Done` (Step 4). The contract exists only for the UI kit that picks up `Handover` slices.

At the end of building a slice, **after** the endpoint exists (so the contract describes the real
route, not the plan), before the final commit:

| Slice type | Contract kind |
|---|---|
| `STATE_VIEW` (READMODEL) | **read** — `GET` |
| `STATE_CHANGE` (COMMAND) | **write** — `POST` (a state change) |
| `AUTOMATION` | none — no UI counterpart, skip |

## Step 1 — Derive the OpenAPI operation from the built endpoint

Never copy from the plan — the contract describes what was built. The contract **is** the endpoint's
OpenAPI 3 operation (one path, one verb) — no second, hand-made shape.

1. **Use the source the stack names.** If the calling `build-state-view` / `build-state-change`
   skill's `## UI Contract` section points to the stack's machine-readable API description (e.g. the
   handler's `@openapi` block), take that operation **verbatim** — see the stack's
   `ui-contract-from-openapi.md`. Do not rewrite it.
2. **Otherwise read the endpoint's route/handler code** and write the equivalent OpenAPI operation:
   method, path, `parameters` (path / query / header), `requestBody` schema, and a response for the
   success status and for every error status the handler really returns.
3. **Trim to what a UI needs**: drop `tags`, internal notes and anything about storage or auth plumbing
   (keep `security` if set). Keep `summary`, `description`, parameter/field `example`s and the response
   descriptions — they carry the business meaning of each error status.
4. **Cross-check against `slice.json`**: the request-body / response property names must equal the
   command's / read model's `fields[]` (path parameters such as the generated id excepted). A mismatch
   is an implementation bug — fix the code, don't publish a contract that disagrees with `slice.json`.

## Step 2 — Write the `## UI Contract` section into the slice's MARKDOWN node

1. **Find the node, creating whatever is missing** — never skip or fail because it doesn't exist yet:
   1. `get_board_outline { boardId, chapterId }` → locate the slice's column and the chapter's
      `feedback` lane. **No feedback lane** → create it: `add_lane { boardId, timelineId, lanes: [{ type: "feedback", label: "Notes" }] }`
      (returns the `laneId`; a feedback lane sorts after the spec lane automatically).
   2. Look for a `markdown` node in the feedback lane in the slice's column. **None** → create it with a
      `node:created` event through `submit_node_events` (not `place_element` / cell-drop):
      `{ "id": "<fresh uuid>", "eventType": "node:created", "nodeId": "<fresh uuid>", "chapterId": "<chapterId>",
      "cellId": "<feedbackRowId>-<columnId>", "meta": { "type": "MARKDOWN", "title": "<slice title>",
      "description": "## UI Contract\n\n…" } }` — the new node's body is just the section in the format of item 3 below.
2. **Upsert only the section** (skip the read when you just created the node): read the node once (`get_node`), then replace the text from the
   `## UI Contract` heading to the next `## ` heading (or end of file) — or append it when absent.
   Leave every other section untouched. Write back `meta.description` via a `node:changed` event
   (`submit_node_events`; the content lives in `description`, never `content`).
3. **Section format** — exactly this, so it can be extracted with a single match:

````markdown
## UI Contract

**READ** `GET /api/customers/{customerId}/reservation` — <one-line purpose>

```yaml ui-contract
/api/customers/{customerId}/reservation:
  get:
    summary: ...
    parameters: [...]
    responses: {...}
```
````

`**READ**` for a `GET`, `**WRITE**` for a `POST`.

**Formatting is part of the contract.** The note renders as Markdown, so `meta.description` must contain
*real* line breaks — build the string with actual newlines (a multi-line string, or `\n` that the JSON
parser turns into a newline), never a single line and never a literal backslash-`n` in the stored text.
Blank line after the heading, blank line before and after the fenced block, the opening ```` ```yaml ui-contract ````
and the closing ```` ``` ```` each on their own line, and the YAML keeps its indentation (2 spaces). After
the write, read the node back once (`get_node`) and check that `description` has multiple lines and no
literal `\n`; if it is flat, rewrite it before moving on.

The fenced block whose info string is `ui-contract` is the single source: the operation alone, keyed by its path — no `openapi:`/`info:`/`servers:`
wrapper, no restated table.

## Step 3 — Nothing else to write

The board is the single source. The slice export (`fetch` / `get_slice_data`, full projection) carries
every MARKDOWN node of the slice's column as a plain string in `slice.json` `notes[]` (the
`outline` / `fields` / `specs` projections leave `notes` out). The UI build kit therefore needs no
extra file and no board call.

## Step 4 — Completion status: `Handover` instead of `Done`

A slice with a UI is only finished once the UI kit has built its half. Whether this build kit hands
over is decided per run, in this order: the task request's `Handover: on|off` line (authoritative — the
runner resolves `run --handover` over the project setting), else `"handover": true` in
`.eventmodelers/config.json` (saved by `init --handover` / `eventmodelers config --handover on|off`).

- **On** — the build kit's "set the slice to `Done`" for a STATE_VIEW / STATE_CHANGE slice means
  **`Handover`** instead: after the contract is published and the commit/merge succeeded. Where the build
  kit's prompt says to call `update-slice-status` (a `tasks.json` task), set `Handover` through it,
  mirrored in the local `index.json`. For a run-loop build (the task request names the slice), record it
  with `npx @eventmodelers/cli slice-status Handover` — the run loop pushes it to the board; do not call
  `update-slice-status`. The UI kit claims `Handover` slices and sets `Done` when its UI is built.
- **Off / unset** — nothing changes: `Done`.
- Automations and translations have no UI → always `Done`.

## How the UI build kit looks the contract up

1. In the slice's `slice.json`, take the `notes[]` entry that contains a `## UI Contract` heading.
   Ignore every other entry.
2. In that entry, take the fenced block whose info string is `ui-contract` (```` ```yaml ui-contract ````)
   and parse just that YAML — an OpenAPI operation keyed by its path: request = path/verb +
   `parameters` + `requestBody`, success = the 2xx `responses` entry, errors = every non-2xx entry.
   Ignore the rest of the note.
3. No such entry → the backend slice isn't built yet, or the slice wasn't re-fetched since; re-fetch
   once, and if still absent build against `slice.json` and note the assumption.

## Re-running

Idempotent: a rebuilt slice overwrites its own section; it never duplicates the
section and never touches other sections of the note.
