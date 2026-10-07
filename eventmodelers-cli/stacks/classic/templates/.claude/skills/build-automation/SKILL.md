---
name: build-automation
description: Implements an automation slice (react to a state change, issue a command) inside an existing codebase, using whatever reactive mechanism it already has per .build-kit/ARCHITECTURE.md — listener, after-commit hook, message consumer or scheduled job
---

# Build Automation Slice

> Before doing anything else, read the slice definition from `.slices/{Context}/{slicename}/slice.json`. This file is the **source of truth** for which trigger drives the automation and what command it fires — never invent fields not defined there.

> Then read `.build-kit/ARCHITECTURE.md` (run `/learn-architecture` if it is missing). Its **AUTOMATION** mapping decides which reactive mechanism this codebase uses.

---

## What an Automation Slice is

An automation reacts to something that happened (a trigger event, or entries showing up in a todo-list read model) and issues a command in response — without a user doing it.

In a CRUD codebase there is usually no event stream to subscribe to. The automation is built with whatever already reacts to state changes there: an in-process domain/application event listener, an after-commit hook, a message consumer, or a scheduled job that queries for pending work. An automation slice is a **state-change slice with a trigger**: build the command first, then wire the trigger.

---

## Step 1 — Read the slice.json

From the slice definition, extract:
- **sliceName** — the command being fired by the automation
- **context** — bounded context
- **processors[]** — the reactions this slice implements: the trigger event (or todo-list read model) and the command each one issues
- **commands[]** / **events[]** — the command fired and what it records
- **specifications[]** — test scenarios (given/when/then)
- **storylines[]** (optional) — present only when the board author built an explicit walkthrough for this flow; most slices have none. See "Storyline-derived tests" under Step 2.

> **Comments & description**: each element carries a `comments: string[]` array (board comments) and a `description` field — use them as implementation hints, and resolve consumed comments via `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve`.

---

## Step 2 — Build the command

Follow `/build-state-change` for this slice's command and events — all of its steps, tests and checks apply. If the command already exists (built by another slice), reuse it; do not duplicate it.

### Storyline-derived tests

If `storylines[]` includes a beat sequence running through this automation's trigger → this slice's command, the command test for that segment is already covered by build-state-change's own "Storyline-derived tests" step.

## Step 3 — Find the trigger point

Locate where the trigger event's state change happens in the code — the **Slice map** in `ARCHITECTURE.md` names the code of the Done slice that produces it. If the map has a Done automation slice, build this one the way that one is built (same mechanism, registration and test style); otherwise pick the mechanism from `ARCHITECTURE.md`:

| Codebase has | Build the automation as |
|---|---|
| in-process application/domain events (e.g. Spring `ApplicationEventPublisher`, MediatR notifications, Node `EventEmitter`) | a listener on the existing event for the trigger — or publish a new one from the trigger's service method the same way others are published |
| transactional outbox / message broker | a consumer on the existing topic/queue, registered like the reference consumer |
| scheduler / job framework | a scheduled job that queries the todo-list read model (or the trigger's persisted state) for pending items and fires the command per item |
| none of the above | the least invasive option consistent with the codebase: a direct call from the trigger's service method after it commits, or a scheduled job if the reaction must be decoupled/retried. Record the choice in `progress.txt` and in `ARCHITECTURE.md` so later automations reuse it |

Rules:
- Map trigger fields → command fields exactly as slice.json defines; no extra fields.
- The reaction must be **idempotent**: reprocessing the same trigger must not issue the command twice (check the resulting state, a processed-marker, or the todo-list query condition — whatever the codebase already uses).
- Follow the codebase's transaction boundaries: the command must not run inside a transaction that can still roll back the trigger unless the reference does exactly that.
- Never add a new messaging/scheduling library just for this slice.
- **Isolated and deletable**: the listener/consumer/job is its own class in the slice's own place (see *New slices — isolation*). Prefer subscribing to an existing event or querying for pending work over editing the trigger's service method; if a hook in that method is unavoidable (no event mechanism exists), keep it to a single call and list it under `Shared seams`.

## Step 4 — Register it

Register the listener/consumer/job the same way the reference one is (annotation, DI registration, scheduler config, worker entry point). Do not touch application bootstrap beyond what that registration requires.

## Step 5 — Write the tests

Besides the command tests from Step 2, write one test per `specifications[]` entry that exercises the **trigger**: set up the given state, fire the trigger the way it happens in production (publish the event, run the job once, call the consumer), and assert the command's effect — or that nothing happened when the spec expects no reaction. Follow the reference test style.

## Step 6 — Quality gate

Run the build command and the single-test command from `ARCHITECTURE.md` for the tests this slice added or changed. Do not run the full suite.

## Step 7 — Record the slice in the Slice map

Add (or update) this slice's row in the **Slice map** of `ARCHITECTURE.md`, with the trigger and every shared file it touched under `Shared seams`. Commit it with the slice.

---

## Checklist

- [ ] The command was built (or reused) via build-state-change, with all its specifications tested
- [ ] The trigger uses the codebase's existing reactive mechanism, registered like the precedent automation slice (or the reference)
- [ ] The automation is its own class; any hook into existing code is listed under `Shared seams` in its Slice map row
- [ ] Trigger → command field mapping matches slice.json exactly
- [ ] Reprocessing the same trigger does not issue the command twice
- [ ] Every specification has a passing test
- [ ] If `storylines[]` is present, its command segment is covered via build-state-change's storyline-derived tests
- [ ] No new framework, library or architectural style was introduced; any first-time mechanism choice is recorded in `ARCHITECTURE.md`
