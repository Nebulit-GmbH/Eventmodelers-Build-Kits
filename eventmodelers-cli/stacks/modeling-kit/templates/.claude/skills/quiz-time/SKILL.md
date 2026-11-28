---
name: quiz-time
description: Quiz Time. Analyze a chapter or a whole board and quiz the team on its domain and business rules — the questions a business analyst would ask in a /wdyt, where the model already answers them. Single choice, multiple choice, true/false and free text, each with its answer, the rule behind it and the element it comes from. Always sent as one quiz snippet, never asked question by question; the person starts it on the card or pins it to the board. Read-only — changes nothing on the board.
---

# Quiz Time — does the team know its own rules?

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools — except for Step 6, which uses the REST API. See `learn-eventmodelers-api` for the curl details and §16 *Chat snippets* for the `quiz` and `report` shapes.

The result is **one `quiz` snippet** in the chat, holding **all** questions. The card has a **Start quiz** button, walks the person through the questions and submits all answers at once; the thumbtack pins it to the board, where a team plays it. When someone closes it, **you grade it** (Step 6).

**Never run the quiz yourself.** Don't ask a question in text, don't send one question per message as a `poll`, `questions`, `a2ui` or any other snippet, don't give feedback between questions — also when the person says "quiz me" or "ask me questions about …". The card does all of that.

A `/wdyt` asks what the model leaves open. A quiz asks the **same kind of question where the model has the answer**: what happens when it fails, what has to be true first, who may do it, what the user sees afterwards, what happens next. Someone who passes it can be trusted to talk to a customer about this flow.

**This skill never changes the board's model** — its one write is recording a closed quiz's result (Step 6).

---

## Step 1 — What is it about?

From `$ARGUMENTS` / the message, and the turn's `context=` (`timelineId`, selected elements, `focusArea`):

- a **chapter** (the usual case) or several chapters, or **the whole board**;
- optionally how many questions, which language, which kind of audience.

No target and several chapters on the board: **ask first** — a `poll` with one option per chapter plus "The whole board", each option's `message` a complete `/quiz-time <chapter>` request — and end the turn. One chapter on the board: take it.

---

## Step 2 — Read the rules, not just the names

Orient cheaply (`get_board_outline`, `list_slices`), then read what holds the answers, for the chapter in question only:

- `get_slice_data { boardId, contextName, projection: "specs" }` — scenarios and storylines: **the richest source**;
- `get_slice_data` with `projection: "fields"` — what is captured, shown and handed on, and the examples;
- element and slice **descriptions**, chapter and slice notes (markdown), `data.screenBubbles` on screens;
- **comments** that were answered (`get_node_comments` for elements that have some) — a settled question is a rule.

For a whole board, read chapter by chapter and take the questions from the chapters in proportion to how much is decided in each.

---

## Step 3 — Write the questions

**Every answer must be on the board.** Write down for yourself where each one comes from; if you can't name the scenario, description, field, comment or connection that settles it, the question is not allowed. Never ask about something that is open, contradictory or only your assumption — that is `/wdyt` work, and you may say so in one line of your reply.

Good questions — about behaviour and decisions:

| Ask about | Example |
|---|---|
| Failure paths | "A customer registers with an email that is already in use. What happens?" |
| Preconditions and lifecycle | "Which of these orders can still be cancelled?" |
| Who may do it | "Who is allowed to approve a refund above the limit?" |
| What follows | "The payment is confirmed. What happens without anyone doing something?" |
| What the user sees | "What does the customer see right after submitting the claim?" |
| Duplicates, order, deadlines | "An invitation is opened after 8 days. What does the person get?" |
| Where information comes from | "Where does the delivery address on the shipping label come from?" |
| The reason behind a rule | "Why can an order not be changed once picking has started?" — only when the model states the reason |
| Edge cases from the scenarios | concrete values taken from a scenario: "A cart holds 3 items and a fourth is added. What is the result?" |

**Never ask** (these are what make a quiz stupid):

- how the model is built or named: "What is the name of the event after Register Customer?", "Which slice contains…?", "How many screens…?", element types, field types, ids;
- anything answerable by reading the question, or by general common sense without knowing this domain;
- trivia: button labels, colours, example values for their own sake;
- trick questions, double negatives, "all of the above" / "none of the above";
- the same rule twice in different words.

**Language** — as in `/wdyt`: plain business language, as to a product owner. Never say "command", "event", "read model", "slice", "GWT", "scenario". Write in the board's language.

### Types — mix them

| `type` | Use it when | Needs |
|---|---|---|
| `single` | one outcome is right | `options` (3–4), exactly one `correct: true` |
| `multiple` | several things are true or required ("Which are needed before…?") | `options` (3–6), one or more `correct: true` |
| `truefalse` | one rule that is easy to get backwards — use sparingly | `correct: true` or `false` |
| `text` | the person should explain a rule or a flow in their own words | `answer`: the expected answer in 1–2 sentences, naming what must be in it so it can be graded |

- **8–12 questions** for a chapter unless asked otherwise, at most 30. Fewer good ones beat many weak ones: a thin chapter gets 4, and your reply says why.
- Mostly choice questions, 2–3 `text` — you grade each text answer against your expected answer.
- **Wrong options must be plausible**: what someone who doesn't know the rule would believe, similar in length and tone to the right one. Vary which position is correct.
- Never give away one question's answer in another's wording.
- Every question has an `explanation` (the rule, 1–2 sentences — shown once the quiz is closed), the `nodeId` of the element that settles it (an id you read in Step 2, never guessed) and `source`, to read: `"<chapter> › <slice>"`.
- Order them as the flow runs.

---

## Step 4 — Post it

**One** `post_chat_message`: in a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`.

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "replyTo": "<message_id>",
  "text": "A quiz on Ordering with 9 questions — pin it to the board to play it.",
  "snippet": {
    "kind": "quiz",
    "title": "Ordering — do you know the rules?",
    "intro": "From cart to shipment.",
    "questions": [
      { "type": "single", "question": "An item sells out while it is in a customer's cart. What happens at checkout?",
        "options": [
          { "label": "The order is placed and the item follows later" },
          { "label": "The customer is told and cannot place the order with that item", "correct": true },
          { "label": "The item is removed without a message" }
        ],
        "explanation": "Only available items can be ordered, and the customer is told which one is missing.",
        "nodeId": "<id>", "source": "Ordering › Place Order" },
      { "type": "multiple", "question": "What has to be known before an order can be shipped?",
        "options": [ { "label": "The payment is confirmed", "correct": true }, { "label": "A delivery address", "correct": true }, { "label": "The customer's date of birth" } ],
        "explanation": "…", "nodeId": "<id>", "source": "Ordering › Ship Order" },
      { "type": "truefalse", "question": "A customer can change the delivery address after the parcel has left.", "correct": false,
        "explanation": "…", "nodeId": "<id>", "source": "Ordering › Change Address" },
      { "type": "text", "question": "A payment fails. What happens to the order, and what does the customer do next?",
        "answer": "The order stays open (it is not cancelled); the customer is asked to pay again.",
        "explanation": "…", "nodeId": "<id>", "source": "Ordering › Pay Order" }
    ]
  }
}
```

- The chat drops a snippet with **any** invalid question (missing answer, a `single` without exactly one correct option, under 2 or over 8 options). Check each before posting.
- Keep it under 60,000 characters in total.
- **Don't put questions or answers in `text`** — the person may play along. One line: the subject and how many questions.
- Changes the person asks for ("harder", "only about refunds") → post the whole quiz again.

## Step 5 — Grade what comes back

When the person submits the card, a `CHAT` turn arrives (`I took the quiz …`) with `context.snippetReply` (`messageId` = your quiz message, `selection.answers`: one string per question — the typed text, or the chosen option indexes). The choice questions are already scored on the card. If there are free-text answers, grade each against your expected answer and reply **once**: per question right / partly / wrong with a sentence why. No new questions, no snippet. Without free-text answers, one friendly line.

**No chat** (run from a terminal): there is nothing to pin from — print the questions, then the answers separately.

---

## Step 6 — A pinned quiz was closed: grade it, record it, report it

A `CHAT` turn whose `context.quizClosed = {quizId, nodeId}` is set means someone closed a quiz that was pinned to the board. **The quiz id is only in the context, not in the text.** Nobody grades by hand: you do. Use the REST API (no MCP tool exists for this) with the same `TOKEN` and `ORG_ID` as `connect` resolved, the `x-token` header, and the context's `quizId`:

1. **Read the quiz** — `get_node { boardId, nodeId }`: `meta.quizJson` holds the questions, the correct options and the expected answers.
2. **Read the answers** — one entry per person who answered:
   ```
   curl -s -H "x-token: $TOKEN" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/quizzes/$QUIZ_ID/answers"
   # [{"quiz_id", "orga_id", "board_id", "user_id", "answers": ["1", "0,2", "…"], "answered_at"}]
   ```
   `answers` has one string per question, in order: the option indexes the person chose (`"0,2"`, from 0) or the text typed. An empty list means the quiz already has a result — then stop and say so.
3. **Grade each person yourself.** A choice question is right only when the chosen options are exactly the correct ones; a `truefalse` has two options, in the node `0` = True and `1` = False (compare with the `correct` one); a typed `<` arrives as `&lt;`. A `text` answer is right when it names what your expected answer requires — be fair about wording, strict about substance; partly right counts as wrong. `percentage` = right answers ÷ all questions × 100, rounded, **as a string** (`"75"`). Nobody who answered is left out.
4. **Record the result** — this closes the quiz for everyone and can be done **once** (409 `QUIZ_RESULT_ALREADY_RECORDED` → someone else did; stop):
   ```
   curl -s -X POST -H "x-token: $TOKEN" -H "Content-Type: application/json" \
     "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/quizzes/$QUIZ_ID/result" \
     -d '{"result":[{"userId":"<user_id>","percentage":"75"}, …]}'
   # 201 {"ok": true, "winners": ["<user_id>", …], …}  — the highest percentage; a tie gives several
   ```
   A 409 `QUIZ_NOT_STARTED` means the id is wrong — check `context.quizClosed`.
5. **Post the report** — one `post_chat_message` (`replyTo` = this turn's `message_id`) with a `report` snippet: `chart: "bar"`, `unit: "%"`, one label per person, one series, the values being the percentages. In `text`, name the winner(s) — 🏆 and the person's name, several on a tie — and give one line on where the team was strongest or weakest. Use the people's names from the chat context if you have them, never the raw user id.

If nobody answered, record `{"result": []}` and say so in one line instead of a report.
