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

// What an AGENTS.md says as learnings. A `##` (or deeper) heading sets the topic; a top-level `#` is the file's
// title and no topic. Bullets are learnings, and so are plain lines added after the list has begun (a hand-appended
// line) — but not the paragraph a file opens with: whatever comes before the first bullet or sub-heading is an
// introduction. A file with no bullets and no sub-heading at all is a hand-written list and is read line by line.
// The generated comment and fenced code are never learnings.
export function parseAgentsFile(text) {
  const items = [];
  let topic;
  let fenced = false;
  let started = false;
  let structured = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced || !line || line.startsWith('<!--')) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (heading[1].length > 1) { topic = heading[2].trim() || undefined; started = true; structured = true; }
      continue;
    }
    const bullet = /^[-*]\s+/.test(line);
    if (bullet) { started = true; structured = true; }
    const learning = line.replace(/^[-*]\s+/, '').trim();
    if (learning) items.push({ topic, text: learning, introduction: !started });
  }
  return items.filter((i) => structured ? !i.introduction : true).map(({ topic: t, text: x }) => ({ topic: t, text: x }));
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
  const id = appendEvent(kitDir, { type: 'learning-recorded', text: clean, ...(topic?.trim() ? { topic: topic.trim() } : {}), scope, ...(slice ? { slice } : {}), tags }, meta);
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id, duplicate: false };
}

// A learning by its id or by a unique prefix of it (`learnings --ids` shows the first eight characters).
function resolveLearning(learnings, id) {
  const wanted = String(id ?? '').trim();
  if (!wanted) throw new Error('name the learning by its id (see `learnings --ids`)');
  const matches = learnings.filter((l) => l.id === wanted || l.id.startsWith(wanted));
  if (!matches.length) throw new Error(`no learning with id "${wanted}"`);
  if (matches.length > 1 && !matches.some((l) => l.id === wanted)) throw new Error(`"${wanted}" matches ${matches.length} learnings — use more of the id`);
  return matches.find((l) => l.id === wanted) ?? matches[0];
}

// Withdraws a learning by id or by a unique prefix of it; `reason` says why (the curator gives one).
export function retractLearning({ kitDir, id, reason, meta }) {
  const { state } = syncLearnings({ kitDir, meta });
  const target = resolveLearning(state.learnings, id);
  appendEvent(kitDir, { type: 'learning-retracted', learning: target.id, ...(reason?.trim() ? { reason: reason.trim() } : {}) }, meta);
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id: target.id, text: target.text };
}

export function listLearnings(kitDir) {
  return fold(readEvents(kitDir)).learnings.map(({ id, text, topic, scope, tags }) => ({ id, text, topic, scope, tags }));
}

// The curator's merge: two or more learnings that say the same thing become one. The event keeps what
// the sources said, so a bad merge can be repaired. Sources of different scopes need the scope named.
export function mergeLearnings({ kitDir, ids, text, topic, scope, tags, reason, meta }) {
  const { state } = syncLearnings({ kitDir, meta });
  const sources = [...new Set((ids ?? []).map((id) => resolveLearning(state.learnings, id)))];
  if (sources.length < 2) throw new Error('a merge needs at least two learnings');
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('the merged learning is empty');
  if (scope !== undefined && !SCOPES.includes(scope)) throw new Error(`scope must be ${SCOPES.join(' or ')}, not "${scope}"`);
  if (scope === undefined && new Set(sources.map((l) => l.scope)).size > 1) throw new Error('the learnings have different scopes — name the scope of the merged one');
  const id = appendEvent(kitDir, {
    type: 'learning-merged',
    learnings: sources.map((l) => l.id),
    text: clean,
    ...(topic?.trim() ? { topic: topic.trim() } : {}),
    ...(scope ? { scope } : {}),
    tags,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
    sources: sources.map(({ id, text: was }) => ({ id, text: was })),
  }, meta);
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id };
}

// What the curator (an LLM turn) is told: the learnings with their ids, and the two things it may do.
// It changes the list only through those commands — AGENTS.md is regenerated from the events.
export function curationRequest(learnings) {
  if (!learnings.length) return '';
  const list = learnings.map((l) => `  ${l.id.slice(0, 8)}  [${l.topic ?? 'General'}]  (${l.scope})  ${l.text}${l.tags?.length ? `  ${l.tags.map((t) => `#${t}`).join(' ')}` : ''}`).join('\n');
  return `You are the curator of this project's learnings. Below is everything recorded so far: id, [topic], (scope), the learning, #tags. \`.build-kit/AGENTS.md\` is generated from this list — never edit that file. You change the list only with these two commands:

- Merge learnings that say the same thing into one terse line:
  npx @eventmodelers/cli learn --merge <id,id,…> "<combined text>" --reason "<why they are the same>"
  (add --topic to set the heading, and --scope when the sources have different scopes)
- Retract a learning that is wrong or obsolete:
  npx @eventmodelers/cli learn --retract <id> --reason "<what you found>"

Rules:
- No new learnings — recording one is refused while you curate. Merge or retract only.
- Retract only with evidence you have checked: the code, the git log, the slice definitions. Put it in --reason. If you cannot judge a learning, keep it.
- A merge must not lose information: the combined text says everything its sources said, in one line, and adds nothing.
- Learnings with scope "system" are about the modeled domain; merge or retract them only when the evidence is in the slices or the code.
- Leave learnings that are fine alone. Finish with one line saying what you merged and retracted.

Learnings:
${list}
`;
}

// ── learnings a turn states in its reply ────────────────────────────────────────
// The locked-down modeling agent cannot run `learn` (its Bash is an allowlist, and it takes chat from any
// collaborator on the board), so it ends a reply with `Learning [<topic>]: <one terse line>` lines and the
// CLI — trusted code — records them. A reply yields at most five learnings of at most 300 characters:
// what a board collaborator can talk the agent into saying stays small.
const MAX_TURN_LEARNINGS = 5;
const MAX_LEARNING_LENGTH = 300;
const TURN_LEARNING = /^\s*(?:[-*]\s+)?learning(?:\s*\[([^\]]{1,60})\])?:\s*(.*?)\s*$/i;

export function parseTurnLearnings(reply) {
  const found = [];
  let fenced = false;
  for (const line of String(reply ?? '').split('\n')) {
    if (line.trim().startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = TURN_LEARNING.exec(line);
    if (!m) continue;
    const text = m[2];
    if (!text || /^none\.?$/i.test(text) || text.length > MAX_LEARNING_LENGTH) continue;
    found.push({ topic: m[1]?.trim() || undefined, text });
    if (found.length === MAX_TURN_LEARNINGS) break;
  }
  return found;
}

// Records what a turn's reply states as modeling learnings (scope system: they are about the model).
// Returns how many were new.
export function recordTurnLearnings({ kitDir, reply, meta }) {
  let recorded = 0;
  for (const { topic, text } of parseTurnLearnings(reply)) {
    if (!recordLearning({ kitDir, text, topic, scope: 'system', tags: ['modeling'], meta }).duplicate) recorded++;
  }
  return recorded;
}
