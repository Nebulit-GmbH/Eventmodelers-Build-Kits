---
name: release-notes
description: Write out release notes for the eventmodelers CLI, summarizing all git changes since the last published release, into eventmodelers-cli/RELEASE_NOTES.md
---

# Release Notes

Generates human-readable release notes for the `@eventmodelers/cli` package from git history, and writes them to `eventmodelers-cli/RELEASE_NOTES.md`. This is a repo-maintenance skill (git-based) — it does not talk to the eventmodelers board API.

---

## Step 1 — Find the last release boundary

The repo has no git tags, so "the last release" is anchored to the last commit that bumped the `version` field in `eventmodelers-cli/package.json` — purely local, no npm registry lookup (the registry can be ahead of git if a version was ever published from an uncommitted working tree, which has happened in this repo before).

```bash
git log -1 --format=%H -G'"version": "[0-9]' -- eventmodelers-cli/package.json
```

Use `-G` (regex diff match), not `-S` (pickaxe) — `-S'"version":'` looks for a change in how many times the literal string `"version":` occurs, but that key is present exactly once in every commit, so a value-only bump (`"0.0.36"` → `"0.0.37"`) never changes the count and `-S` silently matches the wrong (much older) commit. `-G` instead matches any commit whose added/removed diff lines match the pattern, which is what an edit to the version's value actually produces.

This is `LAST_RELEASE_COMMIT` — the most recent commit whose diff touched the `version` line. If it returns nothing (no version-bump commit exists yet), use the repo's root commit instead.

---

## Step 2 — Collect changes since then

```bash
git log LAST_RELEASE_COMMIT..HEAD --format='%h %s' -- eventmodelers-cli
```

Scope to the `eventmodelers-cli` directory — that's what actually ships in the npm package. Read the full commit messages (not just subjects) for anything non-obvious: `git log LAST_RELEASE_COMMIT..HEAD -- eventmodelers-cli`.

If there are zero commits in range, tell the user there's nothing new to release and stop — do not write an empty section.

---

## Step 3 — Summarize into categories

Group the commits into whichever of these sections apply (omit empty ones):

- **Features** — new commands, options, or capabilities
- **Fixes** — bug fixes
- **Changes** — behavior changes to existing commands that aren't strictly bug fixes
- **Chores** — internal cleanup, docs, dependency bumps (only include if user-visible enough to matter)

Write each entry as one plain-language bullet describing the *user-visible* effect, not the commit message verbatim — a CLI user reading this has never seen the diff. Merge multiple commits that describe the same change into a single bullet.

---

## Step 4 — Write the file

Read the current (unreleased) version from `eventmodelers-cli/package.json`'s `version` field — call it `CURRENT_VERSION`.

Prepend a new section to `eventmodelers-cli/RELEASE_NOTES.md` (create the file if it doesn't exist yet), keeping all previously written sections below it:

```markdown
## v<CURRENT_VERSION>

### Features
- ...

### Fixes
- ...
```

Do not rewrite or reword older sections that are already in the file — only ever prepend the new one.

---

## Step 5 — Report back

Tell the user:
- How many commits were summarized, and the commit range (`LAST_RELEASE_COMMIT..HEAD`)
- The version heading written
- The path to the file written

If the CLI's `release-notes` command (added separately) exists, mention that running `eventmodelers release-notes` will display this file.