// Info events: what an agent reports that is not a reusable learning — "I can't change X because Y", a
// decision it took, a note for whoever reads the board. A learning is true of the codebase or the model for
// every later build (slice-learnings.js); an info is about this slice, now. Infos feed no projection — the
// event is the record — and are also posted as a comment on the slice, so the board shows them.

import { appendEvent } from './slice-events.js';

export const INFO_KINDS = ['limitation', 'decision', 'note'];
const MAX_INFO_LENGTH = 500;

export function recordInfo({ kitDir, text, kind = 'note', slice, tags, meta }) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('the info is empty');
  if (!INFO_KINDS.includes(kind)) throw new Error(`kind must be ${INFO_KINDS.join(', ')}, not "${kind}"`);
  const id = appendEvent(kitDir, { type: 'info-recorded', kind, text: clean.slice(0, MAX_INFO_LENGTH), ...(slice ? { slice } : {}), tags }, meta);
  return { id, text: clean.slice(0, MAX_INFO_LENGTH), kind };
}

// The comment the board shows for an info.
export function infoComment({ kind, text }) {
  return `[${kind}] ${text}`;
}

// ── infos a turn states in its reply ────────────────────────────────────────────
// Same contract as learnings: the locked-down modeling agent ends a reply with `Info [<kind>]: <line>` and
// the CLI records it. At most five per reply, each capped, so what a board collaborator can talk the agent
// into saying stays small.
const MAX_TURN_INFOS = 5;
const TURN_INFO = /^\s*(?:[-*]\s+)?info(?:\s*\[([^\]]{1,20})\])?:\s*(.*?)\s*$/i;

export function parseTurnInfos(reply) {
  const found = [];
  let fenced = false;
  for (const line of String(reply ?? '').split('\n')) {
    if (line.trim().startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = TURN_INFO.exec(line);
    if (!m) continue;
    const text = m[2];
    if (!text || /^none\.?$/i.test(text) || text.length > MAX_INFO_LENGTH) continue;
    const kind = m[1]?.trim().toLowerCase();
    found.push({ kind: INFO_KINDS.includes(kind) ? kind : 'note', text });
    if (found.length === MAX_TURN_INFOS) break;
  }
  return found;
}

export function recordTurnInfos({ kitDir, reply, meta }) {
  const infos = parseTurnInfos(reply);
  for (const { kind, text } of infos) recordInfo({ kitDir, text, kind, tags: ['modeling'], meta });
  return infos.length;
}
