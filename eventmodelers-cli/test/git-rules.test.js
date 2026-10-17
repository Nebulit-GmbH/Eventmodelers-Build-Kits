import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureLearningsGitRules } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

// A project dir with a git repo and an empty kit dir.
function project(t) {
  const root = tempKit(t);
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  const kit = join(root, '.build-kit');
  mkdirSync(kit, { recursive: true });
  return { root, kit };
}

test('git rules go in .git/info, not in tracked files, so the loop never dirties the tree it is about to judge', (t) => {
  quiet(t);
  const { root, kit } = project(t);
  mkdirSync(join(root, '.git', 'info'), { recursive: true });
  writeFileSync(join(root, '.git', 'info', 'exclude'), 'node_modules');
  ensureLearningsGitRules(kit);
  ensureLearningsGitRules(kit);
  assert.equal(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8'),
    'node_modules\n.build-kit/events/\n.build-kit/events.log\n');
  assert.equal(readFileSync(join(root, '.git', 'info', 'attributes'), 'utf-8'), '.build-kit/AGENTS.md merge=union\n');
  assert.equal(existsSync(join(root, '.gitignore')), false);
  assert.equal(existsSync(join(root, '.gitattributes')), false);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' }).includes('.gitignore'), false);
});

test('the ignore rules really apply: the event store stays out of git status', (t) => {
  quiet(t);
  const { root, kit } = project(t);
  ensureLearningsGitRules(kit);
  mkdirSync(join(kit, 'events'), { recursive: true });
  writeFileSync(join(kit, 'events', 'x.json'), '{}');
  writeFileSync(join(kit, 'events.log'), 'x\n');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', '.build-kit/events', '.build-kit/events.log'], { cwd: root, encoding: 'utf-8' }), '');
});
