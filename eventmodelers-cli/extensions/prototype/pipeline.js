// The stages of a multi-stage update that touch the board: write the changes that are applied locally to the board, one by one in global
// order — each as the node:changed event it is (changes.js) — and record what happened to each (ChangeSubmitted); then whatever else the local
// model differs by (sync.js) the ordinary way. One place for the loop, `prototype changes submit` and the Sync request.
import { claimChange, control, recordSubmitted, settleChange } from './control.js';
import { executeChange } from './execute.js';
import { runSync } from './sync.js';

const OPEN = ['requested', 'working', 'applied'];

/**
 * Executes the open changes one by one in global order (execute.js — no agent). A change not yet applied is claimed, applied to the local model
 * and, with `toBoard`, written to the board; one applied earlier (a run without the board) only has its board part left, which `toBoard` does now.
 * A tool call has no local half, so without `toBoard` the run stops at the first one: the order is kept, it waits for the board. A failed change is
 * recorded failed and the run goes on. `only: 'applied'` is just the board part of what was applied before. Returns what happened, for the caller
 * to rebuild the page (`local`) and refresh the model after board tool calls (`toolCalls`).
 */
export async function runChanges(cwd, cfg, { toBoard = false, only = null, log = () => {}, fetchImpl } = {}) {
  const results = [];
  let local = false, toolCalls = false;
  for (const change of control(cwd).changes.filter((c) => OPEN.includes(c.state) && (!only || c.state === only))) {
    if (change.state === 'applied') {
      if (!toBoard) continue; // applied locally, waiting for the board
      let r;
      try { r = await executeChange(cwd, cfg, change, { toBoard: true, fetchImpl, skipLocal: true }); } catch (err) { r = { status: 'failed', note: err.message }; }
      recordSubmitted(cwd, change.id, r.status, r.note);
      log(`   ${r.status === 'submitted' || r.status === 'already' ? '↑' : '·'} ${change.summary} — ${r.status}${r.note ? ` (${r.note})` : ''}`);
      results.push({ id: change.id, summary: change.summary, applied: true, status: r.status, note: r.note });
      continue;
    }
    if (change.exec.kind === 'tool-call' && !toBoard) { log(`   ⏸ ${change.summary} — a board tool call waits for the board (Sync)`); break; }
    claimChange(cwd, change.id);
    let r;
    try { r = await executeChange(cwd, cfg, change, { toBoard, fetchImpl }); } catch (err) { r = { applied: false, status: 'failed', note: err.message }; }
    if (!r.applied) settleChange(cwd, change.id, 'failed', r.note);
    else {
      settleChange(cwd, change.id, 'applied', r.note);
      if (change.exec.kind === 'node:changed') local = true;
      if (r.status) recordSubmitted(cwd, change.id, r.status, r.note);
      if (change.exec.kind === 'tool-call') toolCalls = true;
    }
    log(`   ${r.applied ? '✓' : '✗'} ${change.summary}${r.status ? ` — ${r.status}` : ''}${r.note ? ` (${r.note})` : ''}`);
    results.push({ id: change.id, summary: change.summary, applied: r.applied, status: r.status, note: r.note });
  }
  return { results, local, toolCalls };
}

/** The changes applied locally that are waiting for the board, written to it oldest first. */
export async function submitApplied(cwd, cfg, log = () => {}, fetchImpl) {
  return (await runChanges(cwd, cfg, { toBoard: true, only: 'applied', log, fetchImpl })).results;
}

/** What `runChanges` would do without the board: the changes that can run, i.e. those before the first tool call. */
export function runnableLocally(cwd) {
  const out = [];
  for (const c of control(cwd).changes.filter((x) => x.state === 'requested' || x.state === 'working')) { if (c.exec.kind === 'tool-call') break; out.push(c); }
  return out;
}

/** Everything back to the board: the ordered changes first, then the rest of the local model's differences. */
export async function syncAll(cwd, cfg, { log = () => {}, quiet = true } = {}) {
  const { results: changes } = await runChanges(cwd, cfg, { toBoard: true, log }); // pending and applied-but-unsent ones, in one ordered pass
  const rest = await runSync({ cwd, cfg, yes: true, quiet });
  return { changes, rest };
}
