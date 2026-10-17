// Slice status in `.slices/<ctx>/index.json` and `slice.json` is a read-only view of the event log — the
// build agent reads those files, but nothing writes status into them except this projection.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendEvent, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';

// The loop's status for a slice, falling back to what the board said when the log knows nothing of it.
export function statusOf(state, slice) {
  return state.slices[slice.id]?.status ?? slice.status;
}

// Records what the board shows. Only changes become events, so a refresh every few seconds does not
// grow the log. Returns the folded state.
export function observeBoard(kitDir, boardSlices) {
  const state = fold(readEvents(kitDir));
  let changed = false;
  for (const { id, status } of boardSlices) {
    if (!id || !status || state.slices[id]?.lastBoardStatus === status) continue;
    appendEvent(kitDir, { type: 'board-observed', slice: id, status });
    changed = true;
  }
  return changed ? fold(readEvents(kitDir)) : state;
}

function writeJsonAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

// Sets status (and the Blocked note) on one parsed file's object; true when anything changed.
function apply(target, slice) {
  const want = { status: slice.status, blockedReason: slice.blocked?.reason, blockedAt: slice.blocked?.at };
  let changed = false;
  for (const [key, value] of Object.entries(want)) {
    if (value === undefined) {
      if (key !== 'status' && key in target) { delete target[key]; changed = true; }
    } else if (target[key] !== value) {
      target[key] = value;
      changed = true;
    }
  }
  return changed;
}

// Writes the derived status into every index.json entry (and its `definition`) and slice.json the log
// has a status for. Everything else in those files is left alone, and a file is only rewritten when
// something changed. Returns how many files were written.
export function projectStatus(kitDir, state) {
  const slicesDir = join(kitDir, '.slices');
  if (!existsSync(slicesDir)) return 0;
  let written = 0;
  for (const ctx of readdirSync(slicesDir, { withFileTypes: true })) {
    if (!ctx.isDirectory()) continue;
    const indexPath = join(slicesDir, ctx.name, 'index.json');
    if (!existsSync(indexPath)) continue;
    let index;
    try { index = JSON.parse(readFileSync(indexPath, 'utf-8')); } catch { continue; }
    let indexChanged = false;
    for (const entry of index.slices ?? []) {
      const slice = state.slices[entry.id];
      if (!slice?.status) continue;
      if (apply(entry, slice)) indexChanged = true;
      if (entry.definition && entry.definition.status !== slice.status) { entry.definition.status = slice.status; indexChanged = true; }
      const slicePath = join(slicesDir, ctx.name, entry.folder ?? '', 'slice.json');
      if (!entry.folder || !existsSync(slicePath)) continue;
      try {
        const data = JSON.parse(readFileSync(slicePath, 'utf-8'));
        if (apply(data, slice)) { writeJsonAtomic(slicePath, data); written++; }
      } catch { /* an unreadable slice.json is left for the next full fetch to repair */ }
    }
    if (indexChanged) { writeJsonAtomic(indexPath, index); written++; }
  }
  return written;
}
