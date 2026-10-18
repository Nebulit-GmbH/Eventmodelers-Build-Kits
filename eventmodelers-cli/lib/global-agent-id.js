// A run on the global install keeps one agent id per board and repo — "repo" being the directory the run is
// started in (its git root, or the directory itself outside git). It is the same agent on every start: its chat
// sessions, its star on the board and the prompts it holds all stay addressed to it. The ids live in one small
// file next to the per-board credentials; nothing is written into the repo.

import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { dirname } from 'path';

function real(path) {
  try { return realpathSync(path); } catch { return path; }
}

// The git root of `dir`, else `dir` — both with symlinks resolved, so two paths to one repo are one repo.
export function repoKey(dir) {
  const start = real(dir);
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top ? real(top) : start;
  } catch {
    return start;
  }
}

function readIds(file) {
  try {
    const ids = JSON.parse(readFileSync(file, 'utf-8'));
    return ids && typeof ids === 'object' && !Array.isArray(ids) ? ids : {};
  } catch {
    return {};
  }
}

export function stableGlobalAgentId({ file, boardId, dir, mint = randomUUID }) {
  const key = `${boardId}|${repoKey(dir)}`;
  const ids = readIds(file);
  if (typeof ids[key] === 'string' && ids[key]) return ids[key];
  const id = mint();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...ids, [key]: id }, null, 2), 'utf-8');
  renameSync(tmp, file);
  return id;
}
