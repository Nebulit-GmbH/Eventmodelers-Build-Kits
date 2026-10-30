---
name: learn-eventmodelers-api
description: Teaches an agent everything about the eventmodelers platform API — all endpoints, their purpose, request payloads, response shapes, authentication, and element types.
---

# Eventmodelers Platform API Reference

You now have complete knowledge of the eventmodelers platform API. This is a reference for *how a skill talks to the platform once you're already executing one* — it is not a license to call the API directly instead of invoking the skill that matches the user's intent (see the Skill Selection table in `CLAUDE.md`). If a prompt matches a row in that table, invoke that skill first and let it decide which endpoint/tool to call; only reach for this reference directly when no skill matches the intent at all, or when you're implementing/debugging a skill itself.

**Load this once per session, on demand — not as a mandatory preamble.** Every other skill already documents the exact API calls it needs inline; none of them require this full reference to be loaded before they can run. Reach for this skill only when you hit a specific endpoint, field, or element type that a skill's own instructions don't cover, and don't reload it again later in the same session once you have.

**Two transports exist for board operations: MCP tools (preferred) and raw REST/curl (fallback).** The `connect` skill registers the MCP server in `.mcp.json`. Once `mcp__eventmodelers__*` tools are visible in your tool list, use them — they need no `x-token`/`x-user-id` headers (auth and org resolution happen server-side from the registered token) and return the same data as the REST endpoints below. Fall back to the numbered REST sections only when MCP tools aren't connected yet, or for the handful of endpoints (prompts lifecycle, snapshots, user management, board/extension CRUD) the MCP server intentionally doesn't expose — it only covers board-content operations (nodes, timelines, slices, comments, screens). This preference is about *which transport a skill's own instructions should use*, never about whether to invoke the skill in the first place.


## How to use this skill — read ONLY what you need

This file is an index. **Do not read every reference file.** Find the row below that matches the endpoint, § number or topic you need, then `Read` just that one file (path relative to this skill's folder: `references/<file>.md`). A pointer like "`learn-eventmodelers-api` § 15" means: open `references/s15-chat-attachments.md` from the table. Content is the original API reference, split verbatim by section.

| § / topic | Reference file | Load this when… |
|---|---|---|
| MCP Tool Catalog | `references/mcp-tool-catalog.md` | you need the list of `mcp__eventmodelers__*` tools, their args/projections, or which REST endpoints have no MCP equivalent |
| Architecture, Element Types, Field Types, HTTP status codes | `references/basics-architecture-element-types.md` | you need element type/field type definitions, their JSON shapes, or status code meanings |
| § 1 Boards | `references/s01-boards.md` | creating/listing/deleting boards, reading the event log, board-level or node comments, bucket |
| § 2 Chapters & Timelines (also: Feedback lanes and MARKDOWN nodes, "Linking to elements in markdown: `ref:<nodeId>`") | `references/s02-chapters-timelines.md` | creating chapters, columns, lanes, dropping into cells, writing markdown/feedback notes, or linking to elements with `ref:<nodeId>` |
| § 3 Nodes | `references/s03-nodes.md` | creating/updating/querying nodes via REST, auto-connect, connections, linking nodes |
| § 4 Images | `references/s04-images.md` | uploading images, snapshots, image nodes, placing or sketching images |
| § 5 Slices | `references/s05-slices.md` | creating slices or slice definitions on a timeline |
| § 6 Specifications (GWT scenarios, Storylines) | `references/s06-specifications.md` | adding/reading Given-When-Then scenarios, spec-info, or storylines |
| § 7 Config Import | `references/s07-config-import.md` | importing a config.json into a board |
| § 8 Slice Data (incl. slice features, rework reporting, prototype) | `references/s08-slice-data.md` | reading slice data via REST, slice features, rework reports, or prototype context |
| § 9 Extensions | `references/s09-extensions.md` | listing or toggling board extensions |
| § 10 Snapshots | `references/s10-snapshots.md` | creating, sharing, reading or deleting board snapshots |
| § 11-12 Invitations (commands and read models) | `references/s11-12-invitations.md` | inviting users to an organization, confirming or listing invitations |
| § 13 Utility | `references/s13-utility.md` | `/api/user`, api-docs, swagger |
| § 14 Prompts (incl. agent-alive heartbeat) | `references/s14-prompts.md` | creating/claiming/updating prompts, realtime token, agent heartbeat |
| § 15 Chat attachments | `references/s15-chat-attachments.md` | a chat turn carries an attachment (image, file) you must fetch and handle |
| § 16 Chat snippets (incl. custom snippet types) | `references/s16-chat-snippets.md` | posting chat messages: poll, a2ui form, walkthrough and other snippet kinds, their shapes, custom snippet kinds |
| Domain Events, Key Source Files | `references/domain-events-and-source-files.md` | you need event names of snapshots/invitations or want to locate platform source |

---

### Which read to use

Pick the cheapest read that answers the step's question, and name the reason in one short clause next to the call:

| The step needs | Read |
|---|---|
| ids, titles, types, attribute names only (existence check, dedupe by title, pick a chapter/context, find a node by name, count elements) | `get_nodes` with `projection: "line"` |
| a chapter's grid / cell occupancy | `get_node { nodeId: <chapterId>, projection: "cells" }` |
| one node's connections | `get_node { nodeId, projection: "edges" }` |
| what is where in a chapter (incl. cell names for placement), plus `sliceStatus` per column | `get_board_outline` |
| field types, examples, field descriptions | `get_nodes` with `projection: "fields"`, scoped by `chapterId` or `nodeIds` |
| a node's description, position, HTML | full `get_nodes`, scoped by `chapterId` or `nodeIds` — never board-wide when avoidable |
| finding slices / their elements / element counts | `get_slice_data` with `projection: "outline"` (format `json`/`yaml`/`toon`) |
| attribute, field-flow or completeness work | `get_slice_data` with `projection: "fields"` |
| scenario / spec review, spec coverage | `get_slice_data` with `projection: "specs"` (format `json`/`yaml`/`toon`) |
| elements **and** specs **and** comments/prompts together (e.g. a business review) | full `get_slice_data` — say why |

Two cheap projected calls (e.g. `outline` + `specs`) beat one full call when the step doesn't need comments, prompts or field bodies. `projection: "line"` never carries `sliceStatus`, `meta`, positions, field types or examples; `projection: "fields"` adds the full field definitions and `parentId`, still no `sliceStatus`, positions or node description — if a later step reads any of those, use the full read. `get_nodes { type: "CHAPTER" }` without a projection returns every chapter's full grid; to just list or pick chapters, add `projection: "line"`.

---

## Authentication & Headers

| Header | Required | Purpose |
|---|---|---|
| `Authorization` | Some routes | Supabase JWT bearer token |
| `x-user-id` | Node operations | User identifier |
| `x-agent-id` | Optional | The agent process making the call — the uuid it also sends as `agent_id` on its heartbeat (`$EVENTMODELERS_AGENT_ID`, resolved by the `connect` skill). Stored on the `board_events` rows a write produces and broadcast with them, so the board shows *which* agent touched an element instead of one anonymous agent for all of them, and it decides who may claim a prompt addressed to a preferred agent. Send it on every call; a value that isn't uuid-shaped is ignored. |
| `x-chat-session-id` | Optional | The chat session the change is made for (`CHAT_SESSION_ID` — a prompt turn's `origin_session_id`). Send it on every **write** under `/api/org/:orgId/boards/:boardId/...` while working a prompt that came from a chat; omit it otherwise. Stored as `session_id` on every board event the write produces, so the board's history traces the change back to that conversation. Agents only — ignored on a browser login. Only an active session of the call's own board is stored; anything else (not a uuid, unknown, deleted, another board's) is dropped and the write goes ahead without it. MCP tools take it as their `sessionId` argument instead. |
| `x-causation-id` | Optional | Event causation tracing |
| `x-correlation-id` | Optional | Correlation tracing |

- CORS allowed origins: `localhost:3000`, `localhost:3001`, `https://app.eventmodelers.ai`

---
