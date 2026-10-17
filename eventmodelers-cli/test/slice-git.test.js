import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discardUnfinishedWork, gitBase, isTreeClean } from '../shared/build-kit/lib/slice-git.js';
import { quiet, tempKit } from './helpers.js';

// Layer E (slice-state-test-design.md): cases 11–16 of slice-state-learnings.md. These are about git,
// not state — `base` and `cleanTree` are handed in by the caller (they come from the `claimed` event).

const planned = { id: 's1', title: 'Add item', ctx: 'cart' };

function project(t) {
  const root = tempKit(t);
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf-8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'code.txt'), 'v1');
  const kit = join(root, '.build-kit');
  mkdirSync(kit, { recursive: true });
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { root, kit, git };
}

test('discard removes the build\'s uncommitted work but keeps the kit and progress.txt (11)', (t) => {
  quiet(t);
  const { root, kit } = project(t);
  writeFileSync(join(root, 'code.txt'), 'half done');
  writeFileSync(join(root, 'new.txt'), 'x');
  writeFileSync(join(root, 'progress.txt'), 'note');
  writeFileSync(join(kit, 'AGENTS.md'), 'learning');
  const info = discardUnfinishedWork(kit, planned, true);
  assert.equal(readFileSync(join(root, 'code.txt'), 'utf-8'), 'v1');
  assert.equal(existsSync(join(root, 'new.txt')), false);
  assert.equal(existsSync(join(root, 'progress.txt')), true);
  assert.equal(existsSync(join(kit, 'AGENTS.md')), true);
  assert.match(info.changed, /code\.txt/);
  assert.match(info.changed, /new\.txt/);
});

test('discard undoes the whole attempt: branch restored, new feature branch deleted, details returned (12)', (t) => {
  quiet(t);
  const { root, kit, git } = project(t);
  const main = git('symbolic-ref', '--short', 'HEAD').trim();
  const base = gitBase(kit);
  assert.equal(base.branch, main);
  git('checkout', '-q', '-b', 'feature/add-item');
  writeFileSync(join(root, 'code.txt'), 'half done');
  writeFileSync(join(root, 'new.txt'), 'x');
  git('add', 'new.txt');
  git('commit', '-qm', 'wip');
  writeFileSync(join(root, 'code.txt'), 'more half done');
  const info = discardUnfinishedWork(kit, planned, true, base);
  assert.equal(git('symbolic-ref', '--short', 'HEAD').trim(), main);
  assert.equal(git('branch', '--list', 'feature/add-item').trim(), '');
  assert.equal(readFileSync(join(root, 'code.txt'), 'utf-8'), 'v1');
  assert.equal(existsSync(join(root, 'new.txt')), false);
  assert.deepEqual({ branch: info.branch, created: info.created }, { branch: 'feature/add-item', created: ['feature/add-item'] });
  assert.match(info.changed, /code\.txt/);
});

test('discard leaves the staging of kit files alone (13)', (t) => {
  quiet(t);
  const { root, kit, git } = project(t);
  writeFileSync(join(root, 'code.txt'), 'half done');
  writeFileSync(join(kit, 'AGENTS.md'), 'learning');
  git('add', '.build-kit/AGENTS.md');
  discardUnfinishedWork(kit, planned, true);
  assert.match(git('diff', '--cached', '--name-only'), /AGENTS\.md/);
});

test('discard leaves changes alone when the tree was already dirty at claim time (14)', (t) => {
  quiet(t);
  const { root, kit } = project(t);
  writeFileSync(join(root, 'code.txt'), 'a person\'s edit');
  assert.equal(isTreeClean(kit), false);
  assert.equal(discardUnfinishedWork(kit, planned, false), null);
  assert.equal(readFileSync(join(root, 'code.txt'), 'utf-8'), 'a person\'s edit');
});

test('kit-dir changes do not make the tree dirty (15)', (t) => {
  const { kit } = project(t);
  writeFileSync(join(kit, 'AGENTS.md'), 'x');
  assert.equal(isTreeClean(kit), true);
});

test('there is nothing to report when the build left nothing behind', (t) => {
  quiet(t);
  const { kit } = project(t);
  assert.equal(discardUnfinishedWork(kit, planned, true, gitBase(kit)), null);
});

test('outside a git repo the tree has no cleanliness and there is no base', (t) => {
  const kit = join(tempKit(t), '.build-kit');
  mkdirSync(kit, { recursive: true });
  assert.equal(isTreeClean(kit), null);
  assert.equal(gitBase(kit), null);
  assert.equal(discardUnfinishedWork(kit, planned, null), null);
});

test('gitBase names the branch, its commit and the local branches', (t) => {
  const { kit, git } = project(t);
  const base = gitBase(kit);
  assert.equal(base.head, git('rev-parse', 'HEAD').trim());
  assert.ok(base.branches.includes(base.branch));
});
