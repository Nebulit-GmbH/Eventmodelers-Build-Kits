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

// What `learn` accepts from an agent: the problem (the situation or symptom it applies to) and the solution (what to do
// about it), each one short sentence, plus the topic it is filed under. The size limits are what keeps AGENTS.md short —
// a learning that needs more room is two learnings. Enforced here, in the CLI's own code, not left to the prompt.
// The whole learning — problem, arrow and solution — in characters. One limit, not one per part: a long problem is
// fine next to a short solution, and the other way round.
export const MAX_LEARNING_LENGTH_TOTAL = 500;
const LEARN_FORM = 'learn --problem "<the situation or symptom, one short sentence>" --solution "<what to do about it, one short sentence>" --topic "<topic>"';

export function composeLearning({ problem, solution, topic }) {
  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const [p, s, t] = [clean(problem), clean(solution), clean(topic)];
  const missing = [!p && '--problem', !s && '--solution', !t && '--topic'].filter(Boolean);
  if (missing.length) throw new Error(`a learning needs ${missing.join(', ')} — the form is: ${LEARN_FORM}`);
  const text = `${p.replace(/[.:;]+$/, '')} → ${s}`;
  if (text.length > MAX_LEARNING_LENGTH_TOTAL) throw new Error(`the learning is ${text.length} characters, at most ${MAX_LEARNING_LENGTH_TOTAL}: state the rule, not the story (no slice names, commit ids or how you found out). If it needs more room, it is two learnings.`);
  return { text, topic: t };
}

// The curator's split, for the one case a summary cannot cover: a learning that holds two or more independent rules. It is
// retracted and each part recorded as a learning of its own (same scope and tags, tagged `split`); every part passes the
// checks `learn` applies, and nothing is written unless all of them do. What it said stays in the log.
export function splitLearning({ kitDir, id, parts, reason, meta, dryRun = false }) {
  const { state } = dryRun ? { state: fold(readEvents(kitDir)) } : syncLearnings({ kitDir, meta });
  const target = resolveLearning(state.learnings, id);
  if ((parts ?? []).length < 2) throw new Error('a split needs at least two parts — a single rule is a rewrite');
  const composed = parts.map((p) => composeLearning(p));
  if (dryRun) return { id: target.id, was: target.text, parts: composed };
  appendEvent(kitDir, { type: 'learning-retracted', learning: target.id, reason: reason?.trim() || `split into ${composed.length} learnings` }, meta);
  for (const { text, topic } of composed) {
    appendEvent(kitDir, { type: 'learning-recorded', text, topic, scope: target.scope, tags: [...new Set([...(target.tags ?? []), 'split'])], ...(target.slice ? { slice: target.slice } : {}) }, meta);
  }
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id: target.id, was: target.text, parts: composed };
}

// Whether a learning is already in the form `learn` enforces: problem → solution, within the limit. The curator is told which
// ones are done, so it does not guess from the text.
export function isNormalized(text) {
  const t = String(text ?? '');
  return t.includes(' → ') && t.length <= MAX_LEARNING_LENGTH_TOTAL;
}

// The hint a person gets once the learnings pile up. There is no automatic curation: nothing tidies the list unless a
// person runs the command, so this is what reminds them. Shown only in a terminal (see cli.js) — an agent that read it
// might run the curation itself, which is the automatic path again.
export const LEARNINGS_NUDGE_AFTER = 20;
export function learningsNudge(count) {
  if (count < LEARNINGS_NUDGE_AFTER) return '';
  return `💡 You have ${count} learnings. Summarize them with: npx @eventmodelers/cli learnings --curate --dry-run (look at what it proposes, then run it again without --dry-run)`;
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
export function retractLearning({ kitDir, id, reason, meta, dryRun = false }) {
  const { state } = dryRun ? { state: fold(readEvents(kitDir)) } : syncLearnings({ kitDir, meta });
  const target = resolveLearning(state.learnings, id);
  if (dryRun) return { id: target.id, text: target.text };
  appendEvent(kitDir, { type: 'learning-retracted', learning: target.id, ...(reason?.trim() ? { reason: reason.trim() } : {}) }, meta);
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id: target.id, text: target.text };
}

export function listLearnings(kitDir) {
  return fold(readEvents(kitDir)).learnings.map(({ id, text, topic, scope, tags }) => ({ id, text, topic, scope, tags }));
}

// The curator's merge: two or more learnings that say the same thing become one. The event keeps what
// the sources said, so a bad merge can be repaired. Sources of different scopes need the scope named.
export function mergeLearnings({ kitDir, ids, text, topic, scope, tags, reason, meta, dryRun = false }) {
  const { state } = dryRun ? { state: fold(readEvents(kitDir)) } : syncLearnings({ kitDir, meta });
  const sources = [...new Set((ids ?? []).map((id) => resolveLearning(state.learnings, id)))];
  if (sources.length < 2) throw new Error('a merge needs at least two learnings');
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('the merged learning is empty');
  if (scope !== undefined && !SCOPES.includes(scope)) throw new Error(`scope must be ${SCOPES.join(' or ')}, not "${scope}"`);
  if (scope === undefined && new Set(sources.map((l) => l.scope)).size > 1) throw new Error('the learnings have different scopes — name the scope of the merged one');
  if (dryRun) return { id: null, sources: sources.map((l) => l.text) };
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
  return { id, sources: sources.map((l) => l.text) };
}

// The curator's rewrite: the same learning (same id), in the problem → solution form and under a topic — the checks are
// the ones `learn` applies to a new one, so a rewrite is never looser than a recording. The event keeps what it said before.
export function rewriteLearning({ kitDir, id, problem, solution, topic, reason, meta, dryRun = false }) {
  const { state } = dryRun ? { state: fold(readEvents(kitDir)) } : syncLearnings({ kitDir, meta });
  const target = resolveLearning(state.learnings, id);
  const composed = composeLearning({ problem, solution, topic });
  if (learningKey(composed.text) === learningKey(target.text) && composed.topic === target.topic) throw new Error('nothing changes');
  if (dryRun) return { id: target.id, was: target.text, text: composed.text, topic: composed.topic };
  appendEvent(kitDir, { type: 'learning-rewritten', learning: target.id, text: composed.text, topic: composed.topic, ...(reason?.trim() ? { reason: reason.trim() } : {}), was: target.text, wasTopic: target.topic }, meta);
  projectLearnings(kitDir, fold(readEvents(kitDir)));
  return { id: target.id, was: target.text, text: composed.text, topic: composed.topic };
}

// The same curation, for an agent that only answers (`learnings --curate` with any harness, whose Bash may be locked
// down or absent): it replies with MERGE / RETRACT / REWRITE lines and the CLI — trusted code — applies them through the
// same mergeLearnings / retractLearning / rewriteLearning the commands use. A line it gets wrong is skipped, never half-applied.
export function curationReplyRequest(learnings) {
  if (!learnings.length) return '';
  const list = learnings.map((l) => `  ${l.id.slice(0, 8)}  [${l.topic ?? 'General'}]  (${l.scope})  ${isNormalized(l.text) ? '✓ ' : ''}${l.text}${l.tags?.length ? `  ${l.tags.map((t) => `#${t}`).join(' ')}` : ''}`).join('\n');
  return `You are the curator of this project's learnings. Below is everything recorded so far: id, [topic], (scope), the learning, #tags; a ✓ marks a learning that is already in the required form. Do not edit any file and do not run any command that changes anything. Answer with these lines, one per change; nothing else is applied:

MERGE <id,id,…> | <combined text> | <why they are the same>
RETRACT <id> | <what you found>
REWRITE <id> | <problem> | <solution> | <topic>
SPLIT <id> | <problem> | <solution> | <topic>      (one line per part, at least two, all with the same id)

Rules:
- Merge learnings that say the same thing into one terse line, written as "<problem> → <solution>". A merge must not lose information a reader needs to act. Sources of different scopes cannot be merged.
- Retract only a learning that is wrong or obsolete, and only with evidence you checked in the code, the git log or the slice definitions — put it after the second "|". If you cannot judge a learning, keep it.
- Rewrite every learning without a ✓ into "<problem> → <solution>". The problem is the situation or symptom it applies to, the solution is what to do about it, each one short sentence; together with the arrow at most ${MAX_LEARNING_LENGTH_TOTAL} characters. State the rule, not the story: drop slice names, commit ids, "confirmed by running …" and how it was found out, but keep every path, command, flag and name an agent needs to act. If it is too long, summarize it to fit — keep the rule and the identifiers, cut the rest. The topic is a short reusable heading (reuse one already in the list; a few topics for the whole list, not one each).
- Split only when one learning really holds two or more independent rules — rules an agent would apply in different situations. Then give one SPLIT line per rule, each in the same form and within the same limit. Do not split to avoid summarizing: one rule, however long, is a rewrite.
- Learnings with scope "system" are about the modeled domain; change them only when the evidence is in the slices or the code.
- Leave learnings that are fine alone. Add no new learnings. If nothing needs changing, answer: NONE

Learnings:
${list}
`;
}

const CURATION_MERGE = /^\s*(?:[-*]\s+)?MERGE\s+([0-9a-f]{4,}(?:\s*,\s*[0-9a-f]{4,})+)\s*\|\s*(.+)\|\s*(\S.*?)\s*$/i;
const CURATION_RETRACT = /^\s*(?:[-*]\s+)?RETRACT\s+([0-9a-f]{4,})\s*\|\s*(\S.*?)\s*$/i;
const CURATION_SPLIT = /^\s*(?:[-*]\s+)?SPLIT\s+([0-9a-f]{4,})\s*\|([^|]+)\|([^|]+)\|([^|]+)$/i;
const CURATION_REWRITE = /^\s*(?:[-*]\s+)?REWRITE\s+([0-9a-f]{4,})\s*\|([^|]+)\|([^|]+)\|([^|]+)$/i;

// Applies the MERGE / RETRACT / REWRITE lines of a curator's reply — or, with dryRun, only checks them and writes nothing.
// Returns { merged, retracted, rewritten, split, changes: [{ kind, before: [text], after? }], skipped: [message] }.
export function applyCurationReply({ kitDir, reply, meta, dryRun = false }) {
  const out = { merged: 0, retracted: 0, rewritten: 0, split: 0, changes: [], skipped: [] };
  const splits = new Map(); // id → its parts, in the order given; applied once the whole reply is read
  let fenced = false;
  for (const line of String(reply ?? '').split('\n')) {
    if (line.trim().startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    try {
      let m = CURATION_MERGE.exec(line);
      if (m) {
        const { sources } = mergeLearnings({ kitDir, ids: m[1].split(',').map((id) => id.trim()), text: m[2].trim(), reason: m[3], meta, dryRun });
        out.merged++;
        out.changes.push({ kind: 'merge', before: sources, after: m[2].trim() });
        continue;
      }
      m = CURATION_RETRACT.exec(line);
      if (m) {
        const { text } = retractLearning({ kitDir, id: m[1], reason: m[2], meta, dryRun });
        out.retracted++;
        out.changes.push({ kind: 'retract', before: [text], reason: m[2] });
        continue;
      }
      m = CURATION_SPLIT.exec(line);
      if (m) {
        const parts = splits.get(m[1].toLowerCase()) ?? [];
        parts.push({ problem: m[2], solution: m[3], topic: m[4] });
        splits.set(m[1].toLowerCase(), parts);
        continue;
      }
      m = CURATION_REWRITE.exec(line);
      if (m) {
        const { was, text, topic } = rewriteLearning({ kitDir, id: m[1], problem: m[2], solution: m[3], topic: m[4], reason: 'normalized to problem → solution', meta, dryRun });
        out.rewritten++;
        out.changes.push({ kind: 'rewrite', before: [was], after: `[${topic}] ${text}` });
      }
    } catch (err) {
      out.skipped.push(`${line.trim().slice(0, 80)} — ${err.message}`);
    }
  }
  for (const [id, parts] of splits) {
    try {
      const { was, parts: made } = splitLearning({ kitDir, id, parts, meta, dryRun });
      out.split++;
      out.changes.push({ kind: 'split', before: [was], after: made.map((p) => `[${p.topic}] ${p.text}`) });
    } catch (err) {
      out.skipped.push(`SPLIT ${id} — ${err.message}`);
    }
  }
  return out;
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
