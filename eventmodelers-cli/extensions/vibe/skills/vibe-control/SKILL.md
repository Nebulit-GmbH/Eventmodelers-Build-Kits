---
name: vibe-control
description: Around every code change in a vibe-coding project — find out whether the code is covered by the event model, ask the person what to do when it is not, and always model the change first, code second. Use at the start of any run that will edit code in a folder with a .vibe/ directory, and for "is this covered by the model", "check coverage", "vibe check".
---

# Vibe control — is this code covered by the model?

The code is changed by hand or with you; the event model on the board is kept in step by detecting what changed (drift) and translating it. Only modules that were analysed are governed. This skill decides, per file, which case you are in and asks the person when it is not clear-cut. **Never a hard stop and never a silent carry-on — a question.**

## 1. Find the code, then check it

The prompt rarely names files ("add a description field"). Find the target code the ordinary way first — the entity, its handler, its form — then:

```bash
{{CLI}} vibe check <the files you are about to change> --json
```

It answers from `.vibe/baseline/` and git alone (no board, no network). Run it from anywhere under the project; `.vibe/` is found by walking up.

| Status | Meaning | You |
|---|---|---|
| `governed` | in a chapter analysed at depth ≥ 1, unchanged since its last analysis | model the change first, then change the code (step 3) — no question |
| `drifted` | in an analysed chapter, but code changed since its last analysis and was never translated | ask: translate it onto the model first, or carry on (step 2) |
| `uncovered` | in no analysed chapter, or one with milestones only | ask (step 2) |
| `free` | a chapter's *not modeled* path, or a folder the person said to leave alone | change it as asked |

## 2. Ask — one question per entry in `questions`

**Uncovered** — *"`src/billing/` is not covered by the model (3 files). What now?"* Exactly three options:

1. **Analyse it first** — the person runs `/analyze-code-base` for that chapter themselves (it is an interview; you cannot answer for them). Record it, say what to run, and stop *this* change until they have.
2. **Continue without the model this time** — change the code as asked; nothing goes to the board.
3. **Never ask about this folder** — change it as asked, and it stays free from now on.

Record the answer: `{{CLI}} vibe answer --folder <folder> --answer analyse|continue|ignore`. Only `ignore` outlives the answer.

**Drifted** — *"`Visits` changed since its last analysis (4 files). Translate that onto the model first?"* Yes → `vibe-translate` for that chapter, then carry on. No → carry on; it stays drifted and is asked again next time. (A full re-analysis of the chapter is `/analyze-code-base`, theirs to run.)

A run with nobody to answer (unattended) records the question as `CoverageQuestioned` and carries on with `continue` for that folder only — never with `ignore`.

## 3. Governed: model first, code second

**This is the rule, no matter how the person phrases the request.** They ask for a code change ("add a description field") without knowing the model comes first — that is not a reason to go code-first. Never change the code first and translate afterwards.

1. **Model it.** Put the requested change on the board with the modeling rules `vibe-translate` points to (read and follow, don't restate), on the chapter's existing elements.
2. **Then code it.** Change the code so it matches the model you just wrote. Only when `.build-kit/` exists may you instead set the affected slices to `planned` with `/update-slice-status` (never one that is `InProgress` — the build agent is on it) and leave the building to it.
3. **Close.** `vibe check` on the touched files must say `governed`, then `vibe baseline advance --chapter "<title>"`. Nothing is ever written into the source code for any of this; the analysis log is `.vibe/baseline/<chapter>.json` and the board's `Legacy Sources` note is rendered from it.

`vibe-translate` of an already-made code diff is only the catch-up for `drifted` code (step 2 above).
