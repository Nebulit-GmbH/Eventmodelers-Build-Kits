---
name: load-slice
description: Load all slices from the board via the slicedata API and persist them to the .build-kit/.slices/ directory hierarchy (index.json with full definitions, per-slice folders). Returns data for a specific slice by ID or title.
---

# Load Slice

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until the connect skill has completed.

---

## Step 1 — Parse arguments

From `$ARGUMENTS`, extract:

| Field | How to find it | Default |
|-------|---------------|---------|
| `sliceId` | UUID of the slice (SLICE_BORDER node ID) | optional — prefer over title |
| `sliceTitle` | slice title (case-insensitive match) | optional — used if sliceId missing |

If neither is provided, load and persist all slices without filtering.

---

## Step 2 — Fetch the slice(s) from the slicedata API

### When `sliceId` is given: fetch exactly that one slice — never all

Do **not** fetch the board's full slice data, and do not loop over contexts. Only the one slice's full
definition is fetched, and only that one is persisted in Step 3:

1. **Context known?** If the caller passed a `contextId` (or the chapter id), skip to 3.
2. **Otherwise locate it with one summary call** — `list_slices { "boardId": "<BOARD_ID>" }` (or the
   `slicedata/slices` curl below). This is a lookup only: take the entry whose `id === sliceId` and read
   its `contextName`. Don't persist or fan out over the rest of the list. If the id isn't in the list, stop
   and report it.
3. **Resolve the context id unambiguously** (see "A name is not a safe key" below — chapters can share a
   title), then fetch the full slice with one call:
   `get_slice_data { "boardId": "<BOARD_ID>", "contextId": "<contextId>", "sliceId": "<sliceId>" }`
   (curl: `GET …/slicedata?contextId=<contextId>&sliceId=<sliceId>`).
4. `ALL_SLICES` is then just that one slice; Step 3 persists only it.

A `sliceTitle` without an id is resolved to an id via the same one summary call (stop and ask if the
title matches more than one slice), then continues from step 3.

### When neither is given: load all slices

Prefer the MCP tool when `mcp__eventmodelers__*` tools are visible in this session:

```
mcp__eventmodelers__list_slices { "boardId": "<BOARD_ID>" }
```

This returns `{ "slices": [ { "id": "...", "title": "...", "status": "..." } ] }` — lighter than the full slicedata payload (no `contextName`/`contextId`/`comments`). If Step 3/4 below need those richer fields for a specific slice, follow up with:

```
mcp__eventmodelers__get_slice_data { "boardId": "<BOARD_ID>", "contextName": "<name>" }
```

This call stays full (no `projection`): Step 3 persists the complete slice object as `slice.json`, which the build skills read fields, specs and comments from. When only one slice is needed, pass `sliceId` as well.

(`get_slice_data` requires a `contextName` or `contextId`. If the context isn't already known, list the context names in one call — `mcp__eventmodelers__get_nodes { "boardId": "<BOARD_ID>", "type": "MODEL_CONTEXT", "projection": "line" }` (only titles needed; a timeline name works as `contextName` too, so fall back to `type: "CHAPTER"` with `projection: "line"` when there are no MODEL_CONTEXT nodes) — then map slices to contexts with `list_slices { "boardId": "<BOARD_ID>", "contextName": "<name>" }` per context. Don't `get_node` each `SLICE_BORDER`.)

**A name is not a safe key — chapters and contexts can share a title.** The backend resolves `contextName`
to the *first* chapter/context whose title matches (case-insensitive) and silently returns nothing
if that one holds no slices — even when a same-titled twin holds them. A `SLICE_NOT_FOUND` (404) or an
empty `slices: []` for a slice that `list_slices` clearly shows is therefore **not** proof the slice is
missing. Before trusting it:

1. List the chapters (`get_nodes { "boardId": "<BOARD_ID>", "type": "CHAPTER", "projection": "line" }`)
   and the MODEL_CONTEXT nodes. If two or more share the title in question, **warn in the output**
   (`Duplicate chapter title "<title>": <id1>, <id2>`) and retry the full fetch with **`contextId`**
   set to each candidate id until the slice is found — `contextId` is matched exactly, so it is
   unambiguous.
2. Only if it is not found under any candidate id is the slice really absent.

Prefer `contextId` over `contextName` whenever the id is known (a calling harness that already has the
chapter id, or the list entry's `contextId`).

**Fallback (no MCP):**

```bash
curl -s \
  -H "x-token: <TOKEN>" \
  -H "x-user-id: load-slice-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slicedata/slices"
```

Response shape: `{ "slices": [ { "id": "...", "title": "...", "status": "...", "contextName": "...", "contextId": "...", "comments": ["..."], ... } ] }`

Save the full array as `ALL_SLICES`.

---

## Step 3 — Persist slices to .build-kit/.slices/ directory

Apply the following logic for every slice in `ALL_SLICES` — **or, when `sliceId`/`sliceTitle` was given,
only for that one slice** (and only its own context's `index.json`). Don't rewrite 90 other slices'
folders and indexes to load one; they may hold uncommitted local changes.

**`slice.json` must be the full slice, never the list entry.** The `list_slices` / `slicedata/slices`
payload is a summary (id, title, status, type, context name — no commands, events, fields, specs or
comments). If the full fetch (Step 2) for a requested slice failed or came back without elements, do
**not** write the summary as `slice.json` — it reads as an empty slice and has made agents conclude
"nothing to build". Stop and report the failed fetch instead (see the duplicate-title handling in Step 2).

**Check for collisions before writing.** Two slices in one `<contextSlug>` whose `<sliceFolder>` is
identical (same title, or titles differing only by spaces/case) would overwrite each other, and so
would two contexts that slugify identically. Detect this before writing; on a collision, don't write
either, and report it: `Slice folder collision in <contextSlug>: "<title>" (<idA>, <status>) vs
"<title>" (<idB>, <status>)`. Also report same-titled slices that don't collide (different contexts) as
a one-line warning, so callers address slices by id.

### Derive paths

- `contextSlug` = slugify `slice.contextName` if present, otherwise `"default"` — lowercase, spaces to hyphens, non-alphanumeric removed (e.g. `"My Ctx"` → `"my-ctx"`)
- `sliceFolder` = `slice.title` lowercased, with all spaces removed and the prefix `"slice:"` stripped  
  e.g. `"Beta Enable User for Beta Test"` → `"betaenableuserforbetatest"`
- `baseFolder` = `.build-kit/.slices/<contextSlug>/`
- `sliceDir`   = `.build-kit/.slices/<contextSlug>/<sliceFolder>/`

### Write files

```bash
mkdir -p ".build-kit/.slices/<contextSlug>/<sliceFolder>"
```

**`.build-kit/.slices/current_context.json`** — always overwrite:

```json
{ "name": "Beta" }
```

**`.build-kit/.slices/<contextSlug>/context.json`** — write once per context:

```json
{ "name": "Beta" }
```

**`.build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json`** — the full slice object with the `index` field removed.

### Maintain `.build-kit/.slices/<contextSlug>/index.json`

Read the file if it exists, otherwise start with `{ "slices": [] }`.

Each entry in `index.json` contains the index metadata **plus** the complete slice definition fetched from the API:

```json
{
  "slices": [
    {
      "id": "d0dbc70c-f244-4048-886b-1d11e461f466",
      "slice": "Beta Enable User for Beta Test",
      "index": 0,
      "contextName": "Beta",
      "contextSlug": "beta",
      "folder": "betaenableuserforbetatest",
      "status": "Created",
      "definition": {
        "id": "d0dbc70c-f244-4048-886b-1d11e461f466",
        "title": "Beta Enable User for Beta Test",
        "status": "Created",
        "contextName": "Beta",
        "contextId": "..."
      }
    }
  ]
}
```

The `definition` field holds the full object returned by the API for that slice (all fields as-is).

**Merge rules:**
- If an entry with the same `id` already exists: update all fields and refresh `definition`; preserve any existing `assigned` field.
- If not found: append the new entry.

Write the updated object back to `.build-kit/.slices/<contextSlug>/index.json`.

---

## Step 4 — Return the requested slice

If `sliceId` was given: find the entry in `ALL_SLICES` where `id === sliceId`.  
If `sliceTitle` was given: find the entry where `title` matches case-insensitively.  
If neither: return all slices.

If a specific slice was requested but not found, stop and list the available titles — after ruling out the
duplicate-chapter-title case from Step 2. If several slices share the requested title, don't pick one:
list them with their ids, contexts and statuses and ask the caller to choose by id.

---

## Step 5 — Output

```
Slices loaded: <count> total
Persisted to: .build-kit/.slices/<contextSlug>/

Requested slice:
  Title:  <title>
  ID:     <id>
  Status: <status>
  Folder: .build-kit/.slices/<contextSlug>/<sliceFolder>/slice.json
```

Or if no filter was given:

```
All slices (<count>) — context: <contextSlug>:
  - <title> [<status>] → .build-kit/.slices/<contextSlug>/<sliceFolder>/
  - ...
```

Append any warnings collected above (duplicate chapter titles, same-titled slices, folder collisions):

```
Warnings:
  - Duplicate chapter title "Teams": d151f017-… , e985e6b3-… (slice found under e985e6b3-…)
```

Make the matched slice's `id`, `title`, `status`, and local folder path available to subsequent steps in the same session.
