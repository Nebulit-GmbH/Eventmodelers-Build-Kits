// Pruning the event log. The log only grows, and most of it is the prompt journal — a received/finished pair per
// board prompt, plus every tool call of a `--verbose` run — which nothing reads once the prompt is finished. What
// the state is derived from (claims, settles, learnings, the task queue, prompts still open) is never touched.
// Before anything is deleted the state is folded from what would be left and compared with the state folded from
// the whole log; a difference aborts the prune.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { isDeepStrictEqual } from 'util';
import { join } from 'path';
import { EVENTS_DIR, INDEX_FILE, SEQ_FILE, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';
import { isProcessAlive } from './slice-run.js';

export const PRUNE_EVERY = 1000;
const ASKED_FILE = '.prune-asked'; // inside events/, which readEvents never lists and the kit's git rules already cover

const JOURNAL_TYPES = new Set(['prompt-received', 'prompt-finished', 'prompt-action', 'tool-call']);

// The events of prompts that have finished (and of nothing else).
export function prunableEvents(events) {
  const finished = new Set(events.filter((e) => e?.type === 'prompt-finished').map((e) => e.prompt));
  return events.filter((e) => e && JOURNAL_TYPES.has(e.type) && finished.has(e.type === 'prompt-received' ? e.prompt?.id : e.prompt));
}

// Deletes them: their files, then their lines from the index (rewritten whole and renamed into place). Returns
// { removed, kept }; removes nothing when there is nothing to remove, and throws without touching the log when
// the state folded from the rest would differ.
export function pruneLog(kitDir) {
  const events = readEvents(kitDir);
  const doomed = new Set(prunableEvents(events).map((e) => e.id));
  if (!doomed.size) return { removed: 0, kept: events.length };
  const rest = events.filter((e) => !doomed.has(e.id));
  if (!isDeepStrictEqual(fold(rest), fold(events))) throw new Error('pruning would change the state the log folds to — nothing was deleted');

  for (const id of doomed) rmSync(join(kitDir, EVENTS_DIR, `${id}.json`), { force: true });
  const index = join(kitDir, INDEX_FILE);
  const lines = readFileSync(index, 'utf-8').split('\n').filter((l) => l.trim() && !doomed.has(l.trim()));
  const tmp = `${index}.tmp`;
  writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '', 'utf-8');
  renameSync(tmp, index);
  return { removed: doomed.size, kept: rest.length };
}

// Deletes the whole log — every event, state included — so the kit starts over as if freshly installed: it looks at
// the board again and every slice's attempt count, block and failure history is gone. Refuses while a live process
// holds a claim (its build would end without a trace) unless `force`. Returns { removed, liveClaims }; with
// `dryRun` nothing is deleted.
export function clearLog(kitDir, { force = false, dryRun = false } = {}) {
  const events = readEvents(kitDir);
  const liveClaims = Object.entries(fold(events).slices)
    .filter(([, s]) => s.claim && isProcessAlive(s.claim.pid))
    .map(([id, s]) => s.claim.title ?? id);
  if (liveClaims.length && !force) throw new Error(`a run is building ${liveClaims.join(', ')} — stop it first, or pass --force`);
  if (dryRun) return { removed: events.length, liveClaims };
  const dir = join(kitDir, EVENTS_DIR);
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(kitDir, INDEX_FILE), { force: true });
  rmSync(join(kitDir, SEQ_FILE), { force: true });
  return { removed: events.length, liveClaims };
}

// Asked when the log has reached a multiple of PRUNE_EVERY it has not been asked at yet — 1000, then 2000, … — so a
// "no" is not repeated on every start. `remember` records the size the answer was given at.
const askedPath = (kitDir) => join(kitDir, EVENTS_DIR, ASKED_FILE);
const bucket = (n) => Math.floor(n / PRUNE_EVERY);

export function shouldOfferPrune(kitDir, count) {
  if (bucket(count) < 1) return false;
  let asked = 0;
  try { asked = Number(readFileSync(askedPath(kitDir), 'utf-8')) || 0; } catch { /* never asked */ }
  return bucket(count) > bucket(asked);
}

export function rememberPruneAnswer(kitDir, count) {
  if (!existsSync(join(kitDir, EVENTS_DIR))) mkdirSync(join(kitDir, EVENTS_DIR), { recursive: true });
  writeFileSync(askedPath(kitDir), String(count), 'utf-8');
}
