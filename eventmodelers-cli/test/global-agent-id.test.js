import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoKey, stableGlobalAgentId } from '../lib/global-agent-id.js';
import { tempKit } from './helpers.js';

// A run on the global install keeps one agent id per board and repo — the directory it is started in is the
// repo — so it is the same agent on every start, with its chat, its star on the board and its prompts.

const BOARD = 'board-1';
function repo(t) {
  const root = realpathSync(tempKit(t));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  return root;
}
const idsFile = (t) => join(tempKit(t), 'agent-ids.json');

test('the same board and repo give the same id on every start, and it is stored', (t) => {
  const file = idsFile(t);
  const dir = repo(t);
  const first = stableGlobalAgentId({ file, boardId: BOARD, dir });
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(stableGlobalAgentId({ file, boardId: BOARD, dir }), first);
  assert.ok(Object.values(JSON.parse(readFileSync(file, 'utf-8'))).includes(first));
});

test('starting in a subdirectory of the repo is the same agent as starting at its root', (t) => {
  const file = idsFile(t);
  const dir = repo(t);
  assert.equal(stableGlobalAgentId({ file, boardId: BOARD, dir: join(dir, 'src', 'deep') }), stableGlobalAgentId({ file, boardId: BOARD, dir }));
});

test('another board, or another repo, is another agent', (t) => {
  const file = idsFile(t);
  const a = repo(t);
  const b = repo(t);
  const id = stableGlobalAgentId({ file, boardId: BOARD, dir: a });
  assert.notEqual(stableGlobalAgentId({ file, boardId: 'board-2', dir: a }), id);
  assert.notEqual(stableGlobalAgentId({ file, boardId: BOARD, dir: b }), id);
});

test('outside git the directory itself is the repo', (t) => {
  const file = idsFile(t);
  const plain = realpathSync(tempKit(t));
  mkdirSync(join(plain, 'sub'));
  assert.equal(repoKey(plain), plain);
  assert.notEqual(stableGlobalAgentId({ file, boardId: BOARD, dir: join(plain, 'sub') }), stableGlobalAgentId({ file, boardId: BOARD, dir: plain }));
});

test('a symlinked path is the same repo as the real one', (t) => {
  const file = idsFile(t);
  const dir = repo(t);
  const link = join(tempKit(t), 'link');
  symlinkSync(dir, link);
  assert.equal(stableGlobalAgentId({ file, boardId: BOARD, dir: link }), stableGlobalAgentId({ file, boardId: BOARD, dir }));
});

test('a damaged ids file is replaced, and the other entries survive a new one', (t) => {
  const file = idsFile(t);
  writeFileSync(file, '{ broken');
  const a = repo(t);
  const id = stableGlobalAgentId({ file, boardId: BOARD, dir: a });
  const b = repo(t);
  stableGlobalAgentId({ file, boardId: BOARD, dir: b });
  assert.equal(stableGlobalAgentId({ file, boardId: BOARD, dir: a }), id);
});
