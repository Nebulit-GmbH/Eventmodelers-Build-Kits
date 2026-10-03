---
name: analyze-code-base
description: Uncover the business process behind an existing code base and build it on the board as an interview, iteratively — all chapters at high level first, then one chapter per pass, the person choosing which. Reads the code for hypotheses, asks one question at a time, draws as answers land. Use for "analyze this code base", "analyze this existing system", "reverse-engineer the model from the code", "model the legacy app".
---

# Analyze a Code Base

You are a facilitator running an interview, not a batch analyser. The code gives you a hypothesis; the person gives you the truth. **The board is the deliverable** — never hand over a JSON model, `config.json` or `high-level-analysis.json`. Everything you derive is created on the board as you go.

This skill owns the *conversation and the layering*. Everything that touches the board is **delegated** to the skill named in the table at the bottom — do not re-implement placement, scenarios or attributes by hand.

---

## Step 0 — Is there a code base?

Resolve the directory to analyse: `$EVENTMODELERS_CODE_DIR` if set (treat it as the repository root for every step below), otherwise the current directory. It must contain source code (`src/`, `pom.xml`, `build.gradle*`, `package.json`, `*.csproj`, …).

If it does not (an empty folder, a modeling-only workspace holding just `.claude/`, `.eventmodelers/` or `.agent-modeling-kit/`), **stop and answer in one or two plain sentences** — "There is no legacy code here to analyse; run this in the code base" — and do nothing else.

Then invoke `connect` (if not already connected). Prefer `mcp__eventmodelers__*` tools; if the MCP server is not connected, say so and continue over REST (see `learn-eventmodelers-api`) — never silently fall back to writing files.

**One agent, one identity on the board.** The canvas shows one robot avatar per agent id, and a write without a valid `x-agent-id` is shown as a *second*, anonymous robot. So every board write of this run must carry the agent id `connect` resolved (`AGENT_ID`): MCP calls get it from `.mcp.json`, but every `curl` fallback, upload script (e.g. screenshots) and Playwright helper must send `x-agent-id` too, and any subagent that writes to the board must be handed `agent=<AGENT_ID>` inline (a subagent is a fresh session and resolves nothing). Do the board writes yourself where you can; use subagents only for reading code.

---

## The goal — a model business people *and* AI can both read

The finished board has two readers, and every element has to serve both:

- **Business people** read titles, order, screens and scenarios. Titles are the words the business uses (*Visit Booked*), in the right sequence, with no technical terms — the "say it out loud" test.
- **AI** (a later agent generating code, tests or docs from the board) reads fields, descriptions, edges and scenarios, and cannot ask what you meant. So it needs what a person would take for granted: identifying fields with types and realistic examples, edges that show where data comes from (every field has an origin), Given/When/Then rules for the decisions that matter, and a `description` that says in a sentence what the element means and links back to the legacy source (class, endpoint, table).

Therefore: never trade one reader for the other. No cryptic titles to save space, no business prose without fields once the layer calls for them, no implicit order, no unexplained abbreviations. When the person uses a term the code doesn't (or the reverse), the board carries the business term and the `description` records the code term — so both readers can find each other. Where something is still unclear, a QUESTION comment makes the gap visible to both instead of hiding it.

---

## Principles

- **What to model:** business processes, state transitions, business rules hidden in code and tests, domain flows.
- **What not to model:** databases, frameworks, caching/logging/monitoring, class structure, UI styling.
- **Evidence, not elements.** Controllers, repositories, entities and `@Transactional` services tell you a business step exists — they are not the step. Model the *decision* it represents.
- **Say it out loud test.** If you cannot say an element's name to a domain expert and be understood, you are modeling the implementation — rename it. Class names, packages and endpoints go in the element's `description` (the link back to the legacy source), never in its title.
- **The user outranks the code.** On a conflict, model what the person says and record what the code does instead as a decision row in the feedback lane (see *Recording decisions*). Leave a QUESTION comment (`/wdyt`, `handle-comment`) only if the conflict is still unresolved.
- **Every decision leaves a trace.** Whatever you decided (mapping, order, naming, leaving something out) goes into the chapter's **Decisions** feedback lane with a file / class / method reference (see *Recording decisions*).
- **Never invent to fill a gap.** Not in the sources and not said by the person → ask; if it stays open, leave a QUESTION comment, not a guess.
- **Stop when they say stop**, at any depth. A shallow, correct model beats a deep, invented one.

## How to interview

- **Build what the code shows; ask only what it can't tell you.** Elements, fields, edges and scenarios that follow from the API, persistence, tests and UI go onto the board directly — no confirmation round, no tick-boxes for things you can see. Ask only about **order** and **unclear business requirements** (what the code leaves open or contradicts). When you ask, propose first: "From `VisitController` I see the owner picks a pet and then books a visit — is that the real sequence?" — never an empty question.
- **One question at a time**, answerable in a sentence or two. Never a wall of questions.
- The recurring question is **"what happens next?"** — walk the flow forward until the person says it ends, then backwards once: "what has to have happened before this?"
- **Order before placement.** Place where the code or UI make the order clear; where they don't, ask first. The timeline is only as right as its sequence.
- **Draw as you go.** Everything you derived or were told goes onto the board immediately — the person watches the model grow. Never disappear for ten tool calls.
- **Ask before every descent.** Which flow next and how much deeper — never decide alone.

### Be proactive — and ask about order above all

The code almost never says in which order the business does things: persistence writes have no sequence, controllers are independent, tests run in isolation. **Order is the person's knowledge, so ask for it — every round, unprompted.** Don't settle for the sequence the code happens to suggest.

**Order is what the timeline is made of.** An event model is a left-to-right sequence: a column's position *is* the business order, and a wrong order is a wrong model, not a cosmetic flaw. So never place an element at a position you guessed — place it where the code or UI make the order clear or the person confirmed it, and if the order is still open, hold the element back (or leave a QUESTION comment) rather than put it somewhere plausible. Chapters get their order the same way.

- Whenever you have two or more elements (events, chapters, milestones), propose an order *and* ask: "I'd put *Owner Registered* before *Pet Added* — does the clinic ever add a pet first, or can it happen in either order?"
- Ask what must have happened **before** each step (preconditions) and what **can run in parallel** or in any order.
- Ask where the **ordering of chapters** comes from: which flow starts the story, which depends on another, which repeat.
- Ask when a step can happen **again** (a second visit, a re-booking) and what it means then.
- In a chat, put an order question as a `poll` with the candidate orders, or a `confirm` on your proposal (see Chat mode).
- Don't wait for gaps to surface: whenever the code leaves you guessing — what triggers an automation, who is allowed to act, what happens on failure, whether a step is optional — ask, with your best hypothesis attached. Still one question at a time: pick the one that unblocks the most.

Questions to keep in rotation: *What happens next? · Which comes first — and can it be the other way round? · What must be true before this can happen? · Who triggers this? · What do they see before they decide? · Can this fail — and what does the business do then? · Is that the word the business uses? · Which flow now? · Deeper, or enough?*

---

## Reading the sources — four lenses

Every pass reads the code through the same four lenses; each produces *hypotheses* to put to the person, never elements on its own. Read only as deep as the current layer needs.

1. **API** (look hardest here) — REST controllers, routes, handlers, message listeners, scheduled jobs, outbound clients. Each entry point is a candidate **screen + command** (a person writes), **screen + read model** (a person reads) or **automation** (jobs, listeners, calls to other systems). Request/response payloads hint at fields; the caller hints at who triggers it.
2. **Tests** — test names, fixtures, assertions. Names reveal the business vocabulary; arrange/act/assert becomes Given/When/Then; error cases reveal the rules that matter. Fixtures are the source of realistic example values.
3. **Persistence** (look hardest here, too — *what gets saved*) — entities, tables, migrations, repositories. Every write is a candidate **event**. Writes show which state changes exist (→ events); relations show aggregate boundaries; status/enum columns show lifecycles; derived or joined queries show read models. Tables are evidence, never elements.
4. **UI** — templates, views, components, forms, navigation. Forms and buttons are where a person triggers a command; list and detail pages are read models; the page order is the flow; visible labels are the business words. **Ask the person once, early (Pass 0), whether a running UI exists** — URL, and login or test account if needed — and point the analysis at it. If there is none, say so and rely on the other three lenses.

   **With a URL, play with it using Playwright.** Prefer the Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, …) when they are available; otherwise drive it with a small Playwright script (`npx playwright`) kept in the scratchpad, not in the repository.
   - Walk it like a user: start at the entry page, follow the navigation, and note each page, form, button and list. Record, per step, what the person sees, what they can do, and what changed afterwards — that is a screen, a command and the event or read model behind it.
   - **The UI is the best source for what is possible and in which order.** Menus, buttons, wizard steps and enabled/disabled states show which actions exist and which come first; use the click path as the *proposed* order and put it to the person ("after *Add Pet* the app leads to *Book Visit* — is that the real sequence?"). The person still confirms the order before anything is placed.
   - **Screenshot every step and paste it onto the board as an image.** Save each screenshot (`browser_take_screenshot`, or `page.screenshot()` in the script) to the scratchpad, then place it as a SCREEN in the chapter, at the column of the step it belongs to, in walk order:
     `mcp__eventmodelers__create_screen { boardId, screens: [{ contentType: "image", chapterId, cellName, title: "<business name of the step>", imageBase64: "<base64 PNG, no data: URI prefix>", mimeType: "image/png", description: "Shows X. Arrived via: Y. Actions: A, B. Legacy: <URL / template>" }] }`
     The image is the real legacy screen kept as evidence. Where a person decides, `/html-screen` may add a clean wireframe later, but never replaces the screenshot unasked. Screenshot only what you walked, never invent screens. Mask personal data (names, emails) in the shots, or use test data.
   - Trigger a write (submit a form) only against a test or local system, or after the person agrees — it changes real data. Never on anything that looks like production without asking first. Create test data with a clear marker so it can be found again.
   - Confirm what you observed against the code: the UI shows the flow, the API/persistence lenses show what really happens behind it.
   - Not reachable, login missing or the page needs something you don't have: tell the person and carry on with the other lenses; never invent screens.
   - **No UI, and the code doesn't make the flow or order clear: ask the business expert (the human in the loop).** Don't guess from the code. Put your best hypothesis to them, one question at a time ("without a UI I can't see the sequence — does the clinic register the owner before adding a pet?"), and ask them to describe or sketch what people see and do. Their answer is the source for order and screens; if it stays open, leave a QUESTION comment instead of placing the element.

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

### Use the kit's modeling knowledge, not just this file

Before proposing elements for a chapter, apply the rules of the skills that own them — read `eventmodeling-core-rules` once per session, and consult as the flow demands:

- `eventmodeling-core-rules` — what each element is, lanes, naming, causality, the translation chain, anti-patterns to reject (CRUD names, events as commands, read models without a source).
- `eventmodeling-brainstorming-events` / `eventmodeling-plotting-events` — are the persistence writes complete and in business order?
- `eventmodeling-identifying-inputs` / `eventmodeling-identifying-outputs` — who issues each command, what each read model must show.
- `eventmodeling-designing-automation-chains` — every automation needs a todo-list read model; outbound calls and webhooks get their chain.
- `eventmodeling-translating-external-events` — external systems and their payloads.
- `eventmodeling-elaborating-scenarios`, `eventmodeling-checking-completeness`, `eventmodeling-validating-event-models-checklist` — deeper layers and the end-of-pass check.
- `eventmodeling-interview-protocol` — when to ask and how to record what was decided.

---

## Progressive elaboration — all chapters first, then one chapter per pass

### Pass 0 — all chapters, high level
1. Read the sources broadly through the four lenses (API, tests, persistence, UI) to spot the end-to-end business flows, and ask whether a running UI exists.
2. Derive the flows yourself and name them in business words (*Register an Owner*, *Book a Visit*). Ask only what the code can't tell you: the **order** of the flows, and what starts or ends one when that is unclear.
3. Create **one chapter per high-level flow** (`/timeline`; omit `x`/`y` so the backend stacks them without overlap) straight away — no confirmation round — in the best-known business order (ask where it is unclear). Inside each chapter sketch only the coarse milestones as slices — titles only (*Visit Booked*, *Pet Registered*; not operations on entities). Connect the chapters' order, not their internals. Give each chapter its **Decisions** feedback lane and its `Legacy Sources` note in the first column (see *Recording decisions*): folders, packages and key classes of the flow, plus why it sits where it does in the order.
4. Report the chapters back and **ask which chapter to start with**. Never pick for them.

### Pass N — detail the chosen chapter
1. The person picks one existing chapter. Work **in that chapter** — do not create a new one. Replace/expand its milestones into the real command / event / read model sequence (`/timeline`, `/place-element`), reusing what is already there.
2. Read the code behind each step (all four lenses) and build it directly. Interview only where the code stops: what happens next when the order is unclear, who is allowed to act, what the business does on failure.
3. Add this layer's detail (budget below) as you derive it, and as answers land. Each placement batch carries its decision rows: column notes in the **Decisions** lane, and the chapter note updated with new source areas and anything not modeled.
4. **The chapter grows — make room.** Expanding a chapter adds rows, columns and screenshots, so it gets bigger than when it was created and runs into the chapters below it. Run *Keeping chapters apart* (below) after every batch of placements, not only at the end.
5. Report what you uncovered, name the sub-flows found *inside* this chapter (offer them as new chapters if the person wants them), list the chapters still at high level, and ask: which chapter next, go deeper here, or stop?

Repeat until the person says stop. Each pass leaves the chapters not yet chosen untouched at high level.

### Detail budget per layer

| Layer | Elements | Fields | Examples | Scenarios | Screens |
|-------|----------|--------|----------|-----------|---------|
| **0 — High level** | one chapter per flow, business milestones as slices | none | none | none | none |
| **1 — Flow** | real command / event / read model sequence of one flow | only identifying and business-critical | one per key element | happy path + the one or two rules that matter | only where a person decides |
| **2+ — Deeper** | sub-flows, alternate paths, automations | full business field set incl. optional/list | realistic values from tests and fixtures | error cases and edge rules from the tests | sketches where a decision needs them |

Never add detail that belongs to a deeper layer. Every element must trace to sources you read or an answer the person gave. **Deeper never means more technical** — it means more business: decisions, rules, failure modes.

---

## Keeping chapters apart

Chapters are stacked vertically and the backend sizes the stack only at the moment a chapter is *created* — a Pass 0 chapter is small. Detailing it later makes it taller, so it overlaps the chapter below (the chapter's title, drawn under it, ends up on top of the next one). Placement never fixes this for you, so check it yourself:

1. Read every chapter's position and size (`get_chapter_bounds`; over REST the CHAPTER nodes from `GET /nodes?type=CHAPTER`).
2. Sort by `y`. For each chapter, the next one must start at least `y + height + 600` (room for the title and a gap).
3. Where it doesn't, move that chapter **and every chapter below it** down by the missing distance, so the order is kept: `move_timeline_position { boardId, timelineId, x, y }` (REST: `PUT /timelines/$TL/position`). Move bottom-up or by the same offset, never one chapter on top of another.
4. Re-read the bounds once to confirm nothing overlaps. Don't touch chapters that already have room.

Do this after every batch of placements in a chapter and before the end-of-pass report; a pass is not done while two chapters overlap.

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
2. **First column: the chapter note**, titled `Legacy Sources — <Chapter Name>`. It records where the flow lives in the code and the decisions that affect the whole chapter (where it starts and ends, its order relative to other chapters, what was left out).
3. **Every other column with a decision: one column note**, titled `Decisions — <column / step name>`. If a column already has one, **append** a row (`node:changed` on its `meta.description`) instead of adding a second note. Columns without a decision get no note.

Create notes with `submit_node_events` (`node:created`, `meta.type: "MARKDOWN"`, `cellId = "<feedbackLaneId>-<columnId>"`, markdown body in **`meta.description`**, not `meta.content`). Batch all notes of one placement round into one call. The REST fallback is in `eventmodeling-orchestrating-event-modeling/references/api-fallback.md` (Step 11).

**Write it as you go**: record the decision in the same batch as the elements it explains, not in a write-up at the end. An answer from the person is a decision too, so record it when you apply it.

**Use tables, not prose.** Each note is mostly markdown tables. Prose is allowed only for a one-line intro, never for something that fits in a row.

**References must be precise and resolvable.** Paths are relative to the analysed code root, with a line number where one exists: `src/main/java/org/acme/visit/VisitController.java:57`, plus the class and method (`VisitController#processNewVisitForm`), table, endpoint (`POST /owners/{id}/pets/{petId}/visits/new`), test (`VisitControllerTests#testProcessNewVisitFormSuccess`) or template (`templates/pets/createOrUpdateVisitForm.html`). Use folders and packages for anything bigger than one class. Never "the visit code". Record the commit the analysis ran against (`git rev-parse --short HEAD`) in the chapter note, so the line numbers stay meaningful.

**Chapter note** (first column):

```markdown
Analysed at commit `a1b2c3d`, code root `petclinic/`.

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
| 1 | Flow starts at *Pet Added* | A visit needs a pet (`Visit.petId` not null) | `Visit.java:34` | person |

## Not modeled
| Code | Reason |
|------|--------|
| `CacheConfiguration` | technical, no business decision |
```

**Column note** (each column with a decision):

```markdown
| # | Decision | Element(s) | Why | Source | Confirmed by |
|---|----------|------------|-----|--------|--------------|
| 1 | Insert into `visits` → event | *Visit Booked* | the only write of the booking | `VisitController.java:57` `#processNewVisitForm` | code |
| 2 | Title *Book Visit*, not *New Visit Form* | *Book Visit* | the business word | person, 2nd answer | person |

## Code vs. business terms
| Code | Board |
|------|-------|
| `description` (Visit) | *Reason for Visit* |
```

The `Confirmed by` column shows how far to trust a decision: `code` (derived from the sources), `person` (they said so) or `assumed` (neither, still open). An `assumed` row whose question can't be settled from the model also gets a QUESTION comment on the node (see *Principles*); the row records the assumption, the comment asks the question.

Element `description`s still carry their own short code reference (see *The goal*). The feedback notes add the *why* and the decisions that span several elements.

---

## Chat mode — snippets only for real questions

**When this run has a chat** (`CHAT_SESSION_ID` is set — the request came from the board's chat), a question the person answers with a pick is a **snippet** (`post_chat_message` with `snippet`; shapes in `/learn-eventmodelers-api` § 16 *Chat snippets*); an open question stays text. Without a chat, ask in prose.

**Snippets are not a confirmation gate.** Never post a `tasks` snippet to let the person tick what you derived from the code — you build that directly (see *How to interview*). Use a snippet only when you genuinely need the person:

1. **Order** — *"Which comes first?"* → a `poll` with the candidate orders; *"I'd put A before B — right?"* → a `confirm`.
2. **Unclear business requirement** — the code leaves it open or contradicts itself (*"Can a visit be cancelled?"*, *"Is the specialty optional?"*) → a `confirm` or `poll` with your hypothesis; an open answer stays text.
3. **Which chapter next** (end of every pass) → a `poll` with one option per chapter still at high level, plus *"Stop here"*. The pick arrives as the next chat message.

One question per message, with the best hypothesis attached. The answer arrives as a normal chat message: apply it to the board right away and continue with the next derivation or question. If nothing is unclear, don't ask — post a short note of what went on the board and the poll for the next chapter.

---

## Slice types (what to map the code to)

- **Write operation → STATE_CHANGE** — 1 Command + 1 Event (optional Screen, only after a STATE_VIEW).
- **Read operation → STATE_VIEW** — 1 Read Model (optional Screen, only after a STATE_CHANGE).
- **Background work → AUTOMATION** — 1 Processor + 1 Command + 1+ Events; never connects directly to an Event, always via an intermediate STATE_VIEW.

Naming, element types and edge rules: `eventmodeling-core-rules`. Fields can be single values or lists (cardinality "List"). Reuse before creating — query what is already on the board; never duplicate nodes.

---

## Delegate — which skill does what

| Intent | Skill |
|--------|-------|
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

Re-read the board (do not trust your memory) and check: layer discipline held, no chapters overlap, no duplicates, every element has an edge, descriptions carry the code reference, every decision of this pass is a row in the **Decisions** lane with a resolvable file / class reference, slice statuses set. Then report:

1. what you put on the board — titles, node IDs, chapter;
2. what is still open or unanswered;
3. the sub-flows you found;
4. the question — **which one next, or stop?**
