---
name: bridge-spec-kitty-specify
description: "Adapter: generate a Spec Kitty mission spec.md (and auto-evaluate its quality checklist) from an Eventmodelers board's exported event model, instead of running the /spec-kitty.specify interview. Use when the user says \"use the event model as the spec\", \"sync the board to spec-kitty\", \"generate the spec from the event model\", or when a .slices/ export exists and a Spec Kitty mission needs to start or refresh from it."
---

# bridge-spec-kitty-specify

Replaces the human interview in `/spec-kitty.specify` with a direct read of an
Eventmodelers board export. The event model is the source of truth; `spec.md`
becomes a **generated, read-only artifact** derived from it. Everything
downstream of specify (`/spec-kitty.plan`, `/spec-kitty.tasks`,
implement/review/merge) is untouched — this skill only produces the two
artifacts that phase gate expects: `spec.md` and `checklists/requirements.md`.

Do not use this to hand-author or hand-edit `spec.md` — if the event model is
wrong, fix it on the board and re-run this skill. A `spec.md` produced here
that gets manually edited afterward will be silently overwritten on the next
sync; there is no merge/diff in this version (see Limitations).

## Inputs

The Eventmodelers `listen` server (`npx @eventmodelers/cli listen`) writes the
board export locally. Read it directly — do not call the board API:

- `.slices/current_context.json` → `{ "name": "<context>" }` — which context
  to ingest if the user didn't name one.
- `.slices/<context>/index.json` → `{ "slices": [{ id, slice, index, context,
  folder, status, group }] }` — the ordered slice list.
- `.slices/<context>/context.json` → context-level name/package info.
- `.slices/<context>/<folder>/slice.json` → full slice detail per the
  [event-modeling-spec](https://github.com/dilgerma/event-modeling-spec)
  contract: `commands[]`, `events[]`, `readModels[]` (projections/queries),
  `screens[]`, `automations[]`/`processors[]`, `specifications[]` (given/when/
  then), plus free-text `description`/`notes`.

If `.slices/` doesn't exist yet, stop and tell the user to run
`npx @eventmodelers/cli listen` (or `init-modeling` first if the kit isn't
installed) and push the board export before retrying.

## Flow

1. **Resolve the mission.** If an existing `kitty-specs/<slug>/meta.json`
   already points at this context (check `purpose_tldr`/a stored context
   reference), re-sync into it. Otherwise create a new mission dir the same
   way `/spec-kitty.specify` does: kebab-case name + 8-char ULID suffix,
   `mission_type: software-dev` (this adapter does not introduce a new
   mission type — see project memory on why). Write `meta.json` matching the
   shape in an existing mission (`mission_id`, `mission_slug`, `purpose_tldr`,
   `purpose_context`, `target_branch`, etc.).
2. **Load every slice** referenced in `index.json` by reading each
   `<folder>/slice.json`. Do not skip slices with empty `specifications` —
   surface them as gaps in the checklist instead (step 4).
3. **Compose `spec.md`** using the standard Spec Kitty template sections,
   sourced only from what the model actually states — never invent detail
   the board doesn't have:
   - **Purpose** ← `context.json` name/description, or ask the user for a
     one-paragraph purpose if the board has none.
   - **Primary User Story** ← walk the slices in `index.json` order (this is
     already the chronological/timeline order from the board) and narrate
     the SCREEN → COMMAND → EVENT → READMODEL flow across them.
   - **Acceptance Scenarios** ← one bullet per `specifications[]` entry,
     copied straight from its given/when/then — do not paraphrase away
     precision the model already captured.
   - **Edge Cases** ← `specifications[]` entries that describe rejection/
     negative/boundary behavior (reject, invalid, already-exists, etc.).
   - **Domain Language** ← distinct nouns from event/command/read-model field
     names and titles, deduped.
   - **Functional Requirements (FR-###)** ← one row per COMMAND (state-change
     slice) and per AUTOMATION slice; wording from the command/automation
     name + `description`.
   - **Non-Functional Requirements / Constraints** ← only from explicit
     `notes`/`description` content tagged as timing/authorization/volume
     constraints. If the model states none, leave the table empty — do not
     fabricate NFRs to fill it.
   - **Key Entities** ← distinct read-model/event payload shapes.
   - **Interfaces to Other Teams** ← any `TRANSLATION`-type slice or external
     system mentioned in a slice's `description`.
4. **Evaluate `checklists/requirements.md`** against the ingested model
   instead of a human review pass. Check an item only if the model
   demonstrably satisfies it:
   - "No [NEEDS CLARIFICATION] markers remain" → fails if any slice has an
     empty `specifications[]` or a `description` containing `TODO`/`TBD`.
   - "Requirements are testable and unambiguous" → fails if an FR/NFR row has
     no backing `specifications[]` entry.
   - "Non-functional requirements include measurable thresholds" → fails
     (leave unchecked, don't skip the row) if the NFR table is empty but the
     model contains AUTOMATION slices implying a timing constraint the board
     never made explicit.
   - Leave any check unchecked with a `## Notes` explanation when the event
     model genuinely doesn't provide enough to verify it — this checklist
     gates `/spec-kitty.plan`, so a false pass defeats the point of the gate.
5. **Hand off.** Once `spec.md` + `checklists/requirements.md` are written,
   tell the user the mission is ready for `/spec-kitty.plan` as normal — do
   not run plan/tasks yourself from this skill.

## Re-sync behavior

Re-running this skill against the same mission regenerates `spec.md` and
`checklists/requirements.md` wholesale from the current `.slices/` state.
There is no field-level diff against the previous generation — if the spec
needs to reflect board changes, re-run this skill rather than hand-patching
`spec.md`.

## Guardrail

If a required section can't be populated from the event model (e.g. no
Purpose anywhere on the board), ask the user rather than inventing one — an
invented Purpose defeats the reason this adapter exists (the event model,
not the LLM, is the source of truth for product intent).

## Limitations (by design, v1)

- Does not itself generate `tasks/WP##-*.md` from slices — see the companion
  `bridge-spec-kitty-tasks` skill, which enforces a 1:1
  slice-to-WP mapping when `wps.yaml` is written during
  `/spec-kitty.tasks-outline`.
- Does not introduce a new Spec Kitty mission type. Spec Kitty 3.2.5's
  built-in mission types are loaded from a flat directory inside the
  installed package (`doctrine/missions/mission_types/*.yaml`) via
  `MissionTypeRepository.default()`, and org-pack extension for the
  `mission_types` kind is unwired in this version (fragments only add
  governance-graph metadata, not an executable type). A real native mission
  type would require patching the installed `spec-kitty-cli` package itself.
  This adapter avoids that entirely — it stays inside `mission_type:
  software-dev` and only replaces the specify phase's *inputs*.