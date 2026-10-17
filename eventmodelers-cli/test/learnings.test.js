import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureLearningsGitRules, stageLearnings, learningsRequest, finishLearnings } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

// A project dir with a git repo and an empty kit dir.
function project(t) {
  const root = tempKit(t);
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  const kit = join(root, '.build-kit');
  mkdirSync(kit, { recursive: true });
  return { root, kit };
}

// A project dir with a progress.txt and (optionally) an AGENTS.md in the kit.
function learnings(t, { agents = 'old learning' } = {}) {
  const root = tempKit(t);
  const kit = join(root, '.build-kit');
  mkdirSync(kit, { recursive: true });
  writeFileSync(join(root, 'progress.txt'), '## entry\nlearned a thing');
  if (agents !== null) writeFileSync(join(kit, 'AGENTS.md'), agents);
  return { root, kit };
}

test('staging moves progress.txt aside and asks the build agent, in its own turn, to fold it in', (t) => {
  const { root, kit } = learnings(t);
  const staged = stageLearnings(kit);
  assert.equal(existsSync(join(root, 'progress.txt')), false);
  assert.match(readFileSync(join(kit, 'progress.pending.txt'), 'utf-8'), /learned a thing/);
  assert.match(learningsRequest(staged), /progress\.pending\.txt/);
});

test('nothing to stage without a log, and no request is added', (t) => {
  const { root, kit } = learnings(t);
  rmSync(join(root, 'progress.txt'));
  assert.equal(stageLearnings(kit), null);
  assert.equal(learningsRequest(null), '');
});

test('the pending log is deleted once AGENTS.md changed', (t) => {
  quiet(t);
  const { kit } = learnings(t);
  const staged = stageLearnings(kit);
  writeFileSync(join(kit, 'AGENTS.md'), 'old learning\nnew learning');
  finishLearnings(staged);
  assert.equal(existsSync(join(kit, 'progress.pending.txt')), false);
});

test('the pending log survives a build that left AGENTS.md unchanged and joins the next one', (t) => {
  quiet(t);
  const { root, kit } = learnings(t);
  finishLearnings(stageLearnings(kit));
  assert.equal(existsSync(join(kit, 'progress.pending.txt')), true);
  writeFileSync(join(root, 'progress.txt'), '\n## later entry');
  stageLearnings(kit);
  const pending = readFileSync(join(kit, 'progress.pending.txt'), 'utf-8');
  assert.match(pending, /learned a thing/);
  assert.match(pending, /later entry/);
});

test('an emptied AGENTS.md is restored and the pending log kept', (t) => {
  quiet(t);
  const { kit } = learnings(t);
  const staged = stageLearnings(kit);
  writeFileSync(join(kit, 'AGENTS.md'), '');
  finishLearnings(staged);
  assert.equal(readFileSync(join(kit, 'AGENTS.md'), 'utf-8'), 'old learning');
  assert.equal(existsSync(join(kit, 'progress.pending.txt')), true);
});

test('git rules go in .git/info, not in tracked files, so the loop never dirties the tree it is about to judge', (t) => {
  quiet(t);
  const { root, kit } = project(t);
  mkdirSync(join(root, '.git', 'info'), { recursive: true });
  writeFileSync(join(root, '.git', 'info', 'exclude'), 'node_modules');
  ensureLearningsGitRules(kit);
  ensureLearningsGitRules(kit);
  assert.equal(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8'),
    'node_modules\nprogress.txt\n.build-kit/progress.pending.txt\n.build-kit/events/\n.build-kit/events.log\n');
  assert.equal(readFileSync(join(root, '.git', 'info', 'attributes'), 'utf-8'), '.build-kit/AGENTS.md merge=union\n');
  assert.equal(existsSync(join(root, '.gitignore')), false);
  assert.equal(existsSync(join(root, '.gitattributes')), false);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' }).includes('.gitignore'), false);
});

test('the ignore rules really apply: the event store and the pending log stay out of git status', (t) => {
  quiet(t);
  const { root, kit } = project(t);
  ensureLearningsGitRules(kit);
  mkdirSync(join(kit, 'events'), { recursive: true });
  writeFileSync(join(kit, 'events', 'x.json'), '{}');
  writeFileSync(join(kit, 'events.log'), 'x\n');
  writeFileSync(join(kit, 'progress.pending.txt'), 'x');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', '.build-kit/events', '.build-kit/events.log', '.build-kit/progress.pending.txt'], { cwd: root, encoding: 'utf-8' }), '');
});
