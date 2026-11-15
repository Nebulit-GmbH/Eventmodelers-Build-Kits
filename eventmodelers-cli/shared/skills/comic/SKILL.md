---
name: comic
description: >-
  Explain the business process behind an event model — a chapter, a slice, a feature, or any idea — to non-technical stakeholders as a comic with recurring characters, speech bubbles, captions and the screens people use. You describe the panels; a drawing kit renders them in one consistent, stylish look (ink outlines, slanted panels, halftone, flat colour) and posts a multi-page `comic` chat snippet. Keeps the SVG pages for marketing and onboarding. Read-only — changes nothing on the board. No image model needed.
---

# Comic — tell the business process as a story

The comic is for **non-technical stakeholders**. It explains *what the business does* — who acts, what they see on screen, what happens next, which rules apply — never *how the software stores it*. Event sourcing, "events are never erased", append-only logs, projections, read models, commands and CQRS are implementation details **nobody in the audience cares about**: they must not appear in any bubble, caption or screen unless the ask is explicitly a developer tutorial (*"what is an event?"*).

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, `BASE_URL` (and `AGENT_ID` / `CHAT_SESSION_ID` when you have them). A pure marketing run with no board needs none of it.

Result: one **`comic` snippet** in the chat — 1–12 pages (1–4 panels each), shown one at a time with a pager — plus the SVG files in `.comic/<slug>/` for reuse.

**There is no image model.** You never paint: you write a `storyboard.json` that *describes* each panel (scene, who is there, mood, speech, caption) and `scripts/comic-kit.mjs` draws it — the house style is fixed, so every page looks professional and the same. Do **not** hand-draw SVG unless the kit cannot do what a panel needs; hand-drawn pages are the exception.

Typical asks: *"Explain the ordering chapter as a comic"*, *"/comic Registration"*, *"a comic for new developers: what is an event?"*, *"3-page comic for our website about Event Modeling"*.

**This skill never writes to the board.**

(The workflow — audience analysis, storyboard approaches, a recurring cast, the manga-guide teaching rules — is adapted from the `comic` skill of `zlh-428/naruto-skills`, Apache-2.0, which drives an image model; here the pictures come from the drawing kit.)

---

## Step 1 — Analyse: subject, audience, message

- **From the board** (a chapter, slice, feature): read it cheaply — `get_board_outline { boardId, chapterId }`, then `get_slice_data { boardId, contextName, projection: "outline", format: "toon" }`. Every command, event and read model the comic mentions exists on the board; never invent behaviour.
- **From an idea** (marketing, onboarding): no board read.
- Write down in three lines: **audience** (default: business stakeholders → plain business language, "the order is placed" not `OrderPlaced`; developers only if the ask says so; marketing → one idea, one joke, a payoff), **the one thing they should remember** — a business fact or rule (*"a customer's old phone number is kept for reference"*, *"an invoice goes out only after payment"*), never a technical property, **length** (one idea → 1 page; a chapter → 3–6 pages; never more than 8 unless asked).

## Step 2 — Pick the storyboard approach (no questions)

**Never ask the person which variant, audience or length — decide and go.** Choose one approach from the ask:

| Approach | Pick it when | Shape |
|---|---|---|
| **Chronological** | a chapter, a flow, a user journey | follow the flow as it happens |
| **Thematic** | teaching, onboarding, "what is an event?" | one concept per page (command, event, read model) |
| **Character-led** | marketing, a pitch, "why Event Modeling" | a person with a problem, the model solves it |

Write the outline (page titles + one line each) into `storyboard.json` straight away. In your final reply (Step 5) say which approach you chose and offer to redo it in another one — that is the only place the choice comes up. Assume sensible defaults for anything unstated: audience from the ask (business people if unsure), the person's language, page count per Step 1.

**Business-process rules** (the default for every board comic):
- **Cast of 2–3, same on every page:** the *people of the process* (customer, clerk, manager — named after their real role on the board's lanes) and optionally one robot for the system or an automation ("the CRM", "Billing"). The robot does things *for* people; it never lectures about itself.
- **Follow the work, not the data.** Each page is one step of the process: who wants what → what they do → what the business does about it → the visible result. Use the board's real names for steps, rules and outcomes.
- **Weave in the screens.** Where a person acts or looks something up, show the real screen from the board: `scene: screen` with `screen: {title, lines, status}` (title = the screen's name, lines = the few fields or buttons that matter), or a `caption` like "Edit Contact → Update Contact Details". The stakeholder should recognise the screen when they later see the product.
- **Say what the business gets, not what the system stores.** "Jana's new number is on file — the old one stays in her history" is fine as a business fact only when the board's rules actually make it matter; otherwise leave it out. Never use storage metaphors (diary, ledger, "never erase", "I add a new line").
- **Rules and exceptions are the drama.** A business rule that blocks or changes the path ("no invoice before payment", "only one open order per customer") makes a better conflict than a technical glitch.
- **Page titles are narrative** ("Jana changes her number — Sales finds her again"), not "Page 3: Update Contact".
- **End on a payoff**: the person gets what they needed, the opening problem is visibly solved. No "Thanks for reading".

**Developer tutorials only** (the ask is explicitly "what is an event?" / onboarding for engineers): then metaphors are welcome — an event is an entry in a diary, a read model a notice board, a command a form being handed over.

## Step 3 — Write `storyboard.json`

In a fresh folder `.comic/<slug>/` (keep it out of git):

```json
{ "text": "One line for the chat.", "title": "Order placed", "caption": "optional",
  "cast": { "Ana":  { "kind": "person", "hair": "messy", "hairColor": "#5a3825", "glasses": true, "skin": "#f2c9a0" },
            "Shop": { "kind": "robot", "label": "SHOP" } },
  "pages": [ { "accent": "indigo", "alt": "Ana asks Shop where her order went", "title": "…",
      "panels": [ { "scene": "office",
                    "characters": [ { "who": "Ana", "pos": "left", "mood": "worried" }, { "who": "Shop", "pos": "right", "mood": "neutral" } ],
                    "bubbles": [ { "who": "Ana", "text": "Did my order go through?" }, { "who": "Shop", "text": "Let me check the diary of events." } ],
                    "caption": "Monday, 9:02", "sfx": "DING!" } ] } ] }
```

| Field | Values |
|---|---|
| `cast.*.kind` | `person` (`hair`: short / messy / bun / bald, `hairColor`, `skin`, `glasses`, `color` = clothes) · `robot` (`label` ≤ 5 chars, e.g. `AI`, `SHOP`, `BILLING` for a system or automation) |
| page `accent` | `indigo` · `coral` · `teal` · `mustard` — one per page, vary across the comic |
| page `layout` | inferred from the panel count: 1 `single`, 2 `row2`, 3 `row3`, 4 `grid4`; or `wide3` (a wide opening panel over two) |
| panel `scene` | `office` · `screen` (+ `screen: {title, lines[≤3], status: "ok"|"error"}`) · `night` · `burst` (the big moment) · `plain` |
| character `pos` / `mood` | `left` / `right` / `center` · `neutral` smile surprised worried proud angry |
| `bubbles[]` | `{who, text, kind?: "say"|"think"}` — ≤ 2 per panel, **≤ 12 words each**; the kit fits the text and points the tail at `who` |
| `caption`, `sfx` | a narrator box at the panel's foot (≤ 12 words) · one loud word ("DING!", "BOOM") |

Craft: 3 panels per page is the sweet spot; one beat per panel (setup → trigger → consequence); vary scenes and moods so the pages don't look alike; always give each page an `alt`. Panels where a character speaks need that character in `characters`.

## Step 4 — Render, check, post

No install, no dependencies — plain Node.

```bash
# draw only (look at it first):
node .claude/skills/comic/scripts/render-comic.mjs .comic/<slug>
# draw and post:
EM_TOKEN="$TOKEN" node .claude/skills/comic/scripts/render-comic.mjs .comic/<slug> --post --base "$BASE_URL" --org "$ORG_ID" --board "$BOARD_ID" --agent "$AGENT_ID" --session "$CHAT_SESSION_ID"
```

Run it exactly like this, relative path and no `cd` (the modeling agent's Bash guard allows this one script, like the prototype skill's); the token goes in only as `EM_TOKEN="$TOKEN"`, never as a flag. Leave out `--agent` / `--session` when you have none. Outside a locked-down agent, `$EVENTMODELERS_TOKEN` works too.

**Look at the pages before posting**: render without `--post` first, open `page-1.svg` (and one more; it is plain SVG — any viewer or the browser shows it), and fix what is off — text too long for its bubble (shorten it), a tail crossing a face, two pages that look identical. Then run again with `--post`. **Always post with the script, never through `post_chat_message`**: the pictures are a hundred KB or more of base64.

Errors: `400 CHAT_SNIPPET_TOO_LARGE` (> 4 MB: fewer pages); `413 BODY_TOO_LARGE` (the backend predates the comic limit); a page "too big" (the kit's drawings are light, so this means a hand-drawn SVG — simplify).

## Step 5 — Tell the person

Two or three sentences: what the comic explains, how many pages, and — for marketing — where the files are (`.comic/<slug>/page-N.svg` — browsers, Figma, Canva and Keynote open SVG; PNG or PDF is one export click away). Name the approach you chose and offer one follow-up at most (the same story in another approach, another chapter, another audience). Don't describe the pictures; they are right there.

## Rules

- A board comic follows the real model — no invented steps, rules or screens — and speaks business language: no event-sourcing talk ("never erased", "append", "event log") for business audiences.
- Same cast, same look on every page; text lives in the kit's bubbles — fix a typo by editing `storyboard.json` and re-rendering.
- No secrets, tokens or customer data in a comic.
