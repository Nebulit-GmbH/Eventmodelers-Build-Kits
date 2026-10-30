## 16. Chat snippets

A chat message you post can carry **one snippet**: a small interactive element shown under its text. **Prefer a snippet over prose** whenever the person's answer is a yes/no, a choice between alternatives or a pick from a list — they click instead of typing, and you get an unambiguous answer. Likewise show an element, picture or command as a `link` / `image` / `code` instead of describing it. Write plain text only for answers, explanations and open questions that need words. The person clicks; their choice comes back as an **ordinary chat message** (the next `CHAT` turn), so you read it like anything they type — no special handling.

### POST `/api/org/:orgId/boards/:boardId/chat/agent-messages`
Same as the MCP tool `post_chat_message` (auth `x-token` + `x-agent-id`; the rules for who may write where are unchanged). Body: `{ text, reply_to?, session_id?, prefer_user_id?, only_if_unanswered?, snippet? }`. `text` stays **required** — it is the fallback copy and what the person reads first; keep it to a sentence and let the snippet carry the detail. `snippet` is a JSON object with a string `kind`, at most 64 KB. **Errors**: `400 CHAT_SNIPPET_INVALID` (no object / no `kind`), `400 CHAT_SNIPPET_TOO_LARGE`. The kinds below are validated by the chat, not the server: a snippet it cannot read is simply not shown, so the text must stand on its own.

### Which kind when
Rule of thumb: if you are about to write "Shall I…?", "Want me to…?", "A or B?" or "which of these?", send the matching snippet instead.

| You want… | Kind | Their answer arrives as |
|---|---|---|
| a yes/no on one thing | `confirm` | `Yes – <headline>` / `No – <headline>` |
| one pick out of 2+ alternatives | `poll` | the option's `message` if you gave one, else `<label> – <question>` |
| the person to tick which of many items you should do | `tasks` | `Please do these:` + the ticked titles (or `(by id)` + ids when long) |
| to propose edits to existing elements, for one go-ahead | `changes` | `<confirmLabel> – <headline>: <element titles>` |
| to point at an element | `link` | nothing — it pans the canvas |
| to show a picture | `image` | nothing |
| to show a command or payload | `code` | nothing |
| to show numbers as a diagram (counts per slice, a trend, shares of a whole) | `report` | nothing |
| to explain how a feature works, or walk through what a planned feature takes, slice by slice ("how does registration work?", "we need to add an email — walk me through it") | `walkthrough` | nothing — selecting a step pans the canvas |
| to show what a screen could look like, without putting it on the board | `screen` | nothing |
| to show several screens at once — a list, a gallery, a storyboard ("show me all screens of X") | `walkthrough`, one step per screen | nothing — selecting a step pans the canvas |
| to answer where one piece of information comes from and where it ends up ("where is the customer email used?") | `dataJourney` | nothing — element names pan the canvas |
| to show a diagram you drew yourself — a context map, a domain story, a sketch, any picture that isn't a chart | `svg` | nothing |
| to show a UML or flow diagram you write as Mermaid — a sequence, flowchart, state, ER or class diagram | `mermaid` | nothing |
| to ask a complex question with several fields at once — a short form with text, choices, a slider, a date, checkboxes ("which environment, when, and who to notify?") | `a2ui` | `Answer to "<title>" (<action>):` + one `- label: value` line per input |
| to lay out rows and columns — a comparison, a matrix (stressors × elements), a short list with a few attributes | `table` | nothing — linked cells pan the canvas |
| to show a prototype you just built and uploaded (the `prototype` skill), running in the chat | `prototype` | nothing — **Full screen** opens the board's prototype player |
| something the customer defined their own snippet type for (a risk card, a sign-off — see `list_snippet_types`) | `custom` | the clicked action's `answer`; `context.snippetReply.then` says what to do |

`confirm`, `poll`, `tasks`, `changes` and `a2ui` are questions: a person answers once, then they show as answered. `link`, `image`, `code`, `report`, `walkthrough`, `screen`, `dataJourney`, `svg`, `mermaid`, `table` and `prototype` are display only and never wait for anything.

### Shapes
```typescript
{ kind: 'confirm', headline: string, yesLabel?: string, noLabel?: string }        // headline is the question
{ kind: 'poll',    question: string,
  options: Array<{ label: string, description?: string, message?: string }> }     // 2+; message = what is sent when picked
{ kind: 'tasks',   headline?: string, submitLabel?: string,
  tasks: Array<{ id: string, title: string, description?: string,
                 nodeId?: string }> }                                             // ids unique; nodeId makes the description a link that jumps to the element; 5 per page
{ kind: 'changes', headline?: string, confirmLabel?: string,                      // one confirm for the whole list; shown 5 per page
  items: Array<{ id: string, title: string,                                       // title = the element's name
                 nodeId?: string,                                                 // makes the title a link to the element
                 slice?: string,
                 changes: Array<{ field: string, from?: string, to?: string }> }> } // no from = added, no to = removed
{ kind: 'link',    nodeId: string, label?: string }
{ kind: 'image',   url: string, alt?: string, caption?: string }                  // https or png/jpg/gif/webp data URL; no svg
{ kind: 'code',    code: string, language?: string, title?: string }              // monospaced, with a copy button
{ kind: 'report',  chart: 'bar' | 'line' | 'pie', title?: string, unit?: string,
  labels: string[],                                                               // 1–50 points: x axis, or the pie slices
  series: Array<{ name: string, values: number[] }>,                             // one number per label; bar/line up to 6 series, pie uses only the first (no negatives)
  confirm?: { headline: string, yesLabel?: string, noLabel?: string } }          // optional yes/no question under the diagram, like a confirm snippet
{ kind: 'walkthrough', title: string,                                            // a slice-by-slice player through a feature
  summary: string,                                                                // 1–3 sentences on how it works, shown on the first page under the slice count
  steps: Array<{ title: string,                                                   // 1+, one per slice, in the order the feature runs
                 description?: string,                                            // what happens in this slice, in business words
                 nodeId?: string,                                                 // the slice's SLICE_BORDER — drawn in its lanes, selecting the step zooms to it; none for a new slice
                 status?: 'existing' | 'changed' | 'new',                         // planned feature: used as is / needs adjustment / built from scratch
                 elements?: Array<{ type: 'SCREEN' | 'COMMAND' | 'EVENT' | 'READMODEL' | 'AUTOMATION',
                                    title: string, fields?: string[],
                                    html?: string }>,                              // a new slice only: its sketch, drawn in lanes; html = the SCREEN as a small HTML page (≤ 16000 chars)
                 screenId?: string,                                               // a SCREEN / HTML_SCREEN outside the slice the person sees in this step
                 rules?: string[],                                                // business rules of this slice
                 changes?: string[] }> }                                          // planned feature: what has to change or be built here
{ kind: 'screen', html: string,                                                  // a screen mock-up as a small HTML page (≤ 16000 chars), shown sandboxed
  title?: string, caption?: string }
{ kind: 'dataJourney', subject: string,                                           // the piece of information followed, in the person's words ("Customer email")
  summary?: string,                                                               // 1–2 sentences: where it comes from, where it goes
  stops: Array<{ title: string,                                                   // 1+, in flow order: the element the data passes through
                 nodeId?: string,                                                 // makes the title a link; the element's type is read from the board
                 elementType?: string,                                            // SCREEN, COMMAND, EVENT, READMODEL, AUTOMATION … for an element not on the board
                 role: 'origin' | 'stored' | 'transformed' | 'used' | 'sent',     // entered/imported here / kept in this event / renamed, derived, reformatted / read, shown, decided on / leaves the system
                 field?: string,                                                  // the field holding it here — names change along the way (email → customerEmail)
                 slice?: string,
                 note?: string }> }                                               // how it is used or changed here, a few words
{ kind: 'svg', svg: string,                                                       // a standalone <svg>…</svg> document (≤ 60000 chars), shown as an image
  title?: string, caption?: string,
  links?: Array<{ nodeId: string, x: number, y: number,                           // ≤ 200 clickable areas over the picture, in the svg's viewBox coordinates;
                  width: number, height: number, title?: string }> }             // a click zooms the canvas to nodeId; title = tooltip (else the element's title)
{ kind: 'mermaid', source: string,                                               // Mermaid source, no ``` fence (≤ 60000 chars); the app draws it
  title?: string, caption?: string }
{ kind: 'a2ui', title?: string,                                                   // an A2UI v0.9 form (https://a2ui.org), basic catalog subset
  components: Array<{ id: string, component: string, ... }>,                      // flat list, ≤ 150; one has id 'root'; children refer to ids, no cycles
  data?: object }                                                                 // initial data model; inputs bind to it with value: { path: '/form/x' }
//   Text{text, variant?}  Row/Column/List{children:[id], align?}  Card{child}  Divider  TextField{label, value?, variant?: 'shortText'|'longText'|'number'}
//   CheckBox{label, value?}  ChoicePicker{label, options:[{label,value}], value?:[…], variant?:'mutuallyExclusive'}  Slider{label, min, max, value?}
//   DateTimeInput{label, enableDate?, enableTime?}  Button{child:<Text id>, variant?:'primary', action:{event:{name, context?}}}
{ kind: 'table', title?: string, caption?: string,
  columns: Array<string | { label: string, nodeId?: string,                      // 1–12; nodeId makes the header a link (a matrix with one column per element)
                            align?: 'left' | 'center' | 'right' }>,
  rows: Array<Array<string | number | true | null                                // 1–200, one cell per column; true = check mark, null = empty
                    | { text: string, nodeId?: string }>> }                      // a cell linking to an element; shown 5 rows per page
{ kind: 'prototype', timelineId: string,                                          // the context the prototype was uploaded for: a MODEL_CONTEXT or timeline id
  title?: string, caption?: string }                                              // (html: string ≤ 60000 chars instead of timelineId exists, but a built page never fits)
```

### How to use them
- **A snippet is a question or a view, not a way to act.** Nothing a click does changes the board: a confirmed `changes` list is a go-ahead, and you then create the work (`create_prompt`) for exactly what was shown — a chat turn never edits the board itself.
- **One snippet per message.** Need two things? Post the question as a snippet, the rest as text, or wait for the answer.
- **Lists:** put every item in one `tasks` / `changes` snippet — it pages itself at 5 per page; do not split a long list across messages. Give each item a stable `id` you can map the answer back to.
- **Name elements** with `nodeId` wherever you can (`tasks`, `changes`, `link`), so the person can click through to them — in a `tasks` list, put the element's name in `description` and its id in `nodeId`.
- **Answers are text.** For a `tasks` answer, match the titles (or ids) back to your list; an element the person left unticked was declined, not forgotten. A `poll` option with a `message` of your own makes the answer unambiguous.
- `get_chat_session` shows your snippet on the message as `snippet`, and the person's answer is the user message after it, carrying `context.snippetReply.messageId` (your message's id) — useful to tell an answer to a snippet from a new message.
- **`report`** draws the numbers you send — it computes nothing, so aggregate first. A series whose length differs from `labels`, or a non-number, makes the whole snippet invisible. Keep `text` as a one-line summary of what the diagram shows. Add `confirm` when the diagram leads to a follow-up question ("Want me to look into the backward arrows?"): the answer comes back like a `confirm` answer, and without it the report is display only.
- **`walkthrough`** answers "how does X work?" and "walk me through what changes for Y", **one step per slice**. It opens with a summary page — the slice count (with `status`: how many exist, need adjustment, are new) above your `summary` — then shows each slice in its lanes like Slice View (screen, command / read model, events), a `new` slice sketched from its `elements` (its SCREEN rendered from the `html` you write: a real, simple page — a form, a list, a table — with inline styles only; scripts and external resources are blocked; without `html` a plain form/table is generated from the fields); each step zooms the canvas to its slice, and **Play** opens it full-screen with description, changes and rules underneath. Build it from the board, never from memory — the `walkthrough` skill (modeling kit) has the procedure. Every `nodeId`/`screenId` must be a real id from this board. Keep `text` to one line naming the feature and the number of slices.
- **`screen`** shows a mock-up in the chat — "what could the registration screen look like?", a variant to compare — without creating anything on the board (that is the `html-screen` skill's job). One screen per `screen` snippet: for several screens use a `walkthrough` with one step per screen — `nodeId` = the SCREEN/HTML_SCREEN on the board, or `elements:[{type:"SCREEN", title, html}]` for a screen not on the board — never several `screen` snippets. `html` follows the walkthrough's screen rules: body content, inline styles or one `<style>` block, no scripts, no external images, fonts or stylesheets (they are blocked), at most 16000 characters.
- **`dataJourney`** answers "where does X come from / where is X used?" for **one piece of information**, as a table: one stop per element it passes through, in flow order, each with its `role`, the field name there and the slice. A headline counts the roles ("Originates in 1 place, stored in 2 elements and used in 3 places"). Build it from the board — the `data-journey` skill (modeling kit) has the procedure; every `nodeId` must be a real id from this board, and a field the board doesn't carry is not a stop. Keep `text` to one line naming the data and where it originates.
- **`svg`** is for a picture you draw yourself: give the root a `viewBox` (and `width`/`height` for its natural size), inline colours and fonts — it is shown as an image, so scripts, `<a>` links and external resources do nothing. To make parts of it clickable, list them in `links`: a rectangle in the viewBox coordinates you drew in plus the element it stands for (only real ids from this board); the app lays a clickable area over each that zooms the canvas there. Prefer `report` for numbers. A domain story (who does what with which work object) is an `svg` you draw — the `domain-story` skill (modeling kit) has the procedure and the drawing style. Every SVG snippet has a download-as-PNG button.
  - **"Place it on the board" after you drew an SVG always means: put that picture on the board as an image** — never rebuild it from elements (stickies, lanes, a timeline), never a SCREEN, never a new snippet. `place_image` with `imageBase64` = the SVG document itself, base64-encoded, `mimeType: "image/svg+xml"`, `title` = the snippet's title: it becomes an OUTLINE (the drawing tools' image element), free-floating at `x`/`y`, in no chapter and connected to nothing. Place it where the person says, else in free space next to the chapter it is about (`get_chapter_bounds`: right of or below it). Add a white background `<rect>` first if the SVG has none, or it is unreadable on a dark board. One SVG = one image. The image on the board has no clickable areas — `links` stay in the chat.
- **`a2ui`** is for a question that needs several answers at once — instead of five chat turns, send one form. Build it as a flat component list: a `Column` with id `root`, then the fields, then a primary `Button` whose `action.event.name` says what the click means (`submit`, `approve` …). Several buttons are fine (`approve` / `reject`); the clicked one's `name` is in the answer. The person's answer is one chat message — `Answer to "<title>" (<action>):` and a `- label: value` line per filled input, chosen options by their labels, then the action's `context` — so give every input a clear `label`. Keep it small (≤ ~8 fields) and send a meaningful `text`. Not supported (renders nothing): Image, Icon, Video, AudioPlayer, Tabs, Modal, template children (`{path, componentId}`) and function calls; a missing `root`, an unknown child id or a cycle makes the whole snippet invisible. Like every question it answers once.
- **`mermaid`** is for a diagram you can write as text: a sequence diagram (`sequenceDiagram`), a flow (`flowchart LR`), states (`stateDiagram-v2`), an ER or class diagram. Send just the source; the app draws it, with a *Show source* toggle and a copy button, and shows the source when it has a syntax error — so keep the syntax plain (quote labels with special characters). Prefer it over a `code` block for any diagram: a `code` block with `language: "mermaid"` is drawn too, but `mermaid` says what you mean. It has no element links; for clickable parts draw an `svg`.
- **`table`** is for anything that is rows and columns and not a chart: a comparison of options, an incidence matrix (rows = stressors, columns = elements, `true` where it hits), a short list with a few attributes per item. It computes nothing — totals are a row you add. Put element ids in `nodeId` (header or cell) so names are links; a row longer than the columns is cut, a shorter one padded, an empty one dropped. Prefer `report` for numbers you want *seen* as a trend or share, `dataJourney` for one piece of data's path.
- **`prototype`** runs a prototype in the chat: the page the platform stored for `timelineId` (the `contextId` the `prototype` skill uploaded under — any timeline of that context works too), in a sandboxed iframe with **Restart** (empty event log) and **Full screen** (the same player as the timeline's ▶). Send it only after `upload` succeeded — before that it shows "No prototype has been built for this yet". The `text` is the short report of what was built; the prototype itself is the snippet.
- A snippet is shown exactly as you send it — keep secrets and tokens out of `code` and `image`.

### Custom snippet types
A customer can define their own snippet types — a risk card, a sign-off, a checklist — for one board. A type is data only: a **schema** for its data, an HTML **template**, answer **actions** (buttons) and **instructions** for you (when to use it, how to fill it). `list_snippet_types` shows the board's types; prefer a matching custom type over a built-in kind whenever its `instructions` say it fits.

Send one with `post_chat_message`:
```typescript
{ kind: 'custom', ref: string,              // the type's slug
  data: object }                            // must match the type's schema
```
The server looks the type up on the board, checks `data` against its schema and stores the definition with the message, so it renders the same later even if the type changes. **Errors**: `400 SNIPPET_KIND_UNKNOWN` (no such type on this board), `400 SNIPPET_DATA_INVALID` (the message lists every field that doesn't fit — fix the data and send again).

**Based on a built-in kind.** A type with `base` (e.g. `'table'`, `'report'`, `'poll'`) has no template and no actions: its `data` is that kind's JSON without `kind` (for `table`: `{ title?, columns, rows }`), checked against a schema only if the type has one, and the chat draws and answers it like that kind — element links included. Use it to keep a built-in snippet the person wants again (*"save this table as a snippet"*); preview with `def: { slug, title, base }`, create with `base` instead of `template` / `actions`.

**`&<slug>` in a message.** A chat message starting with `&<slug>` (e.g. `&slice-status-per-chapter` or `&risk-card the payment slice`) asks you to answer with that custom type: look it up with `list_snippet_types`, follow its `instructions`, and send `{ kind: 'custom', ref: '<slug>', data }` — the rest of the message says what about (nothing after it = the whole board). The chat's **Snippet** dropdown writes this prefix.

**The answer.** A click sends the action's `answer` text (filled with the data) as the person's next chat message. Its `context.snippetReply` carries `messageId`, `selection` — the action's `id` — and `then`: the instruction the type gives you for that button. Do what `then` says with your usual tools; an action without `then` is just an answer to read.

**Preview a draft.** Before a type exists you can show it with `def` instead of `ref` — `{ kind: 'custom', def: { slug, title, template, actions }, data }` (no `ref`). The server checks the definition's shape but has no schema yet. Use it to let the person see the card before `create_snippet_type`.

**Authoring flow:** draft → post a preview (`def` + the sample data) with the instructions and each action's `then` in the text → ask with a `confirm` → `create_snippet_type` after the yes. The `build-snippet-type` skill walks through it.

#### GET `/api/org/:orgId/boards/:boardId/snippet-kinds`
The newest version of every type of the board: `[{ id, slug, title, version, boardId, instructions, schema, template, actions: [{ id, label, answer?, then? }], sampleData?, createdBy, createdAt }]`.

#### POST `/api/org/:orgId/boards/:boardId/snippet-kinds`
Body `{ slug, title, instructions, schema, template, actions?, sampleData? }` → `201` with the definition. An existing slug on the board gets the next `version`. Rules: slug `^[a-z0-9][a-z0-9-]{1,39}$`; title ≤ 100; instructions ≤ 4000; schema ≤ 16 KB — keywords `type` (object, string, number, integer, boolean, array), `properties`, `required`, `items`, `enum`, `title`, `description`, root `type: 'object'`, data with a field not in the schema is refused; template ≤ 16000 characters with `{{a.b}}`, `{{.}}`, `{{#list}}…{{/list}}`, `{{^x}}…{{/x}}` (balanced); ≤ 20 actions with unique `id`, a `label`, optional `answer` (text template, ≤ 500) and `then` (≤ 2000); `sampleData` must match the schema. **Errors**: `400 SNIPPET_KIND_INVALID` (names the problem), `409 SNIPPET_KIND_CONFLICT` (retry).

#### DELETE `/api/org/:orgId/boards/:boardId/snippet-kinds/:id`
Removes the type with all its versions → `204`. Messages that already show it keep showing it.

---
