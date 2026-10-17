// The slice-state event store, local to this checkout and never committed:
//   .build-kit/events/<id>.json  one standalone JSON file per event
//   .build-kit/events.log        append-only index, one event id per line — its order is the event order
// An event exists once its id is in the index. A file the index doesn't list (a crash between the two
// writes) is never applied, and an index line without a readable file is skipped. `fold` (slice-state.js)
// derives all state from readEvents.

import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

export const EVENTS_DIR = 'events';
export const INDEX_FILE = 'events.log';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// True when the index ends in the middle of a line — a crash during an append left a fragment.
function endsMidLine(path) {
  if (!existsSync(path)) return false;
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

// The event file is written whole (temp file, then rename) before its id is indexed, so a reader that
// finds the id finds a complete file. The index line is one short append-mode write, so lines from
// concurrent processes never interleave however large the event. After a torn index line the new id
// starts on a fresh line instead of being glued onto the fragment. Returns the event id.
export function appendEvent(kitDir, event) {
  const dir = join(kitDir, EVENTS_DIR);
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const tmp = join(dir, `${id}.tmp`);
  writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), ...event, id }, null, 2), 'utf-8');
  renameSync(tmp, join(dir, `${id}.json`));
  const index = join(kitDir, INDEX_FILE);
  appendFileSync(index, `${endsMidLine(index) ? '\n' : ''}${id}\n`, 'utf-8');
  return id;
}

export function readEvents(kitDir) {
  const index = join(kitDir, INDEX_FILE);
  if (!existsSync(index)) return [];
  const events = [];
  const seen = new Set();
  for (const line of readFileSync(index, 'utf-8').split('\n')) {
    const id = line.trim();
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    try {
      events.push(JSON.parse(readFileSync(join(kitDir, EVENTS_DIR, `${id}.json`), 'utf-8')));
    } catch { /* indexed but missing or unreadable — skipped */ }
  }
  return events;
}
