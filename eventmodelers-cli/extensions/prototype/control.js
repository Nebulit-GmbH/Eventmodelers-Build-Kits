// The control channel between the prototype player and the agent: an event log, the same store the build kits use
// (shared/build-kit/lib/slice-events.js — .prototype/events/<id>.json plus the append-only index .prototype/events.log).
//
//   player → agent   FeedbackRecorded   Submit: { name, events, feedbacks[] }       what people said about the prototype
//                    SyncRequested      Sync: {}                                     write everything not yet synced to the board, changes in order
//                    FeedbackAnswered   { ref, answers[] }                           the person answered the open questions of a feedback (the pill's modal)
//                    FeedbackDiscarded  { ref }                                      the person dropped a feedback: its pending change files are removed
//                    FetchRequested     Fetch: {}                                    bring the board's latest slice definitions in (never over unsynced edits)
//                    RebuildRequested   Rebuild: {}                                  rebuild the page from the model
//   agent  → log     ControlClaimed     { ref }                                      started on that request
//                    ControlProcessed   { ref, outcome, note }                       done: applied | needs-you | failed
//                    FeedbackTranslated { ref, questions }                           stage two done: the feedback became ChangeRequested files in
//                                                                                    .prototype/changes/ (changes.js); the request is open until they are applied
//                    ChangeClaimed / ChangeApplied / ChangeFailed  { ref, note }     stage three: one change at a time (ref = the change's id),
//                                                                                    applied to the local model and the page
//                    ChangeSubmitted    { ref, status, note }                        its node:changed event went to the board (submitted | already |
//                                                                                    conflict | gone | failed), or it has none (not-synced: local model only)
// Events and changes share one global order: `seq` comes from one counter (events.seq) — see changes.js.
//
// Nothing is deleted. What the agent has processed is itself in the log, so "what is new" is the requests no ControlProcessed refers
// to — the agent can stop, restart or be a different process each iteration and still knows where it was.
import { appendEvent, readEvents } from '../../shared/build-kit/lib/slice-events.js';
import { listChanges, removeChangeFiles } from './changes.js';
import { randomUUID } from 'node:crypto';
import { paths, readJson } from './state.js';
import { join } from 'node:path';

export const REQUESTS = ['FeedbackRecorded', 'FeedbackAnswered', 'SyncRequested', 'FetchRequested', 'RebuildRequested'];
const FEEDBACK_REQUESTS = ['FeedbackRecorded', 'FeedbackAnswered'];
const CHANGE_RESULTS = ['ChangeApplied', 'ChangeFailed'];
export const SUBMIT_STATUSES = ['submitted', 'already', 'conflict', 'gone', 'failed', 'not-synced'];
const PLAYER_EVENTS = [...REQUESTS, 'FeedbackSubmitted', 'FeedbackDiscarded'];
export const OUTCOMES = ['applied', 'needs-you', 'failed', 'discarded'];

const log = (cwd) => paths(cwd).root;

/** Records what the player asked for. Only the player's four events come in this way; the slice of a feedback's trail gets its title. */
export function record(cwd, type, data = {}) {
  if (!PLAYER_EVENTS.includes(type)) throw new Error(`Not an event the player records: ${type}`);
  if (type === 'FeedbackDiscarded') return discardFeedback(cwd, data.ref);
  let payload = {};
  if (type === 'FeedbackAnswered') {
    const c = control(cwd);
    const root = c.requests.find((e) => e.type === 'FeedbackRecorded' && e.id === data.ref);
    if (!root) throw new Error('No such feedback to answer');
    const asked = [...(c.translated.get(root.id)?.questions || []), ...c.events.filter((e) => e.type === 'FeedbackAnswered' && e.data.ref === root.id).flatMap((e) => c.translated.get(e.id)?.questions || [])];
    const answers = (Array.isArray(data.answers) ? data.answers : []).map((a) => ({ question: String(a.question || '').slice(0, 40), text: String(asked.find((q) => q.id === a.question)?.question || a.text || '').slice(0, 300), answer: String(a.answer || '').trim().slice(0, 1000) })).filter((a) => a.answer);
    if (!answers.length) throw new Error('There is no answer to record');
    payload = { ref: root.id, answers };
  }
  if (type === 'FeedbackRecorded' || type === 'FeedbackSubmitted') {
    const feedbacks = (Array.isArray(data.feedbacks) ? data.feedbacks : []).slice(-100);
    if (!feedbacks.length) throw new Error('There is no feedback to record');
    const status = readJson(join(paths(cwd).work, 'status.json'), { slices: [] });
    // The page marks a part with the slice's title (older builds: its id); the event carries both.
    const title = (ref) => (status.slices.find((s) => s.id === ref || s.title === ref) || {}).title || '';
    payload = {
      name: String(data.name || '').slice(0, 100),
      events: (Array.isArray(data.events) ? data.events : []).slice(-2000),
      feedbacks: feedbacks.map((f) => (f.trail && f.trail.slice ? { ...f, trail: { ...f.trail, sliceTitle: title(f.trail.slice) } } : f)),
    };
  }
  const id = appendEvent(log(cwd), { type, data: payload }, {});
  return readEvents(log(cwd)).find((e) => e.id === id);
}

/** What the log folds to: every event, the requests still open (oldest first), and which ones are claimed, translated or processed. */
export function control(cwd) {
  const events = readEvents(log(cwd));
  const processed = new Map(), claimed = new Map(), translated = new Map();
  const changeClaimed = new Map(), changeResult = new Map(), changeSubmitted = new Map();
  for (const e of events) {
    if (e.type === 'ControlProcessed') processed.set(e.data.ref, e.data);
    if (e.type === 'ControlClaimed') claimed.set(e.data.ref, e);
    if (e.type === 'FeedbackTranslated') translated.set(e.data.ref, e.data);
    if (e.type === 'ChangeClaimed') changeClaimed.set(e.data.ref, e);
    if (CHANGE_RESULTS.includes(e.type)) changeResult.set(e.data.ref, { ...e.data, type: e.type });
    if (e.type === 'ChangeSubmitted') changeSubmitted.set(e.data.ref, e.data);
  }
  const requests = events.filter((e) => REQUESTS.includes(e.type));
  // Feedback that was translated is not open for translation again: its changes carry it on.
  const pending = requests.filter((e) => !processed.has(e.id) && !translated.has(e.id));
  // requested → working (claimed) → applied (to the local model) → submitted | not-synced | conflict (to the board); failed ends it anywhere.
  const stateOfChange = (id) => {
    const r = changeResult.get(id);
    if (r && r.type === 'ChangeFailed') return 'failed';
    if (changeSubmitted.has(id)) { const s = changeSubmitted.get(id).status; return s === 'submitted' || s === 'already' ? 'submitted' : s === 'gone' ? 'failed' : s === 'failed' ? 'applied' : s; }  // a board that could not be reached leaves it applied: Sync retries
    if (r) return 'applied';
    return changeClaimed.has(id) ? 'working' : 'requested';
  };
  const changes = listChanges(cwd).map((c) => ({ ...c, state: stateOfChange(c.id), result: changeResult.get(c.id) || null, submission: changeSubmitted.get(c.id) || null }));
  return {
    events, requests, pending, processed, claimed, translated, changes,
    pendingChanges: changes.filter((c) => c.state === 'requested' || c.state === 'working'), // to be applied to the local model
    unsubmitted: changes.filter((c) => c.state === 'applied'), // applied locally, not yet on the board
  };
}

/** The agent says it has started on a request. */
export function claim(cwd, ref) {
  if (!control(cwd).events.some((e) => (REQUESTS.includes(e.type) || e.type === 'FeedbackSubmitted') && e.id === ref)) throw new Error(`No such request: ${ref}`);
  return appendEvent(log(cwd), { type: 'ControlClaimed', data: { ref } }, {});
}

/** The agent says it is done with a request — however it went; a processed request is not picked up again. */
export function markProcessed(cwd, ref, outcome, note = '') {
  const c = control(cwd);
  const found = c.events.find((e) => (REQUESTS.includes(e.type) || e.type === 'FeedbackSubmitted') && (e.id === ref || e.id.startsWith(ref)));
  if (!found) throw new Error(`No such request: ${ref}`);
  if (!OUTCOMES.includes(outcome)) throw new Error(`The outcome is one of: ${OUTCOMES.join(', ')}`);
  return appendEvent(log(cwd), { type: 'ControlProcessed', data: { ref: found.id, outcome, note: String(note).slice(0, 500) } }, {});
}

/** One request as the player shows it: sent (open), working (claimed, or translated into changes that are being applied), or done / needs-you / failed. */
export function stateOf(c, id) {
  const p = c.processed.get(id);
  if (p) return p.outcome;
  return c.claimed.has(id) || c.translated.has(id) ? 'working' : 'sent';
}

/** "3 of 5 changes applied" for a translated feedback; '' for anything else. */
export function progressOf(c, id) {
  const mine = c.changes.filter((ch) => ch.from.feedbackEvent === id);
  return c.translated.has(id) ? `${mine.filter((ch) => !['requested', 'working'].includes(ch.state)).length} of ${mine.length} changes applied` : '';
}

const findChange = (c, ref) => c.changes.find((ch) => ch.id === ref || ch.id.startsWith(ref));

/** A question the agent asks the person: { id, question, options[] } — from plain text or { question, options }. */
export function normalizeQuestion(q) {
  const o = typeof q === 'string' ? { question: q } : q || {};
  const question = String(o.question || '').trim().slice(0, 300);
  if (!question) return null;
  return { id: randomUUID().slice(0, 8), question, options: (Array.isArray(o.options) ? o.options : []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 6) };
}

/** Stage two is done: the feedback is now the ChangeRequested files in .prototype/changes/. `questions` are what still needs the person. */
export function markTranslated(cwd, ref, questions = []) {
  const c = control(cwd);
  const found = c.requests.find((e) => FEEDBACK_REQUESTS.includes(e.type) && (e.id === ref || e.id.startsWith(ref)));
  if (!found) throw new Error(`No such feedback request: ${ref}`);
  const mine = c.changes.filter((ch) => ch.from.feedbackEvent === found.id);
  const qs = questions.map(normalizeQuestion).filter(Boolean);
  if (!mine.length && !qs.length) throw new Error('This feedback has no changes and no questions — record it processed instead (prototype events processed … --outcome applied --note "nothing to change")');
  appendEvent(log(cwd), { type: 'FeedbackTranslated', data: { ref: found.id, questions: qs } }, {});
  settleFeedback(cwd, found.id); // nothing to apply but questions: it is done right away
  return mine;
}

/** What the player's modal needs for one feedback request: the comments, the open questions with their options, what was answered, and where it stands. */
export function detail(cwd, ref) {
  const c = control(cwd);
  const e = c.events.find((x) => x.id === ref || x.id.startsWith(ref));
  if (!e) return null;
  const rootId = e.type === 'FeedbackAnswered' ? e.data.ref : e.id;
  const root = c.events.find((x) => x.id === rootId);
  const answered = c.events.filter((x) => x.type === 'FeedbackAnswered' && x.data.ref === rootId);
  return {
    id: e.id, type: e.type, root: rootId, state: stateOf(c, e.id), note: (c.processed.get(e.id) || {}).note || '',
    comments: ((root && root.data.feedbacks) || []).map((f) => ({ id: f.id, comment: f.comment, element: (f.element || {}).text || (f.element || {}).tag || '', screen: (f.trail || {}).screen || '' })),
    questions: (c.translated.get(e.id) || {}).questions || [],
    answers: answered.flatMap((a) => a.data.answers),
  };
}

/**
 * The person drops a feedback: recorded as FeedbackDiscarded, its change files that were not executed yet are removed from .prototype/changes/
 * (what was already applied stays — the log keeps it), and the feedback and its answers are processed as discarded.
 */
export function discardFeedback(cwd, ref) {
  const c = control(cwd);
  const root = c.requests.find((e) => e.type === 'FeedbackRecorded' && (e.id === ref || e.id.startsWith(ref)));
  if (!root) throw new Error('No such feedback to discard');
  const family = [root.id, ...c.events.filter((e) => e.type === 'FeedbackAnswered' && e.data.ref === root.id).map((e) => e.id)];
  const id = appendEvent(log(cwd), { type: 'FeedbackDiscarded', data: { ref: root.id } }, {});
  const open = c.changes.filter((ch) => family.includes(ch.from.feedbackEvent) && (ch.state === 'requested' || ch.state === 'working'));
  removeChangeFiles(cwd, open.map((ch) => ch.id));
  // Also what was already processed (a feedback waiting for an answer is processed as needs-you): the latest outcome wins.
  for (const fid of family) if ((control(cwd).processed.get(fid) || {}).outcome !== 'discarded') markProcessed(cwd, fid, 'discarded', `discarded by the person${open.length ? `; ${open.length} change${open.length === 1 ? '' : 's'} removed` : ''}`);
  return readEvents(log(cwd)).find((e) => e.id === id);
}

export function claimChange(cwd, ref) {
  const found = findChange(control(cwd), ref);
  if (!found) throw new Error(`No such change: ${ref}`);
  return appendEvent(log(cwd), { type: 'ChangeClaimed', data: { ref: found.id } }, {});
}

/** One change is applied to the local model (or failed). When it was the last of its feedback, the feedback is processed. */
export function settleChange(cwd, ref, result, note = '') {
  const found = findChange(control(cwd), ref);
  if (!found) throw new Error(`No such change: ${ref}`);
  appendEvent(log(cwd), { type: result === 'applied' ? 'ChangeApplied' : 'ChangeFailed', data: { ref: found.id, note: String(note).slice(0, 500) } }, {});
  settleFeedback(cwd, found.from.feedbackEvent);
  return found;
}

/** The change's node:changed event went to the board — or it has none to send (not-synced). */
export function recordSubmitted(cwd, ref, status, note = '') {
  if (!SUBMIT_STATUSES.includes(status)) throw new Error(`status is one of: ${SUBMIT_STATUSES.join(', ')}`);
  const found = findChange(control(cwd), ref);
  if (!found) throw new Error(`No such change: ${ref}`);
  appendEvent(log(cwd), { type: 'ChangeSubmitted', data: { ref: found.id, status, note: String(note).slice(0, 500) } }, {});
  settleFeedback(cwd, found.from.feedbackEvent);
  return found;
}

// The feedback is done when every change is applied to the local model (or failed): applied, or needs-you with what failed and what is still asked.
// Writing them to the board is the next stage (Sync, or the loop's --sync) and has its own events.
function settleFeedback(cwd, feedbackId) {
  const c = control(cwd);
  if (!c.translated.has(feedbackId) || c.processed.has(feedbackId)) return;
  const mine = c.changes.filter((ch) => ch.from.feedbackEvent === feedbackId);
  if (mine.some((ch) => ch.state === 'requested' || ch.state === 'working')) return;
  const failed = mine.filter((ch) => ch.state === 'failed');
  const waiting = mine.filter((ch) => ch.state === 'applied' && ch.board);
  const conflicts = mine.filter((ch) => ch.state === 'conflict');
  const questions = c.translated.get(feedbackId).questions || [];
  const parts = [
    `${mine.length - failed.length} of ${mine.length} changes applied`,
    ...(waiting.length ? [`${waiting.length} waiting to be written to the board (Sync)`] : []),
    ...failed.map((ch) => `failed: ${ch.summary} (${(ch.result || {}).note || 'no reason given'})`),
    ...conflicts.map((ch) => `conflict on the board: ${ch.summary}`),
    ...questions.map((q) => `question: ${typeof q === 'string' ? q : q.question}`),
  ];
  markProcessed(cwd, feedbackId, failed.length || conflicts.length || questions.length ? 'needs-you' : 'applied', parts.join(' · '));
}
