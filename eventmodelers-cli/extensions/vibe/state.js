// Everything `init --vibe-coding` keeps on disk lives under <root>/.vibe/ — root is the directory init ran in, the one .vibe/ of the project.
// A Claude Code run started inside a nested module finds it by walking up (findVibeRoot). Deleting the folder resets the project.
//
//   .vibe/baseline/<chapter>.json   the analysis log of one chapter — written by `analyze-code-base` (and by every sync) through
//                                   `vibe baseline write|advance`, never edited by hand. The board's `Legacy Sources — <Chapter>`
//                                   note is rendered from it (render.js); nothing ever parses the note back.
//   .vibe/events/, events.log       the control log (control.js), the same store the build kits and the prototype use
//
// Baseline file:
//   { chapter, depth, runningUi?, folders: { api|persistence|tests|ui: [{ path, key? }] }, notModeled: [path], decisions: [{ decision, why, source, confirmedBy }],
//     history: [{ date, commit, dirty: { <path>: <hash> }, pass, scope, result }] }
// `commit` + `dirty` say exactly which state of the chapter's folders was analysed: the commit, plus the content hash of every file that
// differed from it (uncommitted or committed since). Drift is a file whose content is not what the last row says (coverage.js).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const DIR = '.vibe';
export const LENSES = ['api', 'persistence', 'tests', 'ui'];

/** The project's .vibe/ root: `from` or the nearest parent that holds one. null when there is none. */
export function findVibeRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, DIR))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function paths(root) {
  const base = join(root, DIR);
  return { root: base, baseline: join(base, 'baseline') };
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

export const slug = (title) => String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chapter';


/** A not-modeled path: a folder (trailing slash kept) or a single file. */
export const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
/** Does `file` lie on `path` — the file itself, or inside it when it is a folder (with or without the trailing slash)? */
export const onPath = (file, path) => { const n = normPath(path); return file === n || file.startsWith(n.endsWith('/') ? n : `${n}/`); };

const normFolders = (folders = {}) => Object.fromEntries(LENSES.map((lens) => [lens, (folders[lens] || []).map((f) => {
  const e = typeof f === 'string' ? { path: f } : f;
  return { path: normPath(e.path), ...(e.key ? { key: String(e.key) } : {}) };
})]));

export const baselineFile = (root, chapter) => join(paths(root).baseline, `${slug(chapter)}.json`);
export const readBaseline = (root, chapter) => readJson(baselineFile(root, chapter));

export function listBaselines(root) {
  const dir = paths(root).baseline;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f))).filter((b) => b && b.chapter);
}

/**
 * Writes a chapter's baseline: `fields` (depth, folders, notModeled, decisions, runningUi) replace what is there when given and stay when
 * not; `row` is appended to the history — never edited, never dropped. `state` is { commit, dirty } of the chapter's folders right now.
 */
export function writeBaseline(root, chapter, fields, row, state) {
  const old = readBaseline(root, chapter) || { chapter, depth: 0, folders: normFolders(), notModeled: [], decisions: [], history: [] };
  const next = {
    ...old,
    chapter,
    ...(fields.depth !== undefined ? { depth: Number(fields.depth) } : {}),
    ...(fields.runningUi !== undefined ? { runningUi: fields.runningUi } : {}),
    ...(fields.folders ? { folders: normFolders(fields.folders) } : { folders: normFolders(old.folders) }),
    ...(fields.notModeled ? { notModeled: fields.notModeled.map(normPath) } : {}),
    ...(fields.decisions ? { decisions: fields.decisions } : {}),
    history: [...old.history, { date: new Date().toISOString().slice(0, 10), commit: state.commit, dirty: state.dirty, pass: String(row.pass || ''), scope: String(row.scope || ''), result: String(row.result || '') }],
  };
  writeJson(baselineFile(root, chapter), next);
  return next;
}

/** All folders of a baseline, flat: [{ lens, path, key }]. */
export const foldersOf = (b) => LENSES.flatMap((lens) => (b.folders?.[lens] || []).map((f) => ({ lens, ...f })));

export const removeVibe = (root) => rmSync(join(root, DIR), { recursive: true, force: true });
