---
name: load-slice
description: Load all slices from the board via the slicedata API and persist them to the .build-kit-node/.slices/ directory hierarchy (index.json with full definitions, per-slice folders). Returns data for a specific slice by ID or title.
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

## Step 2 — Fetch all slices from the slicedata API

```bash
curl -s \
  -H "x-token: <TOKEN>" \
  -H "x-board-id: <BOARD_ID>" \
  -H "x-user-id: load-slice-skill" \
  "<BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/slicedata/slices"
```

Response shape: `{ "slices": [ { "id": "...", "title": "...", "status": "...", "contextName": "...", "contextId": "...", "comments": ["..."], ... } ] }`

Save the full array as `ALL_SLICES`.

---

## Step 3 — Persist slices to .build-kit-node/.slices/ directory

Apply the following logic for every slice in `ALL_SLICES`.

### Derive paths

- `contextSlug` = slugify `slice.contextName` if present, otherwise `"default"` — lowercase, spaces to hyphens, non-alphanumeric removed (e.g. `"My Ctx"` → `"my-ctx"`)
- `sliceFolder` = `slice.title` lowercased, with all spaces removed and the prefix `"slice:"` stripped  
  e.g. `"Beta Enable User for Beta Test"` → `"betaenableuserforbetatest"`
- `baseFolder` = `.build-kit-node/.slices/<contextSlug>/`
- `sliceDir`   = `.build-kit-node/.slices/<contextSlug>/<sliceFolder>/`

### Write files

```bash
mkdir -p ".build-kit-node/.slices/<contextSlug>/<sliceFolder>"
```

**`.build-kit-node/.slices/current_context.json`** — always overwrite:

```json
{ "name": "Beta" }
```

**`.build-kit-node/.slices/<contextSlug>/context.json`** — write once per context:

```json
{ "name": "Beta" }
```

**`.build-kit-node/.slices/<contextSlug>/<sliceFolder>/slice.json`** — the full slice object with the `index` field removed.

### Maintain `.build-kit-node/.slices/<contextSlug>/index.json`

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

Write the updated object back to `.build-kit-node/.slices/<contextSlug>/index.json`.

---

## Step 4 — Return the requested slice

If `sliceId` was given: find the entry in `ALL_SLICES` where `id === sliceId`.  
If `sliceTitle` was given: find the entry where `title` matches case-insensitively.  
If neither: return all slices.

If a specific slice was requested but not found, stop and list the available titles.

---

## Step 5 — Output

```
Slices loaded: <count> total
Persisted to: .build-kit-node/.slices/<contextSlug>/

Requested slice:
  Title:  <title>
  ID:     <id>
  Status: <status>
  Folder: .build-kit-node/.slices/<contextSlug>/<sliceFolder>/slice.json
```

Or if no filter was given:

```
All slices (<count>) — context: <contextSlug>:
  - <title> [<status>] → .build-kit-node/.slices/<contextSlug>/<sliceFolder>/
  - ...
```

Make the matched slice's `id`, `title`, `status`, and local folder path available to subsequent steps in the same session.