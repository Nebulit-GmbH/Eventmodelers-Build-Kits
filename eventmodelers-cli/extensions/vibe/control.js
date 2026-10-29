// The control log of vibe coding: an event log, the same store the build kits and the prototype use
// (shared/build-kit/lib/slice-events.js — .vibe/events/<id>.json plus the append-only index .vibe/events.log).
//
//   CoverageQuestioned { kind, folder|chapter, files[] }        the agent asked: this isn't covered by the model (uncovered) / changed since the last analysis (drifted)
//   CoverageAnswered   { ref, folder|chapter, answer }          the person's pick: analyse | continue | ignore — only `ignore` outlives the answer
//   CodeSynced         { chapter, files[], changes, note }      a change was translated and executed on the board; the chapter's baseline moved with it
//
// Nothing is deleted. A question is open until a CoverageAnswered refers to it, so the same question is never asked twice.
import { appendEvent, readEvents } from '../../shared/build-kit/lib/slice-events.js';
import { paths } from './state.js';

export const ANSWERS = ['analyse', 'continue', 'ignore'];
const log = (root) => paths(root).root;

export function record(root, type, data = {}) {
  if (!['CoverageQuestioned', 'CoverageAnswered', 'CodeSynced'].includes(type)) throw new Error(`Not an event vibe records: ${type}`);
  if (type === 'CoverageAnswered' && !ANSWERS.includes(data.answer)) throw new Error(`The answer is one of: ${ANSWERS.join(', ')}`);
  if (type === 'CoverageAnswered' && !data.folder && !data.chapter) throw new Error('An answer names the folder or the chapter it is about');
  const id = appendEvent(log(root), { type, data }, {});
  return readEvents(log(root)).find((e) => e.id === id);
}

/** What the log folds to: every event, and the questions nobody has answered yet (oldest first). */
export function control(root) {
  const events = readEvents(log(root));
  const answered = new Set(events.filter((e) => e.type === 'CoverageAnswered').map((e) => e.data.ref).filter(Boolean));
  return { events, open: events.filter((e) => e.type === 'CoverageQuestioned' && !answered.has(e.id)) };
}
