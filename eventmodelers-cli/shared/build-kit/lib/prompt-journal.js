// The modeling agent's journal of the board prompts it takes: `prompt-received` when it claims one, then
// `prompt-finished` with the outcome. The platform decides who gets a prompt (an atomic claim); this is the
// agent's own record of what it had in hand.

import { appendEvent, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';
import { redactString } from './redact.js';

// What identifies the prompt and what `replay` needs to submit it again (text, timeline, canvas context) — not the
// platform's own columns (status, claim, timestamps).
export function journalPromptReceived({ kitDir, prompt, meta }) {
  if (!prompt?.id) return;
  appendEvent(kitDir, {
    type: 'prompt-received',
    pid: process.pid,
    prompt: {
      id: prompt.id,
      text: String(prompt.prompt ?? ''),
      board_id: prompt.board_id,
      timeline_id: prompt.timeline_id,
      ...(prompt.context ? { context: prompt.context } : {}),
      priority: prompt.priority,
      agent_id: prompt.agent_id ?? null,
      node_id: prompt.node_id,
      comment_id: prompt.comment_id,
    },
  }, meta);
}

// outcome: worked | released | already-settled | gone. A turn that failed is not finished: its entry stays
// open, and the next start recovers it.
export function journalPromptFinished({ kitDir, id, outcome, reason, meta }) {
  appendEvent(kitDir, { type: 'prompt-finished', prompt: id, outcome, ...(reason ? { reason } : {}) }, meta);
}

// ── what a turn did on the board ────────────────────────────────────────────────
// `prompt-received` and `prompt-finished` say a prompt was taken and a turn ended; they cannot say what happened in
// between. Each board write the turn makes is journaled as it streams past — a comment, a slice moved to Blocked,
// nodes placed — so the log reads as what the agent did, and a turn that dies half way still shows how far it got.
// Reads are not journaled. Only what the runner can see is: a write made through curl in Bash is not.

const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const count = (list) => (Array.isArray(list) ? list.length : 1);

// tool → what to journal; null for a tool that writes nothing to the board.
const BOARD_WRITES = {
  add_comment: ({ comments = [] }) => {
    const nodes = new Set(comments.map((c) => c?.nodeId).filter(Boolean)).size;
    const first = oneLine(comments[0]?.text, 100);
    return { action: 'commented', detail: `${plural(comments.length, 'comment')} on ${plural(nodes, 'node')}${first ? `: "${first}"` : ''}` };
  },
  update_comment: ({ action, commentId }) => ({ action: `comment-${action === 'delete' ? 'deleted' : 'resolved'}`, detail: String(commentId ?? '').slice(0, 8) }),
  update_slice_status: ({ newStatus, sliceId, sliceTitle }) => ({ action: 'slice-status', detail: `${sliceTitle ? `"${oneLine(sliceTitle, 60)}"` : String(sliceId ?? '').slice(0, 8)} → ${newStatus}` }),
  submit_node_events: ({ events = [] }) => {
    const by = {};
    for (const e of events) by[e?.type ?? 'event'] = (by[e?.type ?? 'event'] ?? 0) + 1;
    return { action: 'nodes-changed', detail: Object.entries(by).map(([t, n]) => `${n} ${t}`).join(', ') };
  },
  place_element: ({ elements }) => ({ action: 'placed', detail: plural(count(elements), 'element') }),
  delete_node: ({ nodeIds }) => ({ action: 'nodes-deleted', detail: plural(count(nodeIds), 'node') }),
  create_slice: ({ type, status }) => ({ action: 'slice-created', detail: [type, status].filter(Boolean).join(', ') }),
  create_chapter: ({ title }) => ({ action: 'chapter-created', detail: title ? `"${oneLine(title, 60)}"` : '' }),
  add_column: ({ count: n = 1 }) => ({ action: 'columns-added', detail: String(n) }),
  add_lane: ({ lanes }) => ({ action: 'lanes-added', detail: String(count(lanes)) }),
  add_scenario: ({ scenarios }) => ({ action: 'scenarios-added', detail: String(count(scenarios)) }),
  add_storyline: ({ storylines }) => ({ action: 'storylines-added', detail: String(count(storylines)) }),
  set_connection: ({ connections }) => ({ action: 'connections-changed', detail: String(count(connections)) }),
  link_element: () => ({ action: 'linked', detail: '' }),
  create_screen: ({ screens }) => ({ action: 'screens-created', detail: String(count(screens)) }),
  post_chat_message: ({ text }) => ({ action: 'chat-posted', detail: `"${oneLine(text, 100)}"` }),
};

// The journal entry for a tool call, or null when it is not a board write.
export function describeBoardAction(toolName, input) {
  const describe = BOARD_WRITES[String(toolName).split('__').pop()];
  return describe ? describe(input ?? {}) : null;
}

// Under `verbose` every call leaves exactly one entry: a board write as its action, any other call (a read, Bash, a
// skill) as a `tool-call` with `detail` — the caller's one-line account of its input — and both carry the call's full
// `input`, so `events --verbose` can show what was actually sent. The input is stored with the API token and anything
// JWT-shaped masked: a skill's arguments can hold credentials, and this log is a plain file.
//
// A call is journaled when it ends, as one entry: stamped with when it started, and carrying `durationMs` and, when the
// tool reported one, `error`. Timing costs nothing beyond a clock read at each end (createCallTracker).
export function journalPromptAction({ kitDir, id, toolName, input, verbose = false, detail, secrets = [], startedAt, durationMs, error = false, meta }) {
  if (!id) return;
  const done = describeBoardAction(toolName, input);
  if (!done && !verbose) return;
  const payload = verbose && input !== undefined ? { input: JSON.parse(redactString(JSON.stringify(input), secrets)) } : {};
  const timing = { ...(startedAt ? { at: startedAt } : {}), ...(durationMs !== undefined ? { durationMs } : {}), ...(error ? { error: true } : {}) };
  if (done) appendEvent(kitDir, { type: 'prompt-action', prompt: id, ...done, ...timing, ...payload }, meta);
  else appendEvent(kitDir, { type: 'tool-call', prompt: id, tool: toolName, ...(detail ? { detail } : {}), ...timing, ...payload }, meta);
}

// Which calls are in flight, and for how long. `begin` and `end` are a Map operation and a clock read; calls that are
// never going to be journaled should not be begun (shouldJournalCall). `drain` returns what never ended — a turn that
// died mid-call — without a duration.
export const shouldJournalCall = (toolName, input, verbose) => verbose || describeBoardAction(toolName, input) !== null;

export function createCallTracker({ now = () => performance.now(), clock = () => new Date().toISOString() } = {}) {
  const open = new Map();
  return {
    begin(id, call) { open.set(id, { ...call, startedAt: clock(), t0: now() }); },
    end(id, { isError = false } = {}) {
      const call = open.get(id);
      if (!call) return null;
      open.delete(id);
      const { t0, ...rest } = call;
      return { ...rest, durationMs: Math.round(now() - t0), error: !!isError };
    },
    drain() {
      const rest = [...open.values()].map(({ t0, ...call }) => call);
      open.clear();
      return rest;
    },
  };
}

export function openPrompts(kitDir) {
  return fold(readEvents(kitDir)).prompts;
}

// ── restart recovery ────────────────────────────────────────────────────────────
// The platform records who holds a prompt (`claimed_by`, the agent id) and never re-queues one by itself. A
// freshly started agent holds nothing, so whatever the platform still shows as CLAIMED / IN_PROGRESS under its
// own id is what an earlier run left behind — handed back at start. (Prompts of an agent that never comes back
// are the platform's to release, once its heartbeat has lapsed.) Two live processes must not share one agent
// id: the second would hand back the first one's prompts.

const REASON = 'recovered after a restart';

// `fetchHeld(agentId)` → [{ id, status }] the platform shows as held by that agent; `release(id)` puts a prompt
// back on the queue and throws an error carrying `status` when the platform refuses. The journal's open entries
// are closed along the way: released ones as 'released', the rest as 'already-settled'. Whatever cannot be
// settled now (platform unreachable, a 5xx on a hand-back) stays open and is tried again at the next start.
export async function recoverOwnPrompts({ kitDir, meta, agentId, fetchHeld, release }) {
  const open = openPrompts(kitDir);
  const result = { released: 0, settled: 0, left: 0 };
  if (!agentId) return { ...result, left: open.length };

  let held;
  try {
    held = await fetchHeld(agentId);
  } catch (err) {
    console.error(`[modeling] could not ask the platform which prompts this agent was holding${open.length ? ` — leaving ${open.length} unfinished for the next start` : ''}:`, err.message);
    return { ...result, left: open.length };
  }

  const finish = (id, outcome) => journalPromptFinished({ kitDir, id, outcome, reason: REASON, meta });
  const isOpen = (id) => open.some((p) => p.id === id);
  for (const { id } of held) {
    try {
      await release(id);
      if (isOpen(id)) finish(id, 'released');
      result.released++;
    } catch (err) {
      // 409: it is already back on the queue; 404: it was deleted — nothing left to hand back.
      if (err?.status === 409 || err?.status === 404) {
        if (isOpen(id)) finish(id, err.status === 404 ? 'gone' : 'already-settled');
        result.settled++;
      } else {
        console.error(`[modeling] could not hand prompt ${id} back — it stays held for the next start:`, err.message);
        result.left++;
      }
    }
  }
  // Entries the platform does not show as held any more finished (or went) after all.
  const heldIds = new Set(held.map((h) => h.id));
  for (const p of open) {
    if (heldIds.has(p.id)) continue;
    finish(p.id, 'already-settled');
    result.settled++;
  }
  return result;
}

// What asks the platform which prompts an agent holds: GET /prompts?claimed_by=, which reads and claims nothing.
// Like the other prompt routes it needs the API token *and* an authenticated user — the realtime JWT the agent
// already holds for /prompts/next.
export function heldPromptsRequest({ baseUrl, organizationId, boardId, token, jwt, agentId }) {
  const query = new URLSearchParams({ board_id: boardId, claimed_by: agentId, status: 'CLAIMED,IN_PROGRESS', limit: '500' });
  return {
    url: `${baseUrl}/api/org/${organizationId}/prompts?${query}`,
    headers: { 'x-token': token, Authorization: `Bearer ${jwt}`, 'x-agent-id': agentId },
  };
}
