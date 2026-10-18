import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';
import { curationRequest, mergeLearnings, parseAgentsFile, recordLearning, retractLearning, listLearnings, syncLearnings } from '../shared/build-kit/lib/slice-learnings.js';
import { tempKit } from './helpers.js';

// AGENTS.md is a projection of the learning events — and hand edits to it (old prompts, a pull that merged
// teammates' lines) are adopted as events, never overwritten. Design: slice-state-test-design.md.

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };
const kitDir = (t) => { const kit = join(tempKit(t), '.build-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const agents = (kit) => readFileSync(join(kit, 'AGENTS.md'), 'utf-8');
const learnings = (kit) => fold(readEvents(kit)).learnings;

// ── parseAgentsFile ─────────────────────────────────────────────────────────────

test('parseAgentsFile reads topics from headings and one learning per bullet or line', () => {
  const text = '<!-- Generated -->\n\n## Testing\n- Run npm test\n* Mock fetch\n\n## Git\nNever amend merged commits\n';
  assert.deepEqual(parseAgentsFile(text), [
    { topic: 'Testing', text: 'Run npm test' },
    { topic: 'Testing', text: 'Mock fetch' },
    { topic: 'Git', text: 'Never amend merged commits' },
  ]);
});

test('parseAgentsFile skips the generated comment, blank lines and fenced code', () => {
  const text = '<!-- Generated from the slice-state event log. -->\n# Learnings\n\n```sh\nnpm test\n```\n- kept\n';
  assert.deepEqual(parseAgentsFile(text), [{ topic: 'Learnings', text: 'kept' }]);
});

test('parseAgentsFile of nothing is nothing', () => {
  assert.deepEqual(parseAgentsFile(''), []);
});

// ── recording ───────────────────────────────────────────────────────────────────

test('a recorded learning is an event with its topic, tags, scope and metadata, and shows in AGENTS.md', (t) => {
  const kit = kitDir(t);
  const { id } = recordLearning({ kitDir: kit, text: 'Run the suite with npm test', topic: 'Testing', tags: ['ci'], scope: 'repo', meta: META });
  const [event] = readEvents(kit);
  assert.deepEqual({ type: event.type, text: event.text, topic: event.topic, tags: event.tags, scope: event.scope, meta: event.meta, id: event.id },
    { type: 'learning-recorded', text: 'Run the suite with npm test', topic: 'Testing', tags: ['ci'], scope: 'repo', meta: META, id });
  assert.match(agents(kit), /^<!-- Generated/);
  assert.match(agents(kit), /## Testing\n- Run the suite with npm test\n/);
});

test('the scope defaults to repo and must be system or repo; empty text is refused', (t) => {
  const kit = kitDir(t);
  recordLearning({ kitDir: kit, text: 'x' });
  assert.equal(learnings(kit)[0].scope, 'repo');
  assert.throws(() => recordLearning({ kitDir: kit, text: 'y', scope: 'galaxy' }), /scope/);
  assert.throws(() => recordLearning({ kitDir: kit, text: '   ' }), /empty/);
  assert.equal(readEvents(kit).length, 1);
});

test('a learning that is already there is not recorded again', (t) => {
  const kit = kitDir(t);
  const first = recordLearning({ kitDir: kit, text: 'Use npm test' });
  const again = recordLearning({ kitDir: kit, text: '  use  NPM test ' });
  assert.deepEqual({ duplicate: again.duplicate, id: again.id }, { duplicate: true, id: first.id });
  assert.equal(readEvents(kit).length, 1);
});

// ── retracting and listing ──────────────────────────────────────────────────────

test('a learning is retracted by id or by a unique prefix, and leaves AGENTS.md', (t) => {
  const kit = kitDir(t);
  const a = recordLearning({ kitDir: kit, text: 'wrong claim' });
  const b = recordLearning({ kitDir: kit, text: 'right claim' });
  retractLearning({ kitDir: kit, id: a.id, meta: META });
  assert.doesNotMatch(agents(kit), /wrong claim/);
  retractLearning({ kitDir: kit, id: b.id.slice(0, 8) });
  assert.equal(learnings(kit).length, 0);
  assert.equal(readEvents(kit).filter((e) => e.type === 'learning-retracted').length, 2);
  assert.deepEqual(readEvents(kit).find((e) => e.type === 'learning-retracted').meta, META);
});

test('retracting an unknown or ambiguous id changes nothing', (t) => {
  const kit = kitDir(t);
  recordLearning({ kitDir: kit, text: 'one' });
  assert.throws(() => retractLearning({ kitDir: kit, id: 'nope' }), /no learning/i);
  assert.throws(() => retractLearning({ kitDir: kit, id: '' }), /id/);
  assert.equal(learnings(kit).length, 1);
});

test('listLearnings gives each learning with its id, topic, scope and tags', (t) => {
  const kit = kitDir(t);
  const { id } = recordLearning({ kitDir: kit, text: 'a', topic: 'T', scope: 'system', tags: ['x'] });
  assert.deepEqual(listLearnings(kit), [{ id, text: 'a', topic: 'T', scope: 'system', tags: ['x'] }]);
});

// ── AGENTS.md is a projection that adopts edits ─────────────────────────────────

test('an AGENTS.md written by hand (or by an older agent) is adopted once, not overwritten', (t) => {
  const kit = kitDir(t);
  writeFileSync(join(kit, 'AGENTS.md'), '## Testing\n- Run npm test\n\nAlways rebase before merging\n');
  syncLearnings({ kitDir: kit, meta: META });
  syncLearnings({ kitDir: kit, meta: META });
  assert.deepEqual(learnings(kit).map((l) => [l.topic, l.text, l.tags]), [['Testing', 'Run npm test', ['adopted']], ['Testing', 'Always rebase before merging', ['adopted']]]);
  assert.match(agents(kit), /Always rebase before merging/);
  assert.equal(readEvents(kit).length, 2);
});

test('a line added to the generated file by hand, or merged in by a pull, is adopted; duplicates are not', (t) => {
  const kit = kitDir(t);
  recordLearning({ kitDir: kit, text: 'Use npm test', topic: 'Testing' });
  writeFileSync(join(kit, 'AGENTS.md'), `${agents(kit)}- Prefer small commits\n- use npm TEST\n`);
  syncLearnings({ kitDir: kit });
  assert.deepEqual(learnings(kit).map((l) => l.text), ['Use npm test', 'Prefer small commits']);
});

test('a retracted learning stays gone from the regenerated file', (t) => {
  const kit = kitDir(t);
  const { id } = recordLearning({ kitDir: kit, text: 'obsolete' });
  recordLearning({ kitDir: kit, text: 'current' });
  retractLearning({ kitDir: kit, id });
  syncLearnings({ kitDir: kit });
  assert.doesNotMatch(agents(kit), /obsolete/);
  assert.match(agents(kit), /current/);
});

test('with nothing learned there is no AGENTS.md to write, and an existing one is only rewritten when it changed', (t) => {
  const kit = kitDir(t);
  syncLearnings({ kitDir: kit });
  assert.equal(existsSync(join(kit, 'AGENTS.md')), false);
  recordLearning({ kitDir: kit, text: 'a' });
  const before = readFileSync(join(kit, 'AGENTS.md'), 'utf-8');
  assert.equal(syncLearnings({ kitDir: kit }).written, false);
  assert.equal(readFileSync(join(kit, 'AGENTS.md'), 'utf-8'), before);
});

// ── the curator's tools: merge and retract with a reason ────────────────────────

test('a merge replaces its sources by one learning, keeps their provenance on the event, and rewrites AGENTS.md', (t) => {
  const kit = kitDir(t);
  const a = recordLearning({ kitDir: kit, text: 'run npm test', topic: 'Testing', tags: ['ci'] });
  const b = recordLearning({ kitDir: kit, text: 'tests are run with npm test', topic: 'Testing', tags: ['node'] });
  recordLearning({ kitDir: kit, text: 'rebase before merging', topic: 'Git' });
  const merged = mergeLearnings({ kitDir: kit, ids: [a.id.slice(0, 8), b.id], text: 'Run the suite with npm test', reason: 'same fact', meta: META });
  assert.deepEqual(learnings(kit).map((l) => l.text), ['Run the suite with npm test', 'rebase before merging']);
  assert.deepEqual(learnings(kit)[0].tags, ['ci', 'node']);
  assert.equal(learnings(kit)[0].id, merged.id);
  assert.match(agents(kit), /## Testing\n- Run the suite with npm test\n/);
  assert.doesNotMatch(agents(kit), /tests are run with/);
  const event = readEvents(kit).find((e) => e.type === 'learning-merged');
  assert.deepEqual(event.sources, [{ id: a.id, text: 'run npm test' }, { id: b.id, text: 'tests are run with npm test' }]);
  assert.deepEqual({ reason: event.reason, meta: event.meta }, { reason: 'same fact', meta: META });
});

test('a merge needs at least two known learnings and one text', (t) => {
  const kit = kitDir(t);
  const a = recordLearning({ kitDir: kit, text: 'one' });
  const b = recordLearning({ kitDir: kit, text: 'two' });
  assert.throws(() => mergeLearnings({ kitDir: kit, ids: [a.id], text: 'x' }), /at least two/);
  assert.throws(() => mergeLearnings({ kitDir: kit, ids: [a.id, 'nope'], text: 'x' }), /no learning/i);
  assert.throws(() => mergeLearnings({ kitDir: kit, ids: [a.id, a.id], text: 'x' }), /at least two/);
  assert.throws(() => mergeLearnings({ kitDir: kit, ids: [a.id, b.id], text: '  ' }), /empty/);
  assert.equal(readEvents(kit).filter((e) => e.type === 'learning-merged').length, 0);
});

test('learnings of different scopes are merged only when the scope is named', (t) => {
  const kit = kitDir(t);
  const a = recordLearning({ kitDir: kit, text: 'domain rule', scope: 'system' });
  const b = recordLearning({ kitDir: kit, text: 'domain rule, reworded', scope: 'repo' });
  assert.throws(() => mergeLearnings({ kitDir: kit, ids: [a.id, b.id], text: 'x' }), /scope/);
  mergeLearnings({ kitDir: kit, ids: [a.id, b.id], text: 'The domain rule', scope: 'system' });
  assert.equal(learnings(kit)[0].scope, 'system');
});

test('a retraction can carry the reason for it', (t) => {
  const kit = kitDir(t);
  const { id } = recordLearning({ kitDir: kit, text: 'obsolete' });
  retractLearning({ kitDir: kit, id, reason: 'the module was deleted in 4f2a' });
  assert.equal(readEvents(kit).find((e) => e.type === 'learning-retracted').reason, 'the module was deleted in 4f2a');
});

// ── the prompt the curator gets ─────────────────────────────────────────────────

test('the curation request lists every learning with its short id, topic, scope and tags, and the rules', (t) => {
  const kit = kitDir(t);
  const a = recordLearning({ kitDir: kit, text: 'Run the suite with npm test', topic: 'Testing', tags: ['ci'] });
  const b = recordLearning({ kitDir: kit, text: 'Domain rule X', scope: 'system' });
  const prompt = curationRequest(fold(readEvents(kit)).learnings);
  assert.match(prompt, new RegExp(`${a.id.slice(0, 8)}\\s+\\[Testing\\]\\s+\\(repo\\)\\s+Run the suite with npm test\\s+#ci`));
  assert.match(prompt, new RegExp(`${b.id.slice(0, 8)}\\s+\\[General\\]\\s+\\(system\\)\\s+Domain rule X`));
  assert.match(prompt, /learn --merge/);
  assert.match(prompt, /learn --retract/);
  assert.match(prompt, /--reason/);
  assert.match(prompt, /no new/i);
  assert.match(prompt, /evidence/i);
  assert.match(prompt, /keep/i);
});

test('with nothing to curate there is no request', () => {
  assert.equal(curationRequest([]), '');
});
