---
name: eventmodeling-workshop-questions
description: The questions an event modeling facilitator asks about a screen, a button or a field — what happens, what data is stored, what comes next, which screen follows, which business rules apply, an example — and how to put them to people. One catalog for every place that asks them (the prototype's guided questions, /wdyt's open questions); a question can carry a scenario's state. Not a step of its own — referenced by /prototype, /wdyt and /apply-feedback. Do not use standalone.
---

# Workshop questions

What a facilitator asks in an event modeling workshop when pointing at a screen: **"what happens here?"** Asked of the people who know the business, one element at a time, in the order a user would meet them. The answers are what turns a screen into an event model — which is why they come back as feedback (`/apply-feedback`).

Shared by `/prototype` (the questions the player walks people through), `/wdyt` (the questions it shows the person) and `/apply-feedback` (reads the answers). They apply the rules of `eventmodeling-core-rules`; nothing is restated here.

## The catalog

Ask only what the model does **not** already answer — a question about something the board states (a field, an event, a scenario) is noise. Each question has a `category`:

| `category` | Asked about | Examples |
|---|---|---|
| `action` | a button or link | What happens when someone clicks this? What do they need to have filled in first? |
| `data` | a field or a form | What is stored when this is submitted? Is this entered or derived? Which of it is needed later, and where? |
| `next` | the result of an action | What happens after this — which screen is shown, what is the person told? What else starts because of it (a mail, a hand-over to someone)? |
| `rule` | a command that could refuse | What business rules apply here? When must this be refused, and what does the person see then? |
| `example` | any rule or number | Give a real example — a situation where this goes through, and one where it doesn't. (An answer becomes a Given/When/Then.) |
| `view` | a read model / list / total | Where does this come from? What does the list show when it is empty? Who sees which rows? |
| `who` | an action or a screen | Who does this — and who must not? |
| `time` | anything with a date or a wait | When does this happen, what if it is late, what if it is repeated? |

Wording: one question, plain business language, in the screen's own words ("What happens when someone saves a note?"), never a model term (command, event, read model). Pick the **one question per element that matters most**; a screen with ten questions is not guided, it is a form.

## Putting them in order — the guided tour

The questions are walked **along the timeline of the event model, left to right, as strictly as it can be**: the story the model tells is the story the person is guided through. Take the slices in timeline order (`order` in the prototype's `status.json`, the column order on the board) and, inside a slice, in the order its elements sit on the timeline — the screen the person starts on, the command they fire, the event that follows, the read model and screen that show the result, then the next slice's screen. The next question's screen is the screen the timeline leads to next, so **Next never jumps back**; a question about an earlier part of the story is asked when the tour passes it, not later.

Depart from the timeline only when it is unavoidable: a rule question that needs the situation a later slice creates (give it `setup` instead of moving it), or two lanes whose slices share a column (the lane whose action comes first goes first). Within one screen, top to bottom, actions before the consequences they have. Each answer should make the next question easier; at each point on the timeline ask the happy-path questions (`action`, `data`, `next`) before `rule`/`example`/`time` for the elements the path showed to be risky.

### Keep the tour moving forward — always ask what comes next

A tour that circles the same few screens teaches nothing new. Drive it **forward**:

- **At most two questions per screen** (the ones that matter most). A third question about the same screen waits until the tour has been through the rest.
- **Every action gets a `next` question**, asked right after its `action`/`data` question: "What happens after this — what does the person see, what else starts, who is told?" The answer is the next screen, event or automation on the timeline, so the tour has somewhere to go.
- **Ask where the story ends.** On the last screen of a chain, and on the last slice of the timeline, ask what happens after it — "What does the person do next? What happens a day later? Who takes over from here?" — and **again for every screen a `next` answer named that the model doesn't have yet** (a screen that doesn't exist has no tab, so the question hangs on the element that leads there — the last screen's button or result). That open end is how the model grows; the tour never just stops at the last modeled screen.
- **Regenerated, the tour moves on.** Questions already answered (they are left out, see the prototype skill) are not asked again, so the next run starts at the first screen that still has an open question — and the frontier of the tour keeps advancing along the timeline instead of staying where the first answers were given.
- Rule/example/time questions are the second pass: only after the happy path has been walked to its end, and only for the elements it showed to be risky.

## A question can set the scene (`setup`)

A question about a rule is best asked **in the situation it is about**: the order already shipped, the email already taken. That is a scenario's `given` — the same state `/prototype` applies when a scenario's ▶ is pressed.

- **From the model:** `setup: { "spec": "<title or id of a scenario>" }` — the scenario already exists; the prototype is put in its `given` state when the question is shown.
- **New:** `setup: { "given": [{ "type": "<EventType>", "data": { … } }] }` — a situation the model has no scenario for yet. Only values the question turns on; the rest empty (`feedback_scenario_step_fields_mandatory`-style: relevance is clear when only the decisive values are filled).

The `when` is not part of the setup: it is what the person does next.

## What the answers become

An answer arrives as feedback: `Question (<category>): … / Answer: …` on the element. `/apply-feedback` turns it into model changes — `rule` and `example` answers into **GWT scenarios** on the original element (`eventmodeling-elaborating-scenarios`; never on a `linkedTo` copy), `data` into fields, `next` into the following screen / event / automation, `view` into a read model (`eventmodeling-identifying-outputs`). An answer that contradicts the model is a question back, not a silent change.
