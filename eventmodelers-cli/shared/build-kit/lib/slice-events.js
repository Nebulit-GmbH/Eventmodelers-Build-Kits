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
export const SEQ_FILE = 'events.seq';

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

// Tags label any event (an area, a topic, who it is for). Anything but non-blank strings is dropped, the
// rest trimmed and de-duplicated; an event without usable tags has no `tags` field at all.
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean))];
}

// Where an event came from: the agent that wrote it, what kind it is (BUILD or MODELING) and the organization and
// board it ran against. Only these four keys are kept (never a token or anything else that wandered into the config), blank values
// dropped; no usable metadata means no `meta` field.
const META_KEYS = ['agent_id', 'agent_type', 'organization_id', 'board_id'];
export function normalizeMeta(meta) {
  const clean = {};
  for (const key of META_KEYS) {
    const value = typeof meta?.[key] === 'string' ? meta[key].trim() : '';
    if (value) clean[key] = value;
  }
  return clean;
}

// The last sequence number handed out is remembered next to the index (SEQ_FILE), so numbers keep climbing
// when events are pruned or the log is rebuilt. A kit that has no such file yet (a log written before events
// were numbered) continues from its newest event: its own `seq`, or how many events precede it. Two processes
// appending in the same instant can draw the same number — nothing enforces uniqueness, here or on the server:
// the index order decides, and readEvents renumbers so a reader still sees a strictly increasing sequence.
function newestEventSeq(kitDir) {
  const index = join(kitDir, INDEX_FILE);
  if (!existsSync(index)) return 0;
  const ids = readFileSync(index, 'utf-8').split('\n').map((l) => l.trim()).filter((l) => ID.test(l));
  for (let i = ids.length - 1; i >= 0; i--) {
    try {
      const { seq } = JSON.parse(readFileSync(join(kitDir, EVENTS_DIR, `${ids[i]}.json`), 'utf-8'));
      return Number.isInteger(seq) ? seq : i + 1;
    } catch { /* unreadable — look at the one before */ }
  }
  return 0;
}

// Takes the next number and remembers it.
function nextSeq(kitDir) {
  const file = join(kitDir, SEQ_FILE);
  let remembered = 0;
  try { remembered = Number.parseInt(readFileSync(file, 'utf-8'), 10) || 0; } catch { /* none yet */ }
  const seq = Math.max(remembered, newestEventSeq(kitDir)) + 1;
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, String(seq), 'utf-8');
  renameSync(tmp, file);
  return seq;
}

// The event file is written whole (temp file, then rename) before its id is indexed, so a reader that
// finds the id finds a complete file. The index line is one short append-mode write, so lines from
// concurrent processes never interleave however large the event. After a torn index line the new id
// starts on a fresh line instead of being glued onto the fragment. Every event gets the next sequence number
// (`seq`), which — not the timestamp — defines the order. Returns the event id.
export function appendEvent(kitDir, event, meta) {
  const dir = join(kitDir, EVENTS_DIR);
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const tmp = join(dir, `${id}.tmp`);
  // The caller's metadata is the only metadata: one carried in the event itself is dropped.
  const { tags, meta: _ignored, ...rest } = event;
  const cleanTags = normalizeTags(tags);
  const cleanMeta = normalizeMeta(meta);
  writeFileSync(tmp, JSON.stringify({
    at: new Date().toISOString(),
    ...rest,
    ...(cleanTags.length ? { tags: cleanTags } : {}),
    ...(Object.keys(cleanMeta).length ? { meta: cleanMeta } : {}),
    seq: nextSeq(kitDir),
    id,
  }, null, 2), 'utf-8');
  renameSync(tmp, join(dir, `${id}.json`));
  const index = join(kitDir, INDEX_FILE);
  appendFileSync(index, `${endsMidLine(index) ? '\n' : ''}${id}\n`, 'utf-8');
  return id;
}

// All events in index order, each with its `seq`; with `tag`, only those carrying it.
export function readEvents(kitDir, { tag } = {}) {
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
  // Strictly increasing in index order: an event from before numbering, or one that drew the same number as its
  // predecessor, takes the next free one.
  let prev = 0;
  for (const e of events) {
    if (!Number.isInteger(e.seq) || e.seq <= prev) e.seq = prev + 1;
    prev = e.seq;
  }
  return tag === undefined ? events : events.filter((e) => e.tags?.includes(tag));
}
