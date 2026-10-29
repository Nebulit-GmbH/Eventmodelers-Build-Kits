// Is this code covered by the model? Answered from .vibe/baseline/ and git alone — no board, no network, no markers in the source.
//
//   governed   inside the folders of a chapter analysed at depth ≥ 1, and unchanged since its last history row
//   drifted    inside such a chapter, but a file is not what the last row says (committed since, or edited and not synced)
//   uncovered  in no analysed chapter (or a depth-0 one: milestones only, no folders) — nobody has looked at it yet
//   free       a chapter's "not modeled" path, or a folder the person said never to ask about
//
// Git is required: the baseline is a commit plus the content hash of every file that differed from it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { control } from './control.js';
import { foldersOf, listBaselines, normPath, onPath } from './state.js';

const git = (root, args, input) => execFileSync('git', args, { cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

export function isGit(root) {
  try { return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'; } catch { return false; }
}

export const headCommit = (root) => { try { return git(root, ['rev-parse', '--short', 'HEAD']).trim(); } catch { return null; } };
export const commitReachable = (root, commit) => { try { git(root, ['cat-file', '-e', `${commit}^{commit}`]); return true; } catch { return false; } };


/** Content hash of each file (git's own, so equal content is equal everywhere); a file that is gone is 'deleted'. */
function hashes(root, files) {
  const present = files.filter((f) => existsSync(join(root, f)));
  const out = {};
  if (present.length) git(root, ['hash-object', '--stdin-paths'], present.join('\n') + '\n').trim().split('\n').forEach((h, i) => { out[present[i]] = h; });
  for (const f of files) out[f] ??= 'deleted';
  return out;
}

/** The files of `folders` that differ from `commit` right now (committed since, edited, new, deleted), with their content hash. */
export function dirtyState(root, commit, folders) {
  if (!folders.length) return {};
  const specs = folders.map(normPath);
  const files = new Set();
  if (commit) {
    for (const f of git(root, ['diff', '--name-only', commit, '--', ...specs]).split('\n')) if (f) files.add(f);
  }
  for (const f of git(root, ['ls-files', '--others', '--exclude-standard', '--', ...specs]).split('\n')) if (f) files.add(f);
  return hashes(root, [...files].sort());
}

/** { commit, dirty } of a chapter's folders as they are now — what a history row records. */
export function stateOf(root, folders) {
  const commit = headCommit(root);
  return { commit, dirty: dirtyState(root, commit, folders) };
}

/** The files of a chapter that are not what its last history row says. null: there is no row, or its commit is gone. */
export function driftOf(root, baseline) {
  const last = baseline.history[baseline.history.length - 1];
  const folders = foldersOf(baseline).map((f) => f.path);
  if (!last || !last.commit || !commitReachable(root, last.commit)) return null;
  const now = dirtyState(root, last.commit, folders);
  const known = last.dirty || {};
  const files = new Set([...Object.keys(now), ...Object.keys(known)]);
  return [...files].filter((f) => now[f] !== known[f]).sort();
}

/** What the person has answered so far: folders never to ask about again. */
export function ignoredFolders(root) {
  return control(root).events.filter((e) => e.type === 'CoverageAnswered' && e.data.answer === 'ignore').map((e) => e.data.folder);
}

const rel = (root, f) => (isAbsolute(f) ? relative(root, f) : f).replace(/\\/g, '/').replace(/^\.\//, '');

// What the tools themselves keep in the project is not code the model could cover.
const TOOLING = ['.vibe/', '.claude/', '.build-kit/', '.agent-modeling-kit/', '.eventmodelers/', '.slices/', '.mcp.json', 'CLAUDE.md'];

/** The working tree's changed and new files (what a hook or an unspecific check looks at), without the tooling's own. */
export function workingTreeFiles(root) {
  const out = git(root, ['status', '--porcelain', '-uall']).split('\n').filter(Boolean);
  return out.map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')).filter((f) => !TOOLING.some((t) => onPath(f, t)));
}

/**
 * Classifies files. `files` are relative to the root, or absolute. Returns { files: [{ file, status, chapter?, reason? }], chapters, questions }.
 * `questions` are what has to be asked before the code is changed: one per uncovered folder and one per drifted chapter, minus what the
 * person already told to leave alone. A governed, in-sync chapter needs no question.
 */
export function check(root, files) {
  const baselines = listBaselines(root);
  const ignored = ignoredFolders(root);
  const governedBy = (file) => baselines.find((b) => b.depth >= 1 && foldersOf(b).some((f) => onPath(file, f.path)));
  const drift = new Map();
  const driftFor = (b) => { if (!drift.has(b.chapter)) drift.set(b.chapter, driftOf(root, b)); return drift.get(b.chapter); };

  const classified = [...new Set(files.map((f) => rel(root, f)))].map((file) => {
    const b = governedBy(file);
    if (ignored.some((i) => onPath(file, i))) return { file, status: 'free', reason: 'asked never to ask about this folder' };
    if (b && (b.notModeled || []).some((n) => onPath(file, n))) return { file, status: 'free', chapter: b.chapter, reason: 'not modeled' };
    if (!b) return { file, status: 'uncovered' };
    const d = driftFor(b);
    return d === null || d.length ? { file, status: 'drifted', chapter: b.chapter, reason: d === null ? 'the last analysed commit is not reachable' : `${d.length} file${d.length === 1 ? '' : 's'} changed since the last analysis` } : { file, status: 'governed', chapter: b.chapter };
  });

  const questions = [];
  const uncovered = classified.filter((c) => c.status === 'uncovered');
  if (uncovered.length) {
    // One question per directory: the nearest common parent of the uncovered files that share a top-level folder.
    const groups = new Map();
    for (const c of uncovered) {
      const top = c.file.includes('/') ? c.file.split('/')[0] : '.';
      groups.set(top, [...(groups.get(top) || []), c.file]);
    }
    for (const list of groups.values()) questions.push({ kind: 'uncovered', folder: commonDir(list), files: list });
  }
  for (const chapter of [...new Set(classified.filter((c) => c.status === 'drifted').map((c) => c.chapter))]) {
    questions.push({ kind: 'drifted', chapter, files: driftFor(baselines.find((b) => b.chapter === chapter)) || [] });
  }
  return { files: classified, chapters: baselines.map((b) => ({ chapter: b.chapter, depth: b.depth })), questions };
}

/** The deepest directory that contains all the files, with a trailing slash ('' for the project root). */
function commonDir(files) {
  const parts = files.map((f) => dirname(f).split('/').filter((p) => p && p !== '.'));
  const first = parts[0];
  let n = 0;
  while (n < first.length && parts.every((p) => p[n] === first[n])) n++;
  return n ? `${first.slice(0, n).join('/')}/` : '';
}

export const absolute = (root, f) => resolve(root, f);
