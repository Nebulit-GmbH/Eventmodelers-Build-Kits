// When the loop spends a turn on the learnings. The curator is an LLM turn that only writes events —
// `learn --merge` and `learn --retract` — and the loop marks the review done afterwards (`learnings-curated`),
// whatever came of the turn: a curator that failed or timed out does not make the loop retry in a tight loop,
// the next review comes after more learnings have piled up.

import { appendEvent, readEvents } from './slice-events.js';
import { fold, needsCuration } from './slice-state.js';
import { curationRequest } from './slice-learnings.js';

const DEFAULT_THRESHOLD = 10;

// Learnings recorded since the last review before a turn is worth it: RALPH_CURATE_AFTER, 0 switches
// curation off.
export function curationThreshold(env = process.env) {
  const raw = env.RALPH_CURATE_AFTER;
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

// Runs a curation turn when enough new learnings are waiting and no slice is being built. `onCurate(prompt,
// { env })` is the runner's agent turn; `env` must reach the agent's process (EVENTMODELERS_CURATING=1 makes
// `learn` refuse to record new learnings — the curator tidies, it does not add facts). It is passed along
// instead of set on process.env because the runners build their child environment once, at load time.
// Returns whether a turn was run.
export async function curateIfDue({ kitDir, meta, onCurate, threshold = curationThreshold() }) {
  if (!onCurate || !threshold) return false;
  const state = fold(readEvents(kitDir));
  if (!needsCuration(state, threshold)) return false;
  if (Object.values(state.slices).some((s) => s.claim)) return false;

  console.log(`[ralph] ${state.learnings.filter((l) => !l.curated).length} new learnings — curating them.`);
  try {
    await onCurate(curationRequest(state.learnings), { env: { EVENTMODELERS_CURATING: '1' } });
  } catch (err) {
    console.error('[ralph] The curation turn failed — the learnings stay as they are:', err.message);
  }
  appendEvent(kitDir, { type: 'learnings-curated' }, meta);
  return true;
}
