# Chat messages by kind — what each one needs

The table in `CLAUDE-CHAT.md` step 3 names the kinds; this is the full rule for each.

   - **answer** — a question about the model: read what you need (cheapest read first), change
     nothing.
   - **wdyt** — the message is "wdyt" (with or without a question mark, or `/wdyt`): **always** the `/wdyt`
     skill, never an inline answer. Create one prompt for it (`create_prompt`, `originMessageId` = this
     message) — *"Run /wdyt on `<context or chapter>`"*, the target resolved from `context=` like any other
     (`timelineId` for the chapter, what they have selected). It sends its findings back as a snippet to tick
     and posts nothing to the board until they answer (`/wdyt` Step 4.0). Your reply here is one line —
     *"On it — looking at Registration."*
   - **walkthrough** — "how does X work?", "walk me through …", "what does it take to add …?", or `/walkthrough …`:
     run the `/walkthrough` skill **in this turn** — it only reads the board, so no prompt is needed. It finds the
     slices involved (one step per slice, after a summary page) and its `walkthrough` snippet is your one reply (`CLAUDE-CHAT.md` step 4). Without a
     subject (a bare `/walkthrough`) it asks first — which flow, or which new feature — and that question is the reply. A planned change
     ("we need to add an email") is its impact mode: every slice marked existing / needs adjustment / new, new ones sketched — the walkthrough is the proposal, and the changes become work only
     when the person asks for them afterwards.
   - **data journey** — "where does X come from?", "where is X used?", "which events store X?", or `/data-journey …`, about
     **one piece of information** (a field, "the customer email"): run the `/data-journey` skill **in this turn** — it only reads
     the board, so no prompt is needed. Its `dataJourney` snippet (a table: origin, stored, transformed, used, sent — per element,
     with the field name there) is your one reply. Without a clear subject it asks first which information.
   - **domain story** — "tell it as a domain story", "who does what in this chapter?", or `/domain-story …`: run the
     `/domain-story` skill **in this turn** — it only reads the board, so no prompt is needed. Its `svg` snippet
     (per chapter: actors, work objects, numbered activities, drawn by you as a domain story graph) is your one reply.
   - **stressor analysis** — "what breaks if …?", "stress-test this chapter", or `/stressor-analysis …`: run the
     `/stressor-analysis` skill **in this turn** — it only reads the board until the person says yes, so no prompt is needed
     for its steps. It is a loop over several turns (stressors as `tasks` with a "More" `confirm` posted after each list, the incidence matrix as a `table`, a redesign as
     `confirm`); an answer to one of its snippets continues it at the next step. Only the confirmed new slices become prompts.
   - **snippet type** — "make me a card / checklist / sign-off for …", "can the chat show X as a snippet?", or
     `/build-snippet-type …`: run the `/build-snippet-type` skill **in this turn** — a snippet type is not a board change,
     so no prompt is needed. It is a loop over several turns (questions, a preview with a `confirm`); the type is created
     only after the person's yes.
   - **a skill by name** — the message starts with `/<name>` of one of your skills (the chat panel's menu
     writes these: `/analyze-existing-model`, `/analyze-code-base`, `/detect-model-drift`, `/timeline …`,
     `/storyboard …`; `/add-next-slice`, `/examples`, `/html-screen …` can still be typed): the person chose that skill, so it **is** the work — create one prompt,
     *"Run /<name> <the rest of the message>"*, with the target resolved from `context=` like any other
     (selected elements, chapter), and say so in one line. Don't re-interpret it as a question. A skill that
     needs something the message lacks (which attribute? which screen?) is a **clarify**: ask, with a
     snippet if the answer is a pick.
   - **a review in other words** ("what do you think?", "any questions on this?", "what's missing here?") —
     your call: a quick take is an **answer**, in prose; a thorough review of a whole context or chapter may
     be the same prompt as above. If a reply ends in a question the person answers with a click ("Want me to
     turn these into comments?"), that question is a snippet, not a sentence (`CLAUDE-CHAT.md` step 4, Snippets).
   - **clarify** — too vague to act on even with the session behind it: do no work.
   - **work** — it asks for a change to the board: create the work now, as in `CLAUDE-CHAT.md` ("Creating work") — a request is its
     own go-ahead, in every mode.
   - **confirm** — the message says yes to a proposal you started after a board change (`--modeling`
     proposes instead of acting on board changes; see "Propose mode" in `CLAUDE-STANDALONE.md`). Any
     form counts, typed or spoken ("yes", "sure", "go ahead", "do it", "ok, but only the
     scenarios"): create the work for exactly what you proposed — a partial yes, only that part; a
     no ("leave it"), nothing. A reply that changes the plan ("yes, but call it OrderSubmitted")
     confirms the changed plan. Not sure it is a yes? Treat it as a new message and ask.
     The proposal may have been a **snippet** (`CLAUDE-CHAT.md` step 4): the click arrives as an ordinary message —
     `Yes – <question>` or `Apply changes – …` is a yes to exactly what that snippet showed; a `Please do
     these:` list is a yes to only those items (unticked = declined); a poll pick is the chosen option.
     The answer's `context.snippetReply.messageId` in `get_chat_session` names the message it answers.
