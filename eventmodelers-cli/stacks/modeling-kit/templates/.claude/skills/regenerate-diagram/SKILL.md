---
name: regenerate-diagram
description: Redraw a diagram that is pinned on the board (a Mermaid or SVG `diagram` node) from the current model — the app's Regenerate button on the diagram sends `/regenerate-diagram <node id> "<title>" (<kind>)`. Reads the original request it was drawn for (carried silently in the message's context) and the node's current source and title to see what it shows, re-reads the board, redraws it with the model as it is now (and fixes layout problems such as overlapping labels), and writes the new source back into the same node. Changes only that node's `diagramSource`.
---

# Regenerate diagram — redraw a pinned diagram from the current model

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed.

Prefer `mcp__eventmodelers__*` tools. See `learn-eventmodelers-api` for the curl fallback.

A pinned diagram is a `diagram` node: `meta.type: 'DIAGRAM'`, `meta.diagramKind` (`mermaid` or `svg`), `meta.diagramSource` (the Mermaid source or a standalone `<svg>` document, **max 60000 characters**) and `meta.title`. The canvas draws it from `diagramSource` alone, so **writing a new source into the node redraws it** — and the Regenerate button's spinner stops when the source changes.

The message is `/regenerate-diagram <node id> "<title>" (<kind>)`. Only the node id matters; the title and kind are a hint. `$ARGUMENTS` without a node id: **ask which diagram** (text only) and end the turn.

---

## Step 1 — Read the diagram

**The original request.** The app puts the context of the message the diagram was first drawn for back into this message's context (never in its text): the same context that message had (the elements that were visible, and so on), plus `regenerateDiagram: { nodeId, request, reply }` — `request` is what the person originally asked for, `reply` what the agent said when it drew it. **Redraw for that request**: its scope (a chapter, a slice, a flow), its focus and any wish it named ("only the happy path", "left to right") still apply. Take the node id from `regenerateDiagram.nodeId` when it is there. A diagram pinned before this existed has no `regenerateDiagram` (and a diagram from a document or code, not the board, may name things the board does not have): then the old source and title below are all you have.

`get_node { boardId, nodeId }`. Check `meta.type === 'DIAGRAM'` and take `diagramKind`, `diagramSource`, `title`.

- No such node, or not a diagram: say so in one sentence (Step 4) and stop. Write nothing.
- Read the **current source closely**: it tells you what the diagram is about (a state lifecycle of one aggregate? a sequence of one flow? a context map?), which chapter(s) and which elements it names, and the style the person has seen. **Keep the same kind of diagram, the same scope (the original request's, when you have it) and the same title.** A regenerated sequence diagram stays a sequence diagram of the same flow; do not change it into something else.

## Step 2 — Re-read the model

Find the elements the diagram names, and what has changed since it was drawn:

1. `get_nodes { boardId, name: "<term>", projection: "line" }` for the names in the old source, or `get_nodes { type: "CHAPTER", projection: "line" }` and then `get_slice_data { boardId, contextName, projection: "outline", format: "toon" }` for the chapter it covers.
2. Ask for more only where the diagram needs it — fields, scenarios — with a narrower projection, never the whole board in full.

Draw **only what the board says**. Events, commands, states and steps come from the elements and their edges (screen → command → event → read model; automations in between). Do not invent a transition or message the model does not have. If an element the old diagram showed is gone, leave it out; if the model has a new one in scope, add it.

## Step 3 — Draw it again, and better

**Mermaid** (`diagramKind: 'mermaid'`) — the app renders it with `securityLevel: 'strict'` and **plain-text labels** (no HTML, no `<br/>` tricks you are not sure of). You cannot preview it, so write conservative syntax you are sure parses:

- Keep one diagram type (`stateDiagram-v2`, `sequenceDiagram`, `flowchart`, …) as in the old source.
- **Short labels.** Long transition labels collide in state and flow diagrams. Use the command name only (`Win Opportunity`), not command *and* event in one label; put the event on the target or in a note instead.
- **Spread the layout**: `direction LR` (or `TB`) as it reads best, at most ~4 transitions leaving one state, no two parallel arrows between the same two states (merge their labels into one or split with an intermediate state).
- Quote labels with special characters (`A["Opportunity Won (deal)"]`); no semicolons or colons inside unquoted labels; unique ids.
- Sequence diagrams: declare `participant X as Readable name` first, in flow order; `alt` / `opt` blocks only where the model has a real branch.

**SVG** (`diagramKind: 'svg'`) — a standalone `<svg>` document with `viewBox`, `xmlns`, no scripts, no external references (it is shown through an `<img>`); same layout care as above; stay under 60000 characters.

Keep `title` unless it is wrong now.

## Step 4 — Write it back and say so

**One** `submit_node_events` call, a `node:changed` on the **same node** — only the keys that change:

```
mcp__eventmodelers__submit_node_events {
  "boardId": "$BOARD_ID",
  "events": [{
    "id": "<fresh uuid>",
    "eventType": "node:changed",
    "nodeId": "<node id>",
    "meta": { "diagramKind": "<unchanged>", "diagramSource": "<the new source>" },
    "changedAttributes": ["meta.diagramSource"]
  }],
  "compact": true
}
```

- Never create a second node, never touch position, size or other metadata.
- Never write an empty source or one over 60000 characters; if the new drawing would not fit, simplify it.
- A source identical to the old one does **not** end the button's spinner. If nothing in the model changed and the layout needed nothing, still improve the layout or say so (below) — do not rewrite the same text.

Then **one** `post_chat_message` in the turn's thread (`replyTo` = this turn's `message_id`, or `sessionId` = `CHAT_SESSION_ID` for a prompt turn that came from a chat), text only, one or two sentences: what changed ("Redrew *Opportunity lifecycle — states*: added the *Archived* state and put each transition on one short label") or why nothing was written ("That node is not a diagram"). No snippet — the node is the result.
