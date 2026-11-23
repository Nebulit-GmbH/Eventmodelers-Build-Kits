// Learnings as events, and AGENTS.md as the file they are applied to. The build agent records a learning with
// `eventmodelers learn` and withdraws a wrong one with `learn --retract`. Each kit applies its own events to the
// file once (a cursor); the file itself is shared through git and is never read back into the log.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
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

// AGENTS.md is patched, not regenerated: this kit remembers the last learning event it applied
// (`<kitDir>/.eventmodelers/learnings-cursor.json`, local and gitignored) and applies only the events after it —
// a learning adds its line, a retraction removes it, a merge swaps the sources for one. Lines the file already
// holds (a teammate's, from a pull) are left as they are. A cursor the log does not know any more (the log was
// pruned or deleted) means every event in the log counts as new; applying one the file already reflects changes
// nothing, so the file is never wiped. `rebuild` regenerates the whole file from the log instead.
// Nothing is written while there is nothing learned (a project without learnings gets no file).
const CURSOR_FILE = join('.eventmodelers', 'learnings-cursor.json');
const LEARNING_EVENTS = new Set(['learning-recorded', 'learning-retracted', 'learning-merged']);

// The cursor is the time (`at`, with `seq` to order events of the same instant) of the last learning event applied.
// Time is what a deleted log cannot reset: pruned events stay behind the cursor, so if someone summarizes
// AGENTS.md and it is pulled, learnings that were already applied are not put back — and events recorded after the
// log was deleted are newer than the cursor however low their `seq` starts again.
function readCursor(kitDir) {
  try {
    const { at, seq } = JSON.parse(readFileSync(join(kitDir, CURSOR_FILE), 'utf-8'));
    return typeof at === 'string' ? { at, seq: Number.isInteger(seq) ? seq : 0 } : null;
  } catch { return null; }
}

function writeCursor(kitDir, event) {
  if (!event) return;
  mkdirSync(join(kitDir, '.eventmodelers'), { recursive: true });
  writeIfChanged(join(kitDir, CURSOR_FILE), `${JSON.stringify({ at: event.at, seq: event.seq }, null, 2)}\n`);
}

// The file as topic → lines, in file order.
function readModel(kitDir) {
  const model = new Map();
  const path = join(kitDir, AGENTS_FILE);
  if (!existsSync(path)) return model;
  for (const { topic, text } of parseAgentsFile(readFileSync(path, 'utf-8'))) {
    const name = topic?.trim() || 'General';
    if (!model.has(name)) model.set(name, []);
    model.get(name).push(text);
  }
  return model;
}

function hasLine(model, key) {
  return [...model.values()].some((lines) => lines.some((l) => learningKey(l) === key));
}

function removeLine(model, key) {
  for (const [name, lines] of model) {
    const kept = lines.filter((l) => learningKey(l) !== key);
    if (kept.length) model.set(name, kept); else model.delete(name);
  }
}

function addLine(model, topic, text) {
  if (!learningKey(text) || hasLine(model, learningKey(text))) return;
  const name = topic?.trim() || 'General';
  if (!model.has(name)) model.set(name, []);
  model.get(name).push(String(text).trim());
}

function applyLearningEvents(kitDir, { rebuild = false } = {}) {
  const events = readEvents(kitDir);
  const learningEvents = events.filter((e) => LEARNING_EVENTS.has(e.type));
  const last = learningEvents.at(-1) ?? null;
  const path = join(kitDir, AGENTS_FILE);
  if (rebuild) {
    const content = renderLearnings(fold(events));
    writeCursor(kitDir, last);
    return content ? writeIfChanged(path, content) : false;
  }
  const cursor = readCursor(kitDir);
  // An installation from before the cursor: its AGENTS.md was written from the log by the older version, and may
  // have been summarized or edited since. Everything in the log up to now counts as applied — the file stays as it is.
  if (cursor === null && existsSync(path)) { writeCursor(kitDir, last); return false; }
  const fresh = cursor === null ? learningEvents : learningEvents.filter((e) => e.at > cursor.at || (e.at === cursor.at && e.seq > cursor.seq));
  const texts = new Map(learningEvents.filter((e) => e.type === 'learning-recorded').map((e) => [e.id, e.text]));
  const model = readModel(kitDir);
  for (const e of fresh) {
    if (e.type === 'learning-recorded') addLine(model, e.topic, e.text);
    else if (e.type === 'learning-retracted') { const was = e.text ?? texts.get(e.learning); if (was) removeLine(model, learningKey(was)); }
    else {
      // The merged line takes the slot of its first source, and that source's topic unless one is named.
      const topic = e.topic ?? [...model].find(([, lines]) => lines.some((l) => learningKey(l) === learningKey(e.sources?.[0]?.text ?? '')))?.[0];
      for (const src of e.sources ?? []) removeLine(model, learningKey(src.text));
      addLine(model, topic, e.text);
    }
  }
  if (fresh.length) writeCursor(kitDir, last);
  if (!model.size) return false;
  const body = [...model].map(([name, lines]) => `## ${name}\n${lines.map((l) => `- ${l}`).join('\n')}\n`).join('\n');
  return writeIfChanged(path, `<!-- Generated from the slice-state event log. Record learnings with the learn command; do not edit. -->\n\n${body}`);
}

// The entry point before anything reads learnings: applies the learning events this kit has not applied yet to
// AGENTS.md (see above). What the file holds besides — a teammate's lines from a pull, a summary, a hand edit — is
// left as it is and is not turned into events. `rebuild` regenerates the whole file from the log. Returns { state, written }.
export function syncLearnings({ kitDir, rebuild = false }) {
  const written = applyLearningEvents(kitDir, { rebuild });
  return { state: fold(readEvents(kitDir)), written };
}

// Records one learning. A learning the file already has is not recorded again (returned with
// duplicate: true), so an agent does not have to diff before it calls.
export function recordLearning({ kitDir, text, topic, tags, scope = 'repo', slice, meta }) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('the learning is empty');
  if (!SCOPES.includes(scope)) throw new Error(`scope must be ${SCOPES.join(' or ')}, not "${scope}"`);
  const { state } = syncLearnings({ kitDir });
  const existing = state.learnings.find((l) => learningKey(l.text) === learningKey(clean));
  if (existing) return { id: existing.id, duplicate: true };
  const id = appendEvent(kitDir, { type: 'learning-recorded', text: clean, ...(topic?.trim() ? { topic: topic.trim() } : {}), scope, ...(slice ? { slice } : {}), tags }, meta);
  applyLearningEvents(kitDir);
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
  const { state } = syncLearnings({ kitDir });
  const target = resolveLearning(state.learnings, id);
  appendEvent(kitDir, { type: 'learning-retracted', learning: target.id, text: target.text, ...(reason?.trim() ? { reason: reason.trim() } : {}) }, meta);
  applyLearningEvents(kitDir);
  return { id: target.id, text: target.text };
}

export function listLearnings(kitDir) {
  return fold(readEvents(kitDir)).learnings.map(({ id, text, topic, scope, tags }) => ({ id, text, topic, scope, tags }));
}

// The curator's merge: two or more learnings that say the same thing become one. The event keeps what
// the sources said, so a bad merge can be repaired. Sources of different scopes need the scope named.
export function mergeLearnings({ kitDir, ids, text, topic, scope, tags, reason, meta }) {
  const { state } = syncLearnings({ kitDir });
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
  applyLearningEvents(kitDir);
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
