---
name: analyze-legacy-system
description: Uncover the business process behind a legacy code base and build it on the board as an interview, iteratively — all chapters at high level first, then one chapter per pass, the person choosing which. Reads the code for hypotheses, asks one question at a time, draws as answers land. Use for "analyze this existing system", "reverse-engineer the model from the code", "model the legacy app".
---

# Analyze a Legacy System

You are a facilitator running an interview, not a batch analyser. The code gives you a hypothesis; the person gives you the truth. **The board is the deliverable** — never hand over a JSON model, `config.json` or `high-level-analysis.json`. Everything you derive is created on the board as you go.

This skill owns the *conversation and the layering*. Everything that touches the board is **delegated** to the skill named in the table at the bottom — do not re-implement placement, scenarios or attributes by hand.

---

## Step 0 — Is there a code base?

Resolve the directory to analyse: `$EVENTMODELERS_CODE_DIR` if set (treat it as the repository root for every step below), otherwise the current directory. It must contain source code (`src/`, `pom.xml`, `build.gradle*`, `package.json`, `*.csproj`, …).

If it does not (an empty folder, a modeling-only workspace holding just `.claude/`, `.eventmodelers/` or `.agent-modeling-kit/`), **stop and answer in one or two plain sentences** — "There is no legacy code here to analyse; run this in the code base" — and do nothing else.

Then invoke `connect` (if not already connected). Prefer `mcp__eventmodelers__*` tools; if the MCP server is not connected, say so and continue over REST (see `learn-eventmodelers-api`) — never silently fall back to writing files.

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
- **The user outranks the code.** On a conflict model what the person says and leave a QUESTION comment (`/wdyt`, `handle-comment`) on the node recording what the code does instead.
- **Never invent to fill a gap.** Not in the sources and not said by the person → ask; if it stays open, leave a QUESTION comment, not a guess.
- **Stop when they say stop**, at any depth. A shallow, correct model beats a deep, invented one.

## How to interview

- **Propose, then ask.** "From `VisitController` I see the owner picks a pet and then books a visit — does that match, and what happens after?" — never an empty question.
- **One question at a time**, answerable in a sentence or two. Never a wall of questions.
- The recurring question is **"what happens next?"** — walk the flow forward until the person says it ends, then backwards once: "what has to have happened before this?"
- **Order before placement.** Confirm the order, then place; the timeline is only as right as its sequence.
- **Draw as you go.** Every confirmed answer goes onto the board immediately (in a chat: every *ticked* answer — see Chat mode) — the person watches the model grow. Never disappear for ten tool calls.
- **Ask before every descent.** Which flow next and how much deeper — never decide alone.

### Be proactive — and ask about order above all

The code almost never says in which order the business does things: persistence writes have no sequence, controllers are independent, tests run in isolation. **Order is the person's knowledge, so ask for it — every round, unprompted.** Don't settle for the sequence the code happens to suggest.

**Order is what the timeline is made of.** An event model is a left-to-right sequence: a column's position *is* the business order, and a wrong order is a wrong model, not a cosmetic flaw. So never place an element at a position you guessed — place it where the person confirmed it goes, and if the order is still open, hold the element back (or leave a QUESTION comment) rather than put it somewhere plausible. Chapters get their order the same way.

- Whenever you have two or more elements (events, chapters, milestones), propose an order *and* ask: "I'd put *Owner Registered* before *Pet Added* — does the clinic ever add a pet first, or can it happen in either order?"
- Ask what must have happened **before** each step (preconditions) and what **can run in parallel** or in any order.
- Ask where the **ordering of chapters** comes from: which flow starts the story, which depends on another, which repeat.
- Ask when a step can happen **again** (a second visit, a re-booking) and what it means then.
- Put an order question into every snippet round (in chat: a `poll` with the candidate orders, or a `confirm` on your proposal).
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
   - Take snapshots/screenshots as evidence for what you propose ("the *Add Visit* form asks for date and description") and, where a person decides, as input for `/html-screen`.
   - Trigger a write (submit a form) only against a test or local system, or after the person agrees — it changes real data. Never on anything that looks like production without asking first. Create test data with a clear marker so it can be found again.
   - Confirm what you observed against the code: the UI shows the flow, the API/persistence lenses show what really happens behind it.
   - Not reachable, login missing or the page needs something you don't have: tell the person and carry on with the other lenses; never invent screens.

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
2. Interview the person to confirm the list: which flows does the business actually run, what starts each, where does each end? Name them in business words (*Register an Owner*, *Book a Visit*).
3. Create **one chapter per high-level flow** (`/timeline`), in business order. Inside each chapter sketch only the coarse milestones as slices — titles only (*Visit Booked*, *Pet Registered*; not operations on entities). Connect the chapters' order, not their internals.
4. Report the chapters back and **ask which chapter to start with**. Never pick for them.

### Pass N — detail the chosen chapter
1. The person picks one existing chapter. Work **in that chapter** — do not create a new one. Replace/expand its milestones into the real command / event / read model sequence (`/timeline`, `/place-element`), reusing what is already there.
2. Interview forward — what happens next, who does it, what do they see, what can go wrong — while reading the code that backs each step (all four lenses).
3. Add this layer's detail (budget below) as answers land.
4. Report what you uncovered, name the sub-flows found *inside* this chapter (offer them as new chapters if the person wants them), list the chapters still at high level, and ask: which chapter next, go deeper here, or stop?

Repeat until the person says stop. Each pass leaves the chapters not yet chosen untouched at high level.

### Detail budget per layer

| Layer | Elements | Fields | Examples | Scenarios | Screens |
|-------|----------|--------|----------|-----------|---------|
| **0 — High level** | one chapter per flow, business milestones as slices | none | none | none | none |
| **1 — Flow** | real command / event / read model sequence of one flow | only identifying and business-critical | one per key element | happy path + the one or two rules that matter | only where a person decides |
| **2+ — Deeper** | sub-flows, alternate paths, automations | full business field set incl. optional/list | realistic values from tests and fixtures | error cases and edge rules from the tests | sketches where a decision needs them |

Never add detail that belongs to a deeper layer. Every element must trace to sources you read or an answer the person gave. **Deeper never means more technical** — it means more business: decisions, rules, failure modes.

---

## Chat mode — snippets instead of prose

**When this run has a chat** (`CHAT_SESSION_ID` is set — the request came from the board's chat), questions the person answers with a pick are **snippets** (`post_chat_message` with `snippet`; shapes in `/learn-eventmodelers-api` § 16 *Chat snippets*), and nothing goes on the board until they tick it. Open questions ("what happens after the visit is booked?") stay text. Without a chat (terminal) everything works as written — ask in prose, draw immediately.

1. **Pass 0 — the chapters.** Post **one** `tasks` snippet with every candidate chapter you found, one tickable line each (`title` = business name of the flow, `description` = the milestones you saw and the code it came from). End the turn. The ticked ones become chapters, in the order listed.
2. **Which chapter next** (end of every pass): a **`poll` snippet** — one option per chapter still at high level, plus *"Stop here"*. End the turn. The pick arrives as the next chat message.
3. **Pass N — the detail.** Offer the elements, edges, fields and scenarios you found for the chosen chapter as **one** `tasks` snippet per round (one line per slice or rule, `description` = where it goes and the code reference), then one follow-up question in the same message — a pick (*"Can this fail?"* → `confirm`, *"Which comes first?"* → `poll`) is a snippet, an open question stays text. Put **every** finding of the round in the one snippet (it pages itself at 5). Nothing found: one line of text, no snippet.
4. **A code-vs-user conflict** is not worth a snippet on its own — fold it into the tasks snippet as a line *"Comment: code does X instead"* the person can tick.
5. **Applying the answer.** It arrives as a `CHAT` turn (`Please do these:` + the ticked titles, or ids when the list was long). Read your snippet back (`get_chat_session`), match the ticked tasks, and create **one prompt**: *"Apply these /analyze-legacy-system changes in chapter `<CHAPTER_ID>`: `<id> | <title>` per line"*. Unticked ones were declined — drop them. A prompt starting with **"Apply these /analyze-legacy-system changes"** is the applying run: skip the code reading and the offering, create what is listed through the delegated skills, then post one short chat message — what went on the board and the next question (item 2 or 3). This is how the model grows: *a snippet to tick → applied → the next snippet.*

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
| Questions, gaps, code-vs-user conflicts | `/wdyt`, `/handle-comment` |
| Inspect what is already modelled | `/analyze-existing-model` |
| Validate before reporting completion | `/eventmodeling-validating-event-models-checklist` |
| Any endpoint or element type not covered above | `/learn-eventmodelers-api` |

Scenarios: only business rules found in tests and comments — not simple validations ("must be a number"). Only create a storyline when the person explicitly asks.

---

## End every pass the same way

Re-read the board (do not trust your memory) and check: layer discipline held, no duplicates, every element has an edge, descriptions carry the code reference, slice statuses set. Then report:

1. what you put on the board — titles, node IDs, chapter;
2. what is still open or unanswered;
3. the sub-flows you found;
4. the question — **which one next, or stop?**
