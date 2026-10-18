// The modeling agent's journal of the board prompts it takes: `prompt-received` when it claims one, then
// `prompt-finished` with the outcome. The platform decides who gets a prompt (an atomic claim); this is the
// agent's own record of what it had in hand — what a restart finds still open is what a crash left behind.

import { appendEvent, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';
import { isProcessAlive } from './slice-run.js';

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

// ── crash recovery ──────────────────────────────────────────────────────────────
// The platform never re-queues a claimed prompt by itself, so one a crashed agent was holding stays CLAIMED or
// IN_PROGRESS for good. On start the agent looks at what its journal still has open and asks the platform where
// each stands (`GET /prompts?ids=`): a status write is unconditional, so a prompt that is already DONE must never
// be "released" — only the ones still held are handed back (status ADDED), the rest are just closed.

const REASON = 'recovered after a restart';

// `platform` maps prompt id → status for the prompts it still knows. A prompt held by another live process of
// this kit is left alone; one of this process or of a dead one is recovered.
export function decidePromptRecovery(open, platform, { isAlive, selfPid }) {
  const plan = [];
  for (const p of open) {
    if (p.pid !== selfPid && isAlive(p.pid)) continue;
    const status = platform.get(p.id);
    if (status === undefined) plan.push({ id: p.id, action: 'finish', outcome: 'gone' });
    else if (status === 'CLAIMED' || status === 'IN_PROGRESS') plan.push({ id: p.id, action: 'release' });
    else plan.push({ id: p.id, action: 'finish', outcome: 'already-settled' });
  }
  return plan;
}

// `fetchStatuses(ids)` → Map(id → status); `release(id)` puts a prompt back on the queue and throws an error
// carrying `status` when the platform refuses. Anything that cannot be settled now (platform unreachable, a 5xx
// on the hand-back) stays open and is tried again at the next start. Returns what happened.
export async function recoverOpenPrompts({ kitDir, meta, fetchStatuses, release, isAlive = isProcessAlive, selfPid = process.pid }) {
  const open = openPrompts(kitDir);
  const result = { released: 0, settled: 0, left: 0 };
  if (!open.length) return result;

  let platform;
  try {
    platform = await fetchStatuses(open.map((p) => p.id));
  } catch (err) {
    console.error(`[modeling] could not ask the platform about ${open.length} unfinished prompt(s) — leaving them for the next start:`, err.message);
    return { ...result, left: open.length };
  }

  const plan = decidePromptRecovery(open, platform, { isAlive, selfPid });
  result.left = open.length - plan.length;
  const finish = (id, outcome) => journalPromptFinished({ kitDir, id, outcome, reason: REASON, meta });
  for (const step of plan) {
    if (step.action === 'finish') {
      finish(step.id, step.outcome);
      result.settled++;
      continue;
    }
    try {
      await release(step.id);
      finish(step.id, 'released');
      result.released++;
    } catch (err) {
      // 409: it already has that status (someone put it back); 404: it was deleted — nothing left to hand back.
      if (err?.status === 409) { finish(step.id, 'already-settled'); result.settled++; }
      else if (err?.status === 404) { finish(step.id, 'gone'); result.settled++; }
      else { console.error(`[modeling] could not hand prompt ${step.id} back — it stays open for the next start:`, err.message); result.left++; }
    }
  }
  return result;
}
