---
name: stressor-analysis
description: Residuality-theory stressor analysis of one chapter, run as a chat loop. Finds wide stressors, describes the residue of each, builds a stressor x element incidence matrix to expose hidden coupling, and proposes redesigns as new slices. Read-only until the person confirms.
---

# Stressor analysis — what is left of the model when things go wrong

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback and §16 *Chat snippets* for the `tasks`, `table`, `poll` and `confirm` shapes.

The analysis runs over several chat turns: each step ends with **one** `post_chat_message` carrying one snippet (except Step 1b), and the person's click is the next turn. In a `CHAT` turn `replyTo` = this turn's `message_id`; in a prompt turn that came from a chat, `sessionId` = `CHAT_SESSION_ID` and no `replyTo`. Find where you are from the session (`get_chat_session`): the answer to your last snippet says which step comes next.

**This skill never writes to the board** until the person says yes in Step 3 — and then only through `create_prompt`.

---

## Concepts (get these right)

- **Stressor**: anything that can happen to the system or its environment: technical, business, legal, market, people, nature. Deliberately WIDE, far-fetched ones included. Not a risk list, not a prediction — the theory holds that *which* stressors you pick barely matters, what matters is that they come from many directions. So most must come from **outside** the model: a power outage, a pandemic, a new law, the company being acquired, the key admin quitting, a competitor going free. Only loosely related to the chapter is fine.
- **Residue**: what is LEFT of the system after the stressor hits: which slices still work, which state or data survives or is lost. You observe a residue; you don't build it. The fix is NOT the residue.
- **Goal**: change the model until every residue is acceptable. The architecture becomes the sum of those residues, so it also survives stressors nobody listed.
- **Incidence matrix**: stressors × elements. Elements hit by the SAME stressors are hidden-coupled.

---

## Step 0 — Read once

The chapter comes from `$ARGUMENTS` / the message, else the turn's `context=` (`timelineId`, selection). None and more than one chapter on the board: ask with a `poll` of the chapters (each option's `message` a complete `/stressor-analysis <chapter>` request) and end the turn.

Read once and reuse for the whole round: `get_board_outline` (gives `sliceStatus` per slice) and `get_slice_data { boardId, contextName, projection: "fields", format: "toon" }` for the chapter. Residues name the real slices and elements they hit (field names only in the matrix step, never in a residue); every `nodeId` you send is an id you read here.

---

## Step 1 — Stressors and their residues (`tasks`)

About **15** wide stressors, mixed:

- **at least 5 external** — things that happen to the business or the world, not to the model: power outage, office flooded, pandemic, new privacy law, company acquired, key person leaves, a competitor goes free, the main customer goes bankrupt, the cloud region is gone for a week;
- the rest from the chapter's own business (a customer changes their mind, prices change, a partner stops delivering) — still at business level.

Write them the way a business person would say them, short — **no** field names, attribute values, concurrency races, token or API mechanics. One stressor per task, no "(e.g. X, Y)" sub-lists. Order the list so external and internal stressors alternate, not grouped.

Per task: `title` = the stressor (≤ 8 words), `description` = `Residue: <what still works / what is lost>` — **one short sentence** in plain language, naming slices or elements but not fields, `nodeId` = the element most affected, `id` = `S1`, `S2`, …. `headline`: *"Tick the ones whose residue is unacceptable"*, `submitLabel`: *"These are unacceptable"*.

```
"snippet": { "kind": "tasks", "headline": "Tick the ones whose residue is unacceptable", "submitLabel": "These are unacceptable",
  "tasks": [ { "id": "S1", "title": "Payment provider is down for a day", "description": "Residue: orders still come in, but nothing ships until payments return", "nodeId": "<Order Paid id>" },
             { "id": "S2", "title": "Power outage in the warehouse", "description": "Residue: orders are paid, nobody can pick them — customers aren't told", "nodeId": "<Shipping List id>" }, … ] }
```

### Step 1b — "More" right after the list (`confirm`)

Every `tasks` list of stressors is followed **in the same turn** by its own `post_chat_message` (same `replyTo` / `sessionId`) carrying this `confirm`. Order matters: post the **full list first**, then the confirm — the person sees every stressor and residue before being asked whether they want more. Never post the confirm on its own or ahead of the list, and never describe the list in the confirm's text as something still to come ("15 stressors come next") — it is already above. The confirm's text is one short line, e.g. *"Tick the unacceptable ones above — or ask for more stressors first."*

```
"snippet": { "kind": "confirm", "headline": "Need more stressors?", "yesLabel": "More", "noLabel": "Done — build the matrix" }
```

This is the one exception to "one snippet per step". The lists stay open, so ticks are submitted per list whenever the person is ready:

- **A `tasks` list is submitted**: note which stressors were ticked, reply in one line, **no** snippet — the open confirm still decides what comes next.
- **More**: a new `tasks` list (same `headline`/`submitLabel`) holding **every stressor offered so far plus** about 10 **fresh** ones — 15 + 10 = 25, then 35, … — never just the 10 new ones. Earlier stressors keep their id, title, description and `nodeId` unchanged and come first; the fresh ones follow, none already offered, same external/internal mix and the same plain business wording as Step 1 (no races, outages of a lookup, or other mechanics), aimed at elements and categories (nature, legal, people, market, data, …) the earlier lists hit least. Ids continue the numbering (`S16`, `S17`, …). The `text` says how many are new ("10 new ones added below S15 — 25 in total") and names no elements or mechanics. Post the new list first, then this confirm again after it. The newest list is the one to tick; ticks already submitted on an earlier list still count.
- **Done**: go to Step 2 with every stressor ticked across all lists — the union by id (read the session to collect them).
- Fewer than **5** ticked in total at Done: explain in the text that the matrix can't show coupling yet and send this confirm again.

---

## Step 2 — Incidence matrix (`table`)

For each ticked stressor, list every element it hits (not just the most affected one) — from the read in Step 0, never guessed. Then one `table` snippet:

- one row per element hit at least once, sorted by hits (most first) — the hotspots on top;
- columns: `Element` (the cell `{text, nodeId}` as a link), `Hits` (`align: "center"`), then one column per ticked stressor, labelled `S1`, `S2` … (`align: "center"`), `true` where it hits, `null` where not;
- more than 10 ticked stressors: replace the stressor columns with one `Hit by` column (`"S1, S4, S9"`);
- `caption`: the legend, `S1 = <stressor>; S4 = …`.

```
"snippet": { "kind": "table", "title": "Stressors × elements", "caption": "S1 = Payment provider down; S4 = Price changes mid-checkout; …",
  "columns": ["Element", {"label": "Hits", "align": "center"}, {"label": "S1", "align": "center"}, {"label": "S4", "align": "center"}],
  "rows": [ [{"text": "Order Paid", "nodeId": "<id>"}, 2, true, true], [{"text": "Shipping List", "nodeId": "<id>"}, 1, true, null] ] }
```

In the text, name the **clusters** (elements hit by the same stressor pair), the shared cause behind each cluster, and the hotspots (most hits). Ask which cluster to redesign first — the matrix is this message's snippet, so the question is in the text; when the person answers in words, go on with that cluster.

---

## Step 3 — Redesign one cluster (`confirm`)

Propose new slices (translations, reconciliation todo lists, grace periods, second entry paths …) and state the **new residue** for each stressor that hit the cluster. A `confirm` snippet: `headline` = *"Add these N slices for <cluster>?"*; the slices and their new residues go in the text, kept short.

Never touch elements in non-`Created` slices without an explicit yes; name them instead ("Order Paid sits in a Done slice — I'd leave it and add a translation next to it").

## Step 4 — On yes

One `create_prompt` per new slice (`originMessageId` = the yes), phrased so the prompt turn can do it on its own (chapter, slice name, its elements and fields). Reply in one line. A no: acknowledge it and offer the next cluster.

## Step 5 — Validate

Generate a **fresh** set of stressors not used in rounds 1–3, and compare how many have an acceptable residue before vs after the redesign (the residual index) — a `tasks` list again, the person ticks the unacceptable ones, and the text states the index ("before: 6 of 12 acceptable, after: 10 of 12"). Repeat rounds until new stressors stop hitting new elements.

---

## Chat style

- Explain a residue with a before/after example if asked (same stressor, different leftover).
- Text ≤ 1000 characters; the detail goes in the snippet.
- No ids or cell addresses in the text — element names are enough.

**No chat** (run from a terminal): print the stressors with residues, ask which are unacceptable, then whether to add more (repeat until done), and print the matrix as a table instead of posting.
