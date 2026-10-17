// The git side of a claim: what state a build starts from, and undoing a failed attempt. Nothing here
// knows about slice state — the caller passes `base` and `cleanTree` (recorded on the `claimed` event).

import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { basename, dirname, join } from 'path';

// The kit dir (.build-kit: slices, event store), .eventmodelers (credentials) and progress.txt belong to
// the loop and the agent's bookkeeping, never to a slice's code — they are outside every check and every
// discard below.
function treePathspec(kitDir) {
  return ['.', `:(exclude)${basename(kitDir)}`, ':(exclude).eventmodelers', ':(exclude)progress.txt'];
}

function gitIn(projectDir, ...args) {
  return execFileSync('git', args, { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function currentBranch(projectDir) {
  try { return gitIn(projectDir, 'symbolic-ref', '-q', '--short', 'HEAD').trim(); } catch { return null; }
}

// true: clean, false: uncommitted changes, null: not a git repo / git unavailable.
export function isTreeClean(kitDir) {
  const projectDir = dirname(kitDir);
  if (!existsSync(join(projectDir, '.git'))) return null;
  try {
    return gitIn(projectDir, 'status', '--porcelain', '--', ...treePathspec(kitDir)).trim() === '';
  } catch {
    return null;
  }
}

// The git state a claim starts from: the checked-out branch (null when detached), its commit, and the
// local branches that exist. null when this is not a git repo / git is unavailable.
export function gitBase(kitDir) {
  const projectDir = dirname(kitDir);
  if (!existsSync(join(projectDir, '.git'))) return null;
  try {
    const branch = gitIn(projectDir, 'symbolic-ref', '-q', '--short', 'HEAD').trim();
    const head = gitIn(projectDir, 'rev-parse', 'HEAD').trim();
    const branches = gitIn(projectDir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);
    return { branch, head, branches };
  } catch {
    return null; // e.g. detached HEAD or a repo without commits — nothing safe to restore later
  }
}

// A build that ended without recording an outcome did not finish, and the attempt is undone as if it
// never happened: uncommitted work is discarded, the branch the claim started on is checked out again
// and every `feature/*` branch created since is deleted — so the retry starts from the state the
// claim saw, not on top of a half-done build. Only when the tree was clean when the slice was claimed;
// otherwise the changes may be a person's own work, and the loop leaves them alone. Commits on the
// starting branch itself are never rewritten.
// Returns what was thrown away ({ changed, created, branch }) for the caller to record, or null when
// nothing was touched.
export function discardUnfinishedWork(kitDir, planned, cleanTree, base = null) {
  const projectDir = dirname(kitDir);
  if (cleanTree !== true) {
    if (cleanTree === false) console.warn(`[ralph] "${planned.title}" ended unfinished, but the working tree had uncommitted changes before the build — leaving them in place.`);
    return null;
  }
  try {
    const spec = treePathspec(kitDir);
    const changed = gitIn(projectDir, 'status', '--porcelain', '--', ...spec).trim();
    const branch = currentBranch(projectDir);
    const created = base?.branches
      ? gitIn(projectDir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/feature').split('\n')
          .filter((b) => b && !base.branches.includes(b))
      : [];
    const onOtherBranch = Boolean(base?.branch) && branch !== base.branch;
    if (!changed && !created.length && !onOtherBranch) return null;

    // Scoped to the build's own paths, so the kit dir, .eventmodelers and progress.txt keep any staging.
    gitIn(projectDir, 'reset', '-q', 'HEAD', '--', ...spec);
    gitIn(projectDir, 'checkout', '--', ...spec);
    gitIn(projectDir, 'clean', '-fdq', '--', ...spec);
    if (onOtherBranch) gitIn(projectDir, 'checkout', '-q', base.branch);
    for (const b of created) gitIn(projectDir, 'branch', '-D', b);
    console.log(`[ralph] Discarded the unfinished attempt at "${planned.title}"${created.length ? ` (deleted ${created.join(', ')})` : ''}:\n${changed}`);
    return { changed, created, branch };
  } catch (err) {
    console.error(`[ralph] Could not discard the unfinished work of "${planned.title}":`, err.message);
    return null;
  }
}
