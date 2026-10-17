// Learnings as events, and AGENTS.md as their projection (`renderLearnings`). The build agent records a
// learning with `eventmodelers learn` and withdraws a wrong one with `learn --retract`; nobody edits the
// file by hand — but when someone does (an older prompt, a pull that merged teammates' lines), the lines
// are adopted as learnings first, so a regeneration never loses them.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendEvent, readEvents } from './slice-events.js';
import { fold, learningKey, renderLearnings } from './slice-state.js';

export const AGENTS_FILE = 'AGENTS.md';
const SCOPES = ['system', 'repo'];

// What an AGENTS.md says as learnings: a heading sets the topic, every other line is one learning
// (a leading bullet is dropped). The generated comment and fenced code are not learnings.
export function parseAgentsFile(text) {
  const items = [];
  let topic;
  let fenced = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced || !line || line.startsWith('<!--')) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { topic = heading[1].trim() || undefined; continue; }
    const learning = line.replace(/^[-*]\s+/, '').trim();
    if (learning) items.push({ topic, text: learning });
  }
  return items;
}

function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf-8') === content) return false;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
  return true;
}

// Writes AGENTS.md from the log, without reading it first. Used right after this module's own events —
// adopting then would take the line a retraction just removed for a hand edit and bring it back.
// Nothing is written while there is nothing learned (a project without learnings gets no file).
function projectLearnings(kitDir, state) {
  const content = renderLearnings(state);
  return content ? writeIfChanged(join(kitDir, AGENTS_FILE), content) : false;
}

// The entry point before anything reads learnings: adopts what AGENTS.md says that the log does not know
// yet, then writes the file from the log. Returns { state, written }.
export function syncLearnings({ kitDir, meta }) {
  const path = join(kitDir, AGENTS_FILE);
  let state = fold(readEvents(kitDir));
  if (existsSync(path)) {
    const known = new Set(state.learnings.map((l) => learningKey(l.text)));
    let adopted = false;
    for (const { topic, text } of parseAgentsFile(readFileSync(path, 'utf-8'))) {
      const key = learningKey(text);
      if (known.has(key)) continue;
      known.add(key);
      appendEvent(kitDir, { type: 'learning-recorded', text, ...(topic ? { topic } : {}), scope: 'repo', tags: ['adopted'] }, meta);
      adopted = true;
    }
    if (adopted) state = fold(readEvents(kitDir));
  }
  return { state, written: projectLearnings(kitDir, state) };
}

// Records one learning. A learning the file already has is not recorded again (returned with
// duplicate: true), so an agent does not have to diff before it calls.
export function recordLearning({ kitDir, text, topic, tags, scope = 'repo', slice, meta }) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('the learning is empty');
  if (!SCOPES.includes(scope)) throw new Error(`scope must be ${SCOPES.join(' or ')}, not "${scope}"`);
  const { state } = syncLearnings({ kitDir, meta });
  const existing = state.learnings.find((l) => learningKey(l.text) === learningKey(clean));
  if (existing) return { id: existing.id, duplicate: true };
  appendEvent(kitDir, { type: 'learning-recorded', text: clean, ...(topic?.trim() ? { topic: topic.trim() } : {}), scope, ...(slice ? { slice } : {}), tags }, meta);
  const events = readEvents(kitDir);
  projectLearnings(kitDir, fold(events));
  return { id: events[events.length - 1].id, duplicate: false };
}

// Withdraws a learning by id or by a unique prefix of it.
export function retractLearning({ kitDir, id, meta }) {
  const wanted = String(id ?? '').trim();
  if (!wanted) throw new Error('name the learning to retract by its id (see `learnings --ids`)');
  const { state } = syncLearnings({ kitDir, meta });
  const matches = state.learnings.filter((l) => l.id === wanted || l.id.startsWith(wanted));
  if (!matches.length) throw new Error(`no learning with id "${wanted}"`);
  if (matches.length > 1 && !matches.some((l) => l.id === wanted)) throw new Error(`"${wanted}" matches ${matches.length} learnings — use more of the id`);
  const target = matches.find((l) => l.id === wanted) ?? matches[0];
  appendEvent(kitDir, { type: 'learning-retracted', learning: target.id }, meta);
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id: target.id, text: target.text };
}

export function listLearnings(kitDir) {
  return fold(readEvents(kitDir)).learnings.map(({ id, text, topic, scope, tags }) => ({ id, text, topic, scope, tags }));
}
