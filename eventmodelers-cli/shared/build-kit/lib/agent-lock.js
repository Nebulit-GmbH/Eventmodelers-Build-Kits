// One agent id, one live process. An agent keeps its stable id (see ensureAgentId); a second process that would
// share it — two `run`s in one project, two standalone runs from one repo — gets a fresh id instead. Sharing one
// would make them fight over a single heartbeat row and a single chat, and the second one's start-up recovery
// would hand back the first one's prompts.
//
// The id is claimed with an exclusive lock file (`<id>.lock`, holding the pid) that the process removes on exit. It
// is written complete under a private name and then hard-linked into place, so a competitor never finds it empty
// and mistakes a lock being taken for one left over.
// A lock left by a process that is gone — a crash, kill -9 — is taken over. A lock problem never stops an agent:
// if locking is impossible the stable id is simply kept.

import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { isProcessAlive } from './slice-run.js';

const answers = new Map(); // lock file path → the answer given in this process, so asking twice is one decision
const owned = new Set(); // lock files this process holds
let exitHooked = false;

function release() {
  for (const path of owned) {
    try {
      if (JSON.parse(readFileSync(path, 'utf-8')).pid === process.pid) rmSync(path, { force: true });
    } catch { /* already gone */ }
  }
  owned.clear();
}

// true: the lock is ours; false: a live process of another pid holds it.
function lock(path, pid, isAlive) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const mine = `${path}.${pid}.${randomUUID()}.tmp`;
      writeFileSync(mine, JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      try {
        linkSync(mine, path); // EEXIST when someone holds it — atomically, and never half written
      } finally {
        rmSync(mine, { force: true });
      }
      owned.add(path);
      if (!exitHooked) { exitHooked = true; process.on('exit', release); }
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return true; // cannot lock here (permissions, odd filesystem): do not get in the way
      let holder = null;
      try { holder = JSON.parse(readFileSync(path, 'utf-8')).pid; } catch { /* unreadable: left over */ }
      if (holder === pid) return true;
      if (holder !== null && isAlive(holder)) return false;
      rmSync(path, { force: true }); // left over by a process that is gone — take it over
    }
  }
  return true;
}

// `stableId` is the id this agent keeps. Returns { agentId, fellBack }: the stable id when this process got the
// lock, else a fresh one. Decided once per process and lock directory.
export function acquireAgentId({ lockDir, stableId, mint = randomUUID, isAlive = isProcessAlive, pid = process.pid }) {
  const path = join(lockDir, `${stableId}.lock`);
  if (answers.has(path)) return answers.get(path);
  let taken = true;
  try {
    mkdirSync(lockDir, { recursive: true });
    taken = lock(path, pid, isAlive);
  } catch { /* cannot lock here: keep the stable id */ }
  const answer = taken ? { agentId: stableId, fellBack: false } : { agentId: mint(), fellBack: true };
  answers.set(path, answer);
  return answer;
}

// Releases this process's locks and forgets what it decided — for tests, and a clean shutdown.
export function forgetAgentLocks() {
  release();
  answers.clear();
}
