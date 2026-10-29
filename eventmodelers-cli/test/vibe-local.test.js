import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, stateOf, workingTreeFiles } from '../extensions/vibe/coverage.js';
import { control, record } from '../extensions/vibe/control.js';
import { noteTitle, renderNote } from '../extensions/vibe/render.js';
import { findVibeRoot, listBaselines, paths, readBaseline, writeBaseline } from '../extensions/vibe/state.js';
import { installSkills } from '../extensions/vibe/index.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

// A code base with two modules, committed, and a .vibe/ in it.
function project(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'vibe-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@t');
  git(cwd, 'config', 'user.name', 't');
  for (const f of ['src/visit/VisitController.java', 'src/visit/Visit.java', 'src/billing/Invoice.java', 'src/billing/Pay.java', 'src/config/Cache.java']) {
    mkdirSync(join(cwd, f, '..'), { recursive: true });
    writeFileSync(join(cwd, f), `// ${f}\n`);
  }
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'init');
  mkdirSync(paths(cwd).baseline, { recursive: true });
  return cwd;
}

const analyse = (cwd, chapter = 'Visits', fields = {}) => {
  const folders = fields.folders || { api: [{ path: 'src/visit', key: 'VisitController' }] };
  return writeBaseline(cwd, chapter, { depth: 1, folders, notModeled: [], ...fields, folders }, { pass: '1 — flow', scope: 'src/visit', result: 'ok' }, stateOf(cwd, Object.values(folders).flat().map((f) => f.path)));
};
const statusOf = (cwd, file) => check(cwd, [file]).files[0];

test('code in no analysed chapter is uncovered and asks one question per top-level folder', (t) => {
  const cwd = project(t);
  const r = check(cwd, ['src/visit/Visit.java', 'src/billing/Invoice.java', 'src/billing/Pay.java']);
  assert.ok(r.files.every((f) => f.status === 'uncovered'));
  assert.equal(r.questions.length, 1); // same top-level folder `src`
  const split = check(cwd, ['src/visit/Visit.java', 'lib/x.js']);
  assert.equal(split.questions.length, 2);
});

test('a chapter analysed at depth 1 governs only its own folders', (t) => {
  const cwd = project(t);
  analyse(cwd);
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').status, 'governed');
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').chapter, 'Visits');
  assert.equal(statusOf(cwd, 'src/billing/Invoice.java').status, 'uncovered');
  assert.deepEqual(check(cwd, ['src/visit/Visit.java']).questions, []);
});

test('a depth-0 chapter (milestones only) governs nothing', (t) => {
  const cwd = project(t);
  analyse(cwd, 'Visits', { depth: 0 });
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').status, 'uncovered');
});

test('an edit in a governed chapter is drift until the baseline advances; advancing takes the edit as known', (t) => {
  const cwd = project(t);
  analyse(cwd);
  writeFileSync(join(cwd, 'src/visit/Visit.java'), 'class Visit { String description; }\n');
  const r = check(cwd, ['src/visit/Visit.java']);
  assert.equal(r.files[0].status, 'drifted');
  assert.deepEqual(r.questions, [{ kind: 'drifted', chapter: 'Visits', files: ['src/visit/Visit.java'] }]);
  // the sync: same state, new row
  writeBaseline(cwd, 'Visits', {}, { pass: 'sync', result: 'description added' }, stateOf(cwd, ['src/visit/']));
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').status, 'governed');
  // a further edit of the same file is drift again
  writeFileSync(join(cwd, 'src/visit/Visit.java'), 'class Visit { String description; int x; }\n');
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').status, 'drifted');
});

test('a new file and a deleted file are drift; committing what the baseline already knows is not', (t) => {
  const cwd = project(t);
  analyse(cwd);
  writeFileSync(join(cwd, 'src/visit/Note.java'), 'class Note {}\n');
  rmSync(join(cwd, 'src/visit/Visit.java'));
  assert.equal(statusOf(cwd, 'src/visit/Note.java').status, 'drifted');
  writeBaseline(cwd, 'Visits', {}, { pass: 'sync' }, stateOf(cwd, ['src/visit/']));
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'visit changes');
  assert.equal(statusOf(cwd, 'src/visit/Note.java').status, 'governed'); // committed after the sync: same content
});

test('changes committed since the analysis are drift too', (t) => {
  const cwd = project(t);
  analyse(cwd);
  writeFileSync(join(cwd, 'src/visit/Visit.java'), 'changed\n');
  git(cwd, 'commit', '-qam', 'hand edit');
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').status, 'drifted');
});

test('not-modeled paths and folders answered with ignore are free; analyse and continue are recorded but ask again', (t) => {
  const cwd = project(t);
  analyse(cwd, 'Visits', { notModeled: ['src/visit/Visit.java'] });
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').status, 'free');
  assert.equal(statusOf(cwd, 'src/billing/Pay.java').status, 'uncovered');
  record(cwd, 'CoverageAnswered', { folder: 'src/billing/', answer: 'continue' });
  record(cwd, 'CoverageAnswered', { folder: 'src/billing/', answer: 'analyse' });
  assert.equal(statusOf(cwd, 'src/billing/Pay.java').status, 'uncovered');
  record(cwd, 'CoverageAnswered', { folder: 'src/billing/', answer: 'ignore' });
  assert.equal(statusOf(cwd, 'src/billing/Pay.java').status, 'free');
  assert.equal(check(cwd, ['src/billing/Pay.java']).questions.length, 0);
  assert.throws(() => record(cwd, 'CoverageAnswered', { folder: 'x/', answer: 'maybe' }), /one of/);
  assert.throws(() => record(cwd, 'CoverageAnswered', { answer: 'ignore' }), /names the folder/);
});

test('two chapters: analysing a second module governs it without touching the first', (t) => {
  const cwd = project(t);
  analyse(cwd);
  analyse(cwd, 'Billing', { folders: { api: [{ path: 'src/billing/' }] } });
  assert.equal(statusOf(cwd, 'src/billing/Pay.java').chapter, 'Billing');
  assert.equal(statusOf(cwd, 'src/visit/Visit.java').chapter, 'Visits');
  assert.equal(statusOf(cwd, 'src/config/Cache.java').status, 'uncovered');
  assert.deepEqual(listBaselines(cwd).map((b) => b.chapter), ['Billing', 'Visits']);
});

test('a chapter\'s folder can be a single file', (t) => {
  const cwd = project(t);
  analyse(cwd, 'Visits', { folders: { api: [{ path: 'src/visit/' }], persistence: [{ path: 'src/config/Cache.java' }] } });
  assert.equal(statusOf(cwd, 'src/config/Cache.java').status, 'governed');
  assert.equal(statusOf(cwd, 'src/config/Other.java').status, 'uncovered');
  writeFileSync(join(cwd, 'src/config/Cache.java'), 'changed\n');
  assert.equal(statusOf(cwd, 'src/config/Cache.java').status, 'drifted');
});

test('the working tree\'s changed files are what an unspecific check looks at', (t) => {
  const cwd = project(t);
  analyse(cwd);
  writeFileSync(join(cwd, 'src/billing/Pay.java'), 'x\n');
  writeFileSync(join(cwd, 'src/visit/Fresh.java'), 'x\n');
  assert.deepEqual(workingTreeFiles(cwd).sort(), ['src/billing/Pay.java', 'src/visit/Fresh.java']);
});

test('one .vibe/ per project: a nested module finds it by walking up', (t) => {
  const cwd = project(t);
  assert.equal(findVibeRoot(join(cwd, 'src', 'visit')), cwd);
  assert.equal(findVibeRoot(tmpdir()), null);
});

test('history is append-only, fields stay when not given, folders are normalised', (t) => {
  const cwd = project(t);
  analyse(cwd, 'Visits', { folders: { api: ['./src/visit'] }, decisions: [{ decision: 'Insert → event', why: 'only write', source: 'Visit.java:3', confirmedBy: 'code' }] });
  writeBaseline(cwd, 'Visits', { depth: 2 }, { pass: 'diff', result: 'again' }, stateOf(cwd, ['src/visit/']));
  const b = readBaseline(cwd, 'Visits');
  assert.equal(b.history.length, 2);
  assert.equal(b.depth, 2);
  assert.equal(b.folders.api[0].path, 'src/visit');
  assert.equal(b.decisions.length, 1);
});

test('the board note is rendered from the file: history, where it lives, decisions, not modeled', (t) => {
  const cwd = project(t);
  const b = analyse(cwd, 'Visits', { runningUi: 'http://localhost:8080', decisions: [{ decision: 'Insert → event', why: 'only write', source: '`Visit.java:3`', confirmedBy: 'code' }], notModeled: ['src/config/'] });
  const md = renderNote(b, { codeRoot: 'petclinic/' });
  assert.equal(noteTitle(b), 'Legacy Sources — Visits');
  assert.match(md, /^Code root `petclinic\/` · running UI: http:\/\/localhost:8080/);
  assert.match(md, /## Analysis history\n\| # \| Date \| Commit \| Pass \| Scope \| Result \|/);
  assert.match(md, /\| API \| `src\/visit` \| `VisitController` \|/);
  assert.match(md, /## Chapter decisions[\s\S]*Insert → event/);
  assert.match(md, /## Not modeled[\s\S]*`src\/config\/`/);
});

test('the control log folds to the questions nobody has answered', (t) => {
  const cwd = project(t);
  const q = record(cwd, 'CoverageQuestioned', { kind: 'uncovered', folder: 'src/billing/', files: [] });
  assert.equal(control(cwd).open.length, 1);
  record(cwd, 'CoverageAnswered', { ref: q.id, folder: 'src/billing/', answer: 'continue' });
  assert.equal(control(cwd).open.length, 0);
});

test('installing writes the skills, the modeling skills they use and a replaceable CLAUDE.md block; nothing lands in the source', (t) => {
  const cwd = project(t);
  writeFileSync(join(cwd, 'CLAUDE.md'), '# Mine\n');
  installSkills(cwd);
  installSkills(cwd); // idempotent
  for (const s of ['start-vibe-session', 'vibe-control', 'vibe-translate', 'analyze-code-base', 'eventmodeling-core-rules', 'connect']) assert.ok(existsSync(join(cwd, '.claude', 'skills', s, 'SKILL.md')), s);
  const md = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
  assert.equal(md.split('eventmodelers-vibe:start').length, 2);
  assert.match(md, /^# Mine/);
  assert.ok(!md.includes('{{CLI}}'));
  assert.equal(git(cwd, 'status', '--porcelain', '--', 'src').trim(), '');
});
