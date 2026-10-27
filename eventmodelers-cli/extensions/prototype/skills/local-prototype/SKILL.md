---
name: local-prototype
description: Build the local prototype of an event model context — uses the model files already on disk (.slices/, .prototype/) or fetches a context from the board first, and builds the page from them. It does not run it — running is the CLI's `run --prototype`. Entry point of the local prototype; after it, every change request goes through local-prototype-model then local-prototype-build. Use for "build the prototype", "prepare the prototype of X", "fetch X and build the prototype".
---

# Prototype — build it

The prototype is a reflection of the model: the model JSON in `.slices/` (plus the screens in `.prototype/screens/`) is the truth, the page is built from it. This skill gets you from nothing — or from files already on disk — to a built page.

## Steps

1. **Is there a local model?** Look for `.prototype/state.json`.
   - **Yes → use the local files.** Do not connect, do not fetch: they may hold edits that are not synced yet. Go to step 3. (Only fetch again when the person asks for a refresh, with `{{CLI}} prototype fetch --context "<name>" --force`, and warn them that `--force` discards unsynced local changes — `{{CLI}} prototype sync --dry-run` shows what is pending.)
   - **No → step 2.**
2. **Fetch a context.** `init --prototype` normally fetches the model already (step 1 applies then); this is the fallback. The board credentials are in `.eventmodelers/config.json`; if they are missing, invoke the `connect` skill. The context is the one named in `$ARGUMENTS`; without one, list the choices and ask which (the MCP tools may not be available in a fresh session, so use the CLI):
   ```bash
   {{CLI}} prototype contexts
   ```
   Then:
   ```bash
   {{CLI}} prototype fetch --context "<name or id>"
   ```
   It writes the model to `.slices/<context>/<slice>/slice.json`, the screens to `.prototype/screens/<node id>/`, and a baseline copy that `sync` later diffs against.
3. **Build what is missing.** Run `{{CLI}} prototype status`. If any slice is `new` or `changed`, invoke the `local-prototype-build` skill.
4. **Do not run it.** This skill only builds. Tell the person to start the page themselves with `{{CLI}} run --prototype` (or `{{CLI}} prototype` for the player alone). Changes reach the board only when they ask for `{{CLI}} prototype sync`.
5. **Say how to continue:** describe a change in plain words — it goes into the model first (`local-prototype-model`), then into the page (`local-prototype-build`), and a running page reloads by itself.

Never edit the model or the page from this skill; it only prepares things.
