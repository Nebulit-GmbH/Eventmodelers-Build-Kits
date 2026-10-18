// The modeling agent's journal of the board prompts it takes: `prompt-received` when it claims one, then
// `prompt-finished` with the outcome. The platform decides who gets a prompt (an atomic claim); this is the
// agent's own record of what it had in hand.

import { appendEvent, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';

const MAX_TEXT = 300;

// Only what identifies the prompt — never its context or other platform columns.
export function journalPromptReceived({ kitDir, prompt, meta }) {
  if (!prompt?.id) return;
  appendEvent(kitDir, {
    type: 'prompt-received',
    pid: process.pid,
    prompt: {
      id: prompt.id,
      text: String(prompt.prompt ?? '').slice(0, MAX_TEXT),
      board_id: prompt.board_id,
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
    console.error(`[modeling] could not ask the platform which prompts this agent was holding — leaving ${open.length} unfinished for the next start:`, err.message);
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
