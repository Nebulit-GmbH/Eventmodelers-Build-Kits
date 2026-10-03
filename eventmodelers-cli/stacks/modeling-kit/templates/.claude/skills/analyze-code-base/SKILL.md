---
name: analyze-code-base
description: Uncover the business process behind an existing code base and build it on the board as an interview, iteratively — all chapters at high level first, then one chapter per pass, the person choosing which. Reads the code for hypotheses, asks one question at a time, draws as answers land. Use for "analyze this code base", "analyze this existing system", "reverse-engineer the model from the code", "model the legacy app".
---

# Analyze a Code Base

You are the **orchestrator** of an interview. The code gives you a hypothesis; the person gives you the truth. **The board is the deliverable** — never hand over a JSON model, `config.json` or `high-level-analysis.json`.

This skill owns only what is specific to legacy code: reading the sources, mapping code to elements, the layering of passes, and recording decisions with code references. Every modeling rule (naming, element types, chaptering, ordering, screens, scenarios, interviewing) lives in the skill named at each step — **read and follow that skill, don't restate or re-implement it here**.

---

## Step 0 — Is there a code base?

Resolve the directory to analyse: `$EVENTMODELERS_CODE_DIR` if set (treat it as the repository root for every step below), otherwise the current directory. It must contain source code (`src/`, `pom.xml`, `build.gradle*`, `package.json`, `*.csproj`, …).

If it does not (an empty folder, a modeling-only workspace holding just `.claude/`, `.eventmodelers/` or `.agent-modeling-kit/`), **stop and answer in one or two plain sentences** — "There is no legacy code here to analyse; run this in the code base" — and do nothing else.

Then invoke `connect` (if not already connected). Prefer `mcp__eventmodelers__*` tools; if the MCP server is not connected, say so and continue over REST (see `learn-eventmodelers-api`) — never silently fall back to writing files.

**One agent, one identity on the board.** The canvas shows one robot avatar per agent id, and a write without a valid `x-agent-id` is shown as a *second*, anonymous robot. So every board write of this run must carry the agent id `connect` resolved (`AGENT_ID`): MCP calls get it from `.mcp.json`, but every `curl` fallback, upload script (e.g. screenshots) and Playwright helper must send `x-agent-id` too, and any subagent that writes to the board must be handed `agent=<AGENT_ID>` inline (a subagent is a fresh session and resolves nothing). Do the board writes yourself where you can; use subagents only for reading code.

## Step 0b — Was this analysed before? Only read what changed

Read the board's chapters and look for their `Legacy Sources — <Chapter>` notes (column 0 of each chapter, see *The analysis log*). Every chapter keeps its own history, so check each one separately: take the commit of the **last row** of its *Analysis history*. If the code root is a git repository (`git rev-parse --is-inside-work-tree`):

```bash
git cat-file -e <hash>^{commit}                   # still reachable? (rebased/squashed history → no)
git log --oneline <hash>..HEAD -- <chapter folders> # which commits touched this chapter
git diff --stat <hash>..HEAD -- <chapter folders>   # folders from the note's "Where this flow lives"
git status --porcelain -- <chapter folders>         # uncommitted changes count too
```

- **Nothing changed** for a chapter → leave it alone; report it as *up to date since `<hash>` (<date>)*.
- **Something changed** → re-analyse **only the changed files** through the lenses below, update the elements and decision rows they touch (refresh line numbers in references to those files), and ask about what the diff can't explain. Files changed outside every chapter's folders are candidates for a new chapter or for a chapter's `Where this flow lives` — ask.
- **Hash not reachable**, `+dirty`, `no git`, or no history yet → say so and analyse the chapter fully (a `+dirty` row: at least the files the diff names plus those listed as dirty then).

Either way, append a row to the chapter's *Analysis history* (see *The analysis log*), also for *no changes*. With no notes on the board at all, this is a fresh analysis — continue with Step 1.

## Step 1 — Is there a running UI? (once, when the analysis starts)

Ask once, before reading the sources, and only when starting fresh (no chapters from this analysis yet): *"Is there a running instance I can inspect? URL, and a login or test account if needed."* Wait for the answer. Record it (URL or "no running UI") in each chapter's `Legacy Sources` note and reuse it on later passes. Skip it when the request already answers it.

Ask again mid-way only when it helps — typically when the order isn't clear from the code: *"I can't tell the order of these steps from the code. Is there a running UI I can use to check? Otherwise, here are my questions: …"*

---

## Principles specific to legacy code

Naming, what to model and the anti-patterns are in `eventmodeling-core-rules` (read it once per session); how to ask is in `eventmodeling-interview-protocol` and `/timeline` (*Facilitator principles*). On top of that:

- **Evidence, not elements.** Controllers, tables and services show a business step exists — they are not the step. Code names go in `description`, never in titles. A model must serve business readers (titles, order) and AI readers (fields, edges, descriptions with the code reference) alike.
- **Build what the code shows; ask only what it can't tell you** — the **order** (code rarely shows it; see `eventmodeling-plotting-events`) and **unclear business requirements**. Propose first: *"From `VisitController` the owner picks a pet and then books a visit — is that the real sequence?"* One question at a time.
- **Never place at a guessed position.** Where neither code, UI nor person settles the order, ask (see *Step 1*) or leave a QUESTION comment.
- **The user outranks the code.** Model what the person says; record what the code does as a decision row (see *Recording decisions*).
- **Never invent to fill a gap**, and **stop when they say stop**, at any depth.

---

## Reading the sources — four lenses

Every pass reads the code through the same four lenses; each produces *hypotheses* to put to the person, never elements on its own. Read only as deep as the current layer needs.

1. **API** (look hardest here) — REST controllers, routes, handlers, message listeners, scheduled jobs, outbound clients. Each entry point is a candidate **screen + command** (a person writes), **screen + read model** (a person reads) or **automation** (jobs, listeners, calls to other systems). Request/response payloads hint at fields; the caller hints at who triggers it.
2. **Tests** — test names, fixtures, assertions. Names reveal the business vocabulary; arrange/act/assert becomes Given/When/Then; error cases reveal the rules that matter. Fixtures are the source of realistic example values.
3. **Persistence** (look hardest here, too — *what gets saved*) — entities, tables, migrations, repositories. Every write is a candidate **event**. Writes show which state changes exist (→ events); relations show aggregate boundaries; status/enum columns show lifecycles; derived or joined queries show read models. Tables are evidence, never elements.
4. **UI** — templates, views, components, forms, navigation. Forms and buttons are where a person triggers a command; list and detail pages are read models; the page order is the flow; visible labels are the business words. Whether a running UI exists is asked in **Step 1**. Without one, rely on the other three lenses and ask where the order stays unclear.

   **With a URL, walk it via `discover-storyboard`** (URL already known — don't ask again; pass the flow as guidance and ask for screenshots). Its click path is the *proposed* order and its screens go into the chapter as evidence; confirm both against the API and persistence lenses. Submit forms only against a local or test system, or after the person agrees.

If the code is a generic engine (templates, schemas, configurable entities), model one real case it handles, not the engine (see *Concrete Over Generic* in `eventmodeling-core-rules`).

Where the lenses disagree (a route nobody calls, a table never written, a test for removed behaviour, a screen with no backend), that is a question for the person — not something to model.

---

## From code to elements — the mapping rules

Start with the **API** and **persistence** lenses; they carry the most signal. Tests and UI then confirm and name what they found.

| In the code | On the board |
|-------------|--------------|
| **Persistence write** — an insert/update/delete, a `save()`, a status change: *what gets saved* | an **EVENT**, past tense, in business words (`Visit Booked`, not `visits row inserted`). Every persisted change is a candidate event; the saved fields are the event's fields. Several writes in one call = one decision with possibly several events — ask. |
| **Inbound API call a person triggers** — a REST controller behind a form, button or page | a **SCREEN** that fires a **COMMAND** (write) or shows a **READMODEL** (read). The controller is evidence; the person's decision is the command. |
| **Inbound API call nobody types in** — a webhook, a message/queue listener, a scheduled job, a call from another system | an **AUTOMATION** (+ its COMMAND). A webhook or message from another system goes through the translation chain: external EVENT → todo-list READMODEL → translation AUTOMATION → internal EVENT. |
| **Outbound call to another system** — HTTP client, SDK, mail/SMS/payment/queue publish | an **AUTOMATION**: it reacts to an event (via its todo-list READMODEL), makes the call, and its COMMAND records the outcome as an EVENT (`Confirmation Mail Sent`, `Payment Failed`). |
| **Read endpoint / query / join** | a **READMODEL**, fed by the events behind the tables it reads. |

Rules of thumb: every API call is either a screen-driven command/read or an automation that does something; reaching out to other systems is typically an automation; a row that is only ever read, never written by this system, is reference data from outside — ask where it comes from instead of inventing an event. Class, table and endpoint names go in `description`, not titles.

---

## Progressive elaboration — all chapters first, then one chapter per pass

### Pass 0 — all chapters, high level
1. Read the sources broadly through the four lenses to spot the business workflows — walking the running UI from Step 1 via `discover-storyboard` if there is one.
2. Group them into chapters and create them as `eventmodeling-brainstorming-events` (§ *Group events by workflow* / *Create one chapter per group*) does — a chapter is a user journey, never one endpoint, controller or CRUD operation. Code is split by operation (`OwnerController#initCreationForm`, `#processFindForm`, `#showOwner`, `#processUpdateOwnerForm`); the story is not — registering, finding, viewing and updating an owner are **one** chapter. Order the chapters per `eventmodeling-plotting-events`; ask where it is unclear. Add the **Decisions** lane, put the `Legacy Sources` note into **column 0** (see *The analysis log*), then sketch only the milestones (titles only) **from column 1 on**.
3. Report the chapters and **ask which chapter to start with**. Never pick for them.

### Pass N — detail the chosen chapter
1. Work **in the chapter the person picked**, reusing what is already there. Model the **whole workflow**, not its first slice, by running the step skills on it in order:
   - `eventmodeling-plotting-events` — the events in business order, start to outcome;
   - `eventmodeling-storyboarding-events` — what the person sees after each event (e.g. *Owner Registered* → owner details page → add a pet);
   - `eventmodeling-identifying-inputs` / `eventmodeling-identifying-outputs` — commands and read models;
   - `eventmodeling-designing-automation-chains` / `eventmodeling-translating-external-events` — jobs, listeners, webhooks, outbound calls;
   - `eventmodeling-elaborating-scenarios` — rules from the tests (layer 1+ only).
   Feed each skill what the lenses and the mapping table give you; ask only where the code stops (see *Step 1* when the order is unclear).
2. Stay within the layer's detail budget (below). Every placement batch carries its decision rows (see *Recording decisions*).
3. Re-space the chapters (see *Keeping chapters apart*) after every batch.
4. Append this pass's row to the chapter's *Analysis history*.
5. Report, name the sub-flows found inside this chapter, and ask: which chapter next, go deeper here, or stop?

Repeat until the person says stop. Chapters not chosen stay at high level.

### Detail budget per layer

| Layer | Elements | Fields | Examples | Scenarios | Screens |
|-------|----------|--------|----------|-----------|---------|
| **0 — High level** | one chapter per flow, business milestones as slices | none | none | none | none |
| **1 — Flow** | real command / event / read model sequence of one flow | only identifying and business-critical | one per key element | happy path + the one or two rules that matter | only where a person decides |
| **2+ — Deeper** | sub-flows, alternate paths, automations | full business field set incl. optional/list | realistic values from tests and fixtures | error cases and edge rules from the tests | sketches where a decision needs them |

Never add detail that belongs to a deeper layer. Every element must trace to sources you read or an answer the person gave. **Deeper never means more technical** — it means more business: decisions, rules, failure modes.

---

## Keeping chapters apart

A chapter is sized when it is created, so detailing it later makes it overlap the chapter below. After every batch: read `get_chapter_bounds`, and wherever the next chapter starts above `y + height + 600`, move it **and every chapter below it** down by the missing distance (`move_timeline_position`), keeping their order. A pass isn't done while two chapters overlap.

---

## Recording decisions — the feedback lane

Every decision you make while turning code into the model is recorded **on the timeline, where it applies**, with a reference back to the code it came from. A later reader (the person, a colleague, an agent generating code) must be able to ask "why is this here, and where in the legacy code is it?" and find the answer on the board, not in your chat history.

**What counts as a decision** — record every one of these, never only the hard ones:

| Decision | Example |
|----------|---------|
| Code construct → element | `VisitController#processNewVisitForm` + `visits` insert → *Book Visit* / *Visit Booked* |
| Order | *Owner Registered* before *Pet Added* — from the UI click path, confirmed by the person |
| Code term → business term | `PetType` → *Species*, the person's word |
| Person overrides the code | Code allows cancelling a visit; the person says it never happens → not modeled |
| Merged / split | Two writes in `OwnerService#save` → one event; one endpoint → two commands |
| Deliberately not modeled | `AuditLog` table, `CacheConfig` — technical, no business decision |
| Reference data | `specialties` is only read, never written → external, asked where it comes from |
| Assumption | No test covers the failure path; assumed the booking is rejected, marked *assumed* |

**Where it goes**:

1. Every chapter gets a `feedback` lane labelled **Decisions**. In Pass 0 pass it with the chapter's lanes when you create it (`lanes` on `/timeline`), otherwise add it with `add_lane { boardId, timelineId, lanes: [{ type: "feedback", label: "Decisions" }] }` (check `meta.timelineData.rows` for `type === "feedback"` first and reuse it).
2. **Column 0: the chapter note** — the analysis log, where the flow lives and the chapter-wide decisions; see *The analysis log* below.
3. **Every other column with a decision: one column note**, titled `Decisions — <column / step name>`. If a column already has one, **append** a row (`node:changed` on its `meta.description`) instead of adding a second note. Columns without a decision get no note.

Create notes with `submit_node_events` (`node:created`, `meta.type: "MARKDOWN"`, `cellId = "<feedbackLaneId>-<columnId>"`, markdown body in **`meta.description`**, not `meta.content`). Batch all notes of one placement round into one call. The REST fallback is in `eventmodeling-orchestrating-event-modeling/references/api-fallback.md` (Step 11).

**Write it as you go**: record the decision in the same batch as the elements it explains, not in a write-up at the end. An answer from the person is a decision too, so record it when you apply it.

**Use tables, not prose.** Each note is mostly markdown tables. Prose is allowed only for a one-line intro, never for something that fits in a row.

**Link elements, don't just name them.** Wherever a note mentions an element on the board, write `ref:<nodeId>`. It renders as the element's current title, and a click zooms the canvas to it (see `/learn-eventmodelers-api` *Linking to elements in markdown*). Use `[label](ref:<nodeId>)` only when the wording must differ. Take the id from your `node:created` or from a read. An element that isn't placed yet keeps its plain *italic* name until it is, and then the row is updated.

**References must be precise and resolvable.** Paths are relative to the analysed code root, with a line number where one exists: `src/main/java/org/acme/visit/VisitController.java:57`, plus the class and method (`VisitController#processNewVisitForm`), table, endpoint (`POST /owners/{id}/pets/{petId}/visits/new`), test (`VisitControllerTests#testProcessNewVisitFormSuccess`) or template (`templates/pets/createOrUpdateVisitForm.html`). Use folders and packages for anything bigger than one class. Never "the visit code". A line number is valid for the commit of the *Analysis history* row that wrote it; when a later pass re-reads a changed file, it updates the references into that file.

### The analysis log — column 0 of every chapter

Column 0 of every chapter holds **only** the chapter note, titled `Legacy Sources — <Chapter Name>`, in the **Decisions** lane — no slice, no element, no screen, in any lane. It records when the chapter was analysed, against which commit, how deep, where the flow lives in the code, and the decisions that affect the whole chapter (where it starts and ends, its order relative to other chapters, what was left out). The next run starts from it (*Step 0b*).

- **New chapter**: place the note first (`cellId = "<feedbackLaneId>-<firstColumnId>"`), then every element with `columnIndex ≥ 1`. If a skill or `/timeline` put an element into column 0 anyway, insert an empty column with `add_column { index: 0 }` and place the note there.
- **Existing chapter without the note, or whose column 0 holds elements**: `add_column { index: 0 }` and place the note there; move a `Legacy Sources` note found elsewhere into it (`place_element` `action: "move"`).
- **Every pass appends one row** to *Analysis history* (`node:changed` on `meta.description`) — never edit or drop earlier rows; the history is the record of what was analysed when. A Step 0b check that found nothing new gets a row too.
- **Commit** (if git is available): `git rev-parse --short HEAD` in the code root; if `git status --porcelain` lists changes in the chapter's folders, write `<hash>+dirty`. Without git, write `no git` — the date is then the only marker, and the next run analyses the chapter fully.

**Chapter note** (column 0):

```markdown
Code root `petclinic/` · running UI: http://localhost:8080 (test account `george`)

## Analysis history
| # | Date | Commit | Pass | Scope | Result |
|---|------|--------|------|-------|--------|
| 1 | 2026-09-28 | `a1b2c3d` | 0 — high level | whole code base | 4 milestones |
| 2 | 2026-10-01 | `a1b2c3d` | 1 — flow | `visit/`, `pet/` | 9 elements, 2 questions open |
| 3 | 2026-10-03 | `f4e5d6c` | diff since `a1b2c3d` | `VisitController.java`, `schema.sql` | *Visit Cancelled* added, refs updated |

## Where this flow lives
| Area | Folder / package | Key classes |
|------|------------------|-------------|
| API | `src/main/java/org/acme/visit/` | `VisitController` |
| Persistence | `src/main/resources/db/schema.sql` | `visits` table, `VisitRepository` |
| Tests | `src/test/java/org/acme/visit/` | `VisitControllerTests` |
| UI | `src/main/resources/templates/pets/` | `createOrUpdateVisitForm.html` |

## Chapter decisions
| # | Decision | Why | Source | Confirmed by |
|---|----------|-----|--------|--------------|
| 1 | Flow starts at ref:<petAddedId> | A visit needs a pet (`Visit.petId` not null) | `Visit.java:34` | person |

## Not modeled
| Code | Reason |
|------|--------|
| `CacheConfiguration` | technical, no business decision |
```

**Column note** (each column with a decision):

```markdown
| # | Decision | Element(s) | Why | Source | Confirmed by |
|---|----------|------------|-----|--------|--------------|
| 1 | Insert into `visits` → event | ref:<visitBookedId> | the only write of the booking | `VisitController.java:57` `#processNewVisitForm` | code |
| 2 | Title *Book Visit*, not *New Visit Form* | ref:<bookVisitId> | the business word | person, 2nd answer | person |

## Code vs. business terms
| Code | Board |
|------|-------|
| `description` (Visit) | *Reason for Visit* |
```

The `Confirmed by` column shows how far to trust a decision: `code` (derived from the sources), `person` (they said so) or `assumed` (neither, still open). An `assumed` row whose question can't be settled from the model also gets a QUESTION comment on the node (see *Principles*); the row records the assumption, the comment asks the question.

Element `description`s still carry their own short code reference. The feedback notes add the *why* and the decisions that span several elements.

---

## Chat mode — snippets only for real questions

**When this run has a chat** (`CHAT_SESSION_ID` is set — the request came from the board's chat), a question the person answers with a pick is a **snippet** (`post_chat_message` with `snippet`; shapes in `/learn-eventmodelers-api` § 16 *Chat snippets*); an open question stays text. Without a chat, ask in prose.

This overrides the `tasks`-snippet chat mode of `/timeline`. **Snippets are not a confirmation gate.** Never post a `tasks` snippet to let the person tick what you derived from the code — you build that directly (see *Principles*). Use a snippet only when you genuinely need the person (the Step 1 question about a running UI comes first, as plain text, and only when the analysis starts):

1. **Order** — *"Which comes first?"* → a `poll` with the candidate orders; *"I'd put A before B — right?"* → a `confirm`.
2. **Unclear business requirement** — the code leaves it open or contradicts itself (*"Can a visit be cancelled?"*, *"Is the specialty optional?"*) → a `confirm` or `poll` with your hypothesis; an open answer stays text.
3. **Which chapter next** (end of every pass) → a `poll` with one option per chapter still at high level, plus *"Stop here"*. The pick arrives as the next chat message.

One question per message, with the best hypothesis attached. The answer arrives as a normal chat message: apply it to the board right away and continue with the next derivation or question. If nothing is unclear, don't ask — post a short note of what went on the board and the poll for the next chapter.

---

## Delegate — which skill does what

| Intent | Skill |
|--------|-------|
| Group workflows into chapters | `eventmodeling-brainstorming-events` |
| Order events / chapters | `eventmodeling-plotting-events` |
| What the person sees after each event | `eventmodeling-storyboarding-events` |
| Walk a running UI | `discover-storyboard` |
| Build / adjust the timeline (chapters, milestones, flow sequence) live | `/timeline` |
| Place a single COMMAND / READMODEL / EVENT / SCREEN / AUTOMATION | `/place-element` |
| Make a timeline element's slice explicit | `/eventmodeling-slicing-event-models` |
| Command / read-model / automation design rules | `/eventmodeling-identifying-inputs`, `/eventmodeling-identifying-outputs`, `/eventmodeling-designing-automation-chains` |
| Given/When/Then scenarios from the tests | `/eventmodeling-elaborating-scenarios` |
| Add or rename attributes along a chain | `/attributes` |
| Realistic example data from tests and fixtures | `/examples` |
| A screen where a person decides | `/html-screen` (wireframe sketch only on explicit request: `/storyboard-screen`) |
| Set a slice's status | `/update-slice-status` |
| Record a decision with its code reference | *Recording decisions* (MARKDOWN note in the **Decisions** feedback lane) |
| Open questions, unresolved code-vs-user conflicts | `/wdyt`, `/handle-comment` |
| Inspect what is already modelled | `/analyze-existing-model` |
| Validate before reporting completion | `/eventmodeling-validating-event-models-checklist` |
| Any endpoint or element type not covered above | `/learn-eventmodelers-api` |

Scenarios: only business rules found in tests and comments — not simple validations ("must be a number"). Only create a storyline when the person explicitly asks.

---

## End every pass the same way

Re-read the board (do not trust your memory) and run `eventmodeling-validating-event-models-checklist` on the chapter. On top of it, check what is specific to this skill: the chapter tells its workflow from trigger to outcome (not a single slice), layer discipline held, no chapters overlap, descriptions carry the code reference, every decision of this pass is a row in the **Decisions** lane, column 0 holds only the `Legacy Sources` note and its *Analysis history* has this pass's row. Then report:

1. what you put on the board — titles, node IDs, chapter;
2. what is still open or unanswered;
3. the sub-flows you found;
4. the question — **which one next, or stop?**
