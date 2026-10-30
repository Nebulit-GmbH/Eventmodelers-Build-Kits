// The control channel between the prototype player and the agent: an event log, the same store the build kits use
// (shared/build-kit/lib/slice-events.js — .prototype/events/<id>.json plus the append-only index .prototype/events.log).
//
//   player → agent   SyncRequested      Sync: {}                                     write the local model's differences to the board
//                    FetchRequested     Fetch: {}                                    bring the board's latest slice definitions in (never over unsynced edits)
//                    RebuildRequested   Rebuild: {}                                  rebuild the page from the model
//   agent  → log     ControlClaimed     { ref }                                      started on that request
//                    ControlProcessed   { ref, outcome, note }                       done: applied | needs-you | failed
//
// Feedback is not part of this channel: it is collected in the player and submitted to the platform (the server's `/api/feedback`), where the
// platform's /apply-feedback applies it to the model.
//
// Nothing is deleted. What the agent has processed is itself in the log, so "what is new" is the requests no ControlProcessed refers
// to — the agent can stop, restart or be a different process each iteration and still knows where it was.
import { appendEvent, readEvents } from '../../shared/build-kit/lib/slice-events.js';
import { paths } from './state.js';

export const REQUESTS = ['SyncRequested', 'FetchRequested', 'RebuildRequested'];
export const OUTCOMES = ['applied', 'needs-you', 'failed'];

const log = (cwd) => paths(cwd).root;

/** Records what the player asked for: one of the requests above. */
export function record(cwd, type, data = {}) {
  if (!REQUESTS.includes(type)) throw new Error(`Not an event the player records: ${type}`);
  const id = appendEvent(log(cwd), { type, data: data && typeof data === 'object' ? data : {} }, {});
  return readEvents(log(cwd)).find((e) => e.id === id);
}

/** What the log folds to: every event, the requests still open (oldest first), and which ones are claimed or processed. */
export function control(cwd) {
  const events = readEvents(log(cwd));
  const processed = new Map(), claimed = new Map();
  for (const e of events) {
    if (e.type === 'ControlProcessed') processed.set(e.data.ref, e.data);
    if (e.type === 'ControlClaimed') claimed.set(e.data.ref, e);
  }
  const requests = events.filter((e) => REQUESTS.includes(e.type));
  const pending = requests.filter((e) => !processed.has(e.id));
  return { events, requests, pending, processed, claimed };
}

/** The agent says it has started on a request. */
export function claim(cwd, ref) {
  if (!control(cwd).requests.some((e) => e.id === ref)) throw new Error(`No such request: ${ref}`);
  return appendEvent(log(cwd), { type: 'ControlClaimed', data: { ref } }, {});
}

/** The agent says it is done with a request — however it went; a processed request is not picked up again. */
export function markProcessed(cwd, ref, outcome, note = '') {
  const found = control(cwd).requests.find((e) => e.id === ref || e.id.startsWith(ref));
  if (!found) throw new Error(`No such request: ${ref}`);
  if (!OUTCOMES.includes(outcome)) throw new Error(`The outcome is one of: ${OUTCOMES.join(', ')}`);
  return appendEvent(log(cwd), { type: 'ControlProcessed', data: { ref: found.id, outcome, note: String(note).slice(0, 500) } }, {});
}

/** One request as the player shows it: sent (open), working (claimed), or done / needs-you / failed. */
export function stateOf(c, id) {
  const p = c.processed.get(id);
  if (p) return p.outcome;
  return c.claimed.has(id) ? 'working' : 'sent';
}
