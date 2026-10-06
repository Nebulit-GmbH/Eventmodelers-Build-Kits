---
name: domain-story
description: Retell the model as Domain Storytelling — one pictographic story per chapter: actors (people, groups, systems), the work objects they pass around and numbered activities ("1 Customer places Order to Shop"). You draw it yourself as an SVG (stick figures, document icons, numbered arrows) and post it as an `svg` snippet whose figures and arrows are clickable links to the board. Read-only — changes nothing on the board, unless the person then asks to place the picture on it (Step 6).
---

# Domain story — who does what with which work object, per chapter

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback and §16 *Chat snippets* for the `svg` shape.

The result is **one `svg` snippet** in the chat: per chapter a story of numbered sentences — *actor* *activity* *work object* (*preposition* *receiver*) — which **you draw** as a Domain Storytelling graph (stick figures, document icons, numbered arrows). The app draws nothing for you: the picture is entirely yours, so the layout is your job (Step 4). Every figure and every arrow is a link — the snippet's `links` lay clickable areas over the picture that zoom the canvas to the element. It retells the event model in the business's words, for people who don't read event models.

Typical asks: *"Tell the ordering chapter as a domain story"*, *"domain story for every chapter"*, *"/domain-story Registration"*.

**This skill never writes to the board** — the one exception is Step 6, and only when the person asks for it.

---

## Step 1 — Which chapters

`get_nodes { boardId, type: "CHAPTER", projection: "line" }`. A chapter named in `$ARGUMENTS` / the message, or a `timelineId` in the turn's `context=`, is the scope; "all", "every chapter" or a bare `/domain-story` on a board with up to 6 chapters means all of them. A bare `/domain-story` on a bigger board: **ask first** with a `poll` of the chapters (at most ~8, the one in view first, each option's `message` a complete `/domain-story <chapter>` request) and end the turn.

---

## Step 2 — Read each chapter

Per chapter, cheap reads only:

1. `get_board_outline { boardId, chapterId }` — the columns in order, the lanes (swimlanes name the **actors**: a lane per role or persona; automations and external systems are system actors) and the edges.
2. `get_slice_data { boardId, contextName, projection: "outline", format: "toon" }` — the slices with their elements.
3. The context note (MARKDOWN in the first column's `feedback` lane, `get_node` → `meta.description`) if there is one — it often names the roles.

---

## Step 3 — Write the sentences

Walk the chapter left to right, **one sentence per thing that happens in the business** — usually one per slice:

| On the board | Sentence |
|---|---|
| SCREEN → COMMAND → EVENT (a state change) | the screen's lane actor *does* (the command's verb) the work object (the business noun the command is about) **to** the system or person that receives it — "Customer places Order to Shop" |
| EVENT → READMODEL → SCREEN (a state view) | the system *shows* / *lists* the work object **to** the actor of the screen — "Shop shows Order Confirmation to Customer" |
| EVENT → AUTOMATION → COMMAND | the automation's system *does* the work object **to** whom it goes — "Billing sends Invoice to Customer" |
| external / translated event | the outside system *reports* the work object **to** the system — "Payment Provider reports Payment to Shop" |

- **Actors** are roles, not screens or elements: "Customer", "Clerk", "Shop", "Payment Provider". Reuse the exact same name every time — the graph draws one figure per name. Declare systems and groups in `actors` with their `type` (`person` default, `group`, `system`).
- **Work objects** are business nouns — "Order", "Invoice", "Address" — never `PlaceOrderCommand` or `OrderPlaced`. Declare a different icon in `workObjects` when it helps (`document` default, `message`, `data`, `thing`).
- **Activities** are one verb (or a short verb phrase) in the present tense: "places", "checks", "sends".
- **Note the board element behind every part** — this is what makes the picture clickable (Step 4's `links`): the activity (the arrow) = the step's COMMAND (an EVENT for an external one), the actor = their SCREEN in that step (the AUTOMATION for a system actor), the work object = the EVENT (or READMODEL for a state view) carrying it, the receiver = their SCREEN or AUTOMATION. Every id is a real one from Step 2's outline — never guessed; a part the board has no element for gets no link. A figure drawn once but standing for several elements links to the one of its first step.
- The receiver is optional (a sentence can end at its work object: "Clerk checks Order"); the word before it is usually "to" ("with", "for", "at" …).
- Keep each chapter to the main story: 3–15 sentences. A step the board does not show is not a sentence — say what's missing in the chapter's `summary` instead.

---

## Step 4 — Draw it

One standalone `<svg>` for the whole answer; several chapters are stacked top to bottom, each under its title. Draw it like a hand-made Domain Storytelling picture — this is the look:

**Figures** (about 60 px; the name underneath):
- **person** — a stick figure: head `<circle r="16" fill="#fde68a" stroke="#334155" stroke-width="3"/>`, body, arms and legs as `#334155` lines (width 3, round caps); name bold, 15 px, `#0f172a`.
- **group** — two smaller stick figures side by side.
- **system** — a monitor: rounded `<rect>` (about 64×44, `fill="#f1f5f9"`, `stroke="#334155"`, width 3) on a short stand; name bold.
- **work object** — a page with a folded corner (`fill="#e3f0fb"`, `stroke="#2b6cb0"`, width 2.5, about 50×42); name in `#2b6cb0`, normal weight. A message may be an envelope, data a cylinder — same colours.

Define each figure once in `<defs>` (`<g id="person">…</g>`) and place it with `<use href="#person" x=".." y=".."/>` — it keeps the document small.

**Arrows**: straight `<line>`s, `stroke="#334155"`, width 2, with one filled arrowhead `<marker>`; they stop short of the figures (about 40 px from a figure's centre, more where its name is). Every sentence has **one** blue badge — `<circle r="13" fill="#3b5bdb"/>` with its number in white bold — on its *actor → work object* arrow, about mid-way. The activity is written beside that arrow ("invites guest with"), the preposition beside the *work object → receiver* arrow ("to the board"), 14 px, `#0f172a`: above a flat arrow, beside a steep one — never on top of the line, a figure or another label. Two arrows between the same pair run side by side, a few pixels apart.

**Never** draw boxes for actors or work objects, emoji as icons, a colour legend, or a flowchart of rounded rectangles — that is not a domain story. Actors are stick figures and monitors, work objects are folded pages, and nothing else. Start every SVG from this `<defs>` block, copied as is, and place figures with `<use>`:

```svg
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="#334155"/></marker>
  <g id="person" stroke="#334155" stroke-width="3" stroke-linecap="round" fill="none"><circle cx="0" cy="-34" r="16" fill="#fde68a"/><path d="M0 -18v34M-26 -4h52M0 16l-18 32M0 16l18 32"/></g>
  <g id="group"><use href="#person" transform="translate(-16 4) scale(0.8)"/><use href="#person" transform="translate(16 4) scale(0.8)"/></g>
  <g id="system" stroke="#334155" stroke-width="3" stroke-linejoin="round"><rect x="-52" y="-34" width="104" height="66" rx="8" fill="#f1f5f9"/><path d="M-10 32v14M10 32v14M-28 48h56" fill="none" stroke-linecap="round"/></g>
  <g id="doc" fill="#e3f0fb" stroke="#2b6cb0" stroke-width="2.5" stroke-linejoin="round"><path d="M-38 -30h56l20 20v40h-76zM18 -30v20h20"/></g>
</defs>
```

A figure is placed by its centre: `<use href="#person" x="160" y="300"/>` and its name 70 px below (`text-anchor="middle"`, bold 15 px `#0f172a`); a `#doc` with its name 50 px below in `#2b6cb0`; a `#system` with its name 70 px below. An arrow: `<line x1 y1 x2 y2 stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>`; a badge: `<circle r="13" fill="#3b5bdb"/>` plus `<text fill="#fff" font-weight="700" font-size="14" text-anchor="middle" dy="5">1</text>` at the same point. The title and caption belong to the snippet, so don't add a legend or a footer to the picture.

**Layout** — the part that makes it readable:
- Read the story first, then place: the first actor on the left, each work object between its actor and its receiver, receivers further right; an actor who acts again later stays where they are (one figure per name). Systems often sit best below the middle.
- Leave room: at least ~170 px between figure centres, arrows of 150–300 px, a 60 px margin. A crossing arrow is fine; a label over a line or a figure is not.
- Arrows back to someone already drawn are fine — the numbers give the order.
- Something the board doesn't show (a step the story needs) may be drawn dashed with a grey badge and an orange note "(not in the model)" — and named in `text`.
- Give the root `viewBox="0 0 W H"` plus `width`/`height` (its natural size), and `font-family="system-ui, sans-serif"`. Inline colours only: no CSS variables, no external fonts or images, no scripts — it is shown as an image.
- A chapter heading: its title, bold 18 px, at the top left of its part.
- Keep the SVG under 45000 characters — the snippet as a whole (SVG and `links`) must stay under 64 KB. If all chapters don't fit, draw as many as fit and say in `text` which are left out.

**Links** — what makes it navigable. For every figure, every activity (its badge and label, plus the arrow's middle) and every chapter heading, add an entry to `links`: the board element (Step 3) and a rectangle around it **in the viewBox coordinates you drew in** — a figure's rectangle covers icon and name, an arrow's covers badge and label. Clicking it zooms the canvas to the element. A part with no element gets no link.

## Step 5 — Post it

**One** `post_chat_message`: in a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`.

```
mcp__eventmodelers__post_chat_message {
  "boardId": "$BOARD_ID",
  "replyTo": "<message_id>",
  "text": "The ordering chapter as a domain story: 4 steps between Customer, Shop and Payment Provider.",
  "snippet": {
    "kind": "svg",
    "title": "Domain story — Ordering",
    "caption": "1 Customer places order to Shop · 2 Shop requests payment from Payment Provider · …",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 900 520\" width=\"900\" height=\"520\" font-family=\"system-ui, sans-serif\"><defs>… the block from Step 4 …</defs> … </svg>",
    "links": [
      { "nodeId": "<chapter id>", "x": 20, "y": 10, "width": 160, "height": 28 },
      { "nodeId": "<Checkout screen>", "x": 60, "y": 190, "width": 100, "height": 110, "title": "Customer" },
      { "nodeId": "<Place Order command>", "x": 190, "y": 205, "width": 150, "height": 40, "title": "1 places" },
      { "nodeId": "<Order Placed event>", "x": 360, "y": 190, "width": 90, "height": 90, "title": "Order" }
    ]
  }
}
```

- `text` is one line and must make sense alone; `caption` lists the numbered sentences in short, so the story can be read without the picture.
- `title` on a link is its tooltip — the element's own title is used when you leave it out.

**No chat** (run from a terminal): print each chapter's numbered sentences instead of posting.

---

## Step 6 — "Place it on the board" (only when asked)

When the person asks afterwards to place the story on the board (*"put it on the board"*, *"add this to the board"*), that **always means the picture as an image** — never rebuild it from stickies, lanes or timeline elements, never a SCREEN, never another snippet. Upload the exact SVG you posted with `place_image`; it becomes an OUTLINE, the drawing tools' image element — free-floating, in no chapter, connected to nothing:

```
mcp__eventmodelers__place_image {
  "boardId": "$BOARD_ID",
  "imageBase64": "<the SVG document, base64>",
  "mimeType": "image/svg+xml",
  "x": <right of the chapter>, "y": <its top>,
  "title": "Domain story — Ordering"
}
```

- Where the person says, else next to the story's chapter: `get_chapter_bounds`, then `x` = its `x + width + 200`, `y` = its `y` (several chapters in one picture: the first).
- Add a white background `<rect>` as the first child if the SVG has none — a transparent picture is unreadable on a dark board.
- The board image has no clickable areas; say so in one line of your reply, which names where it went.
