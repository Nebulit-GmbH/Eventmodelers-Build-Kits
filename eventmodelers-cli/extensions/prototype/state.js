// Everything the local prototype keeps on disk lives under <cwd>/.prototype/ — deleting that folder resets the project.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DIR = '.prototype';

export function paths(cwd) {
  const root = join(cwd, DIR);
  return {
    root,
    slices: join(cwd, '.slices'), // where `fetch` always writes — the editable model, shared with the other kits
    baseline: join(root, 'baseline'), // slice.json as last fetched or synced, one file per slice id
    state: join(root, 'state.json'),
    screens: join(root, 'screens'), // one folder per screen node: screen.json + page-N.html
    vendor: join(root, 'vendor'),
    work: join(root, 'work'),
    blocks: join(root, 'work', 'slices'),
    page: join(root, 'index.html'),
  };
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2));

// Data that changes without the slice's meaning changing — left out of every hash.
const VOLATILE = new Set(['status', 'assignee', 'ticketNumber', 'comments']);

/** Stable JSON: sorted keys, volatile keys and the random id of a SPEC_ERROR step dropped. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (VOLATILE.has(k)) continue;
      if (k === 'id' && value.type === 'SPEC_ERROR') continue;
      out[k] = canonical(value[k]);
    }
    return out;
  }
  return value;
}

export const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const hashOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);

/** The screen records (pages, marks, sketch) a slice shows, from screens.json. */
export const screensOf = (slice, screens) => (slice.screens || []).map((x) => screens[x.linkedId || x.id] || null);

/** The page hash of a slice — its elements, scenarios and screens. Matches `data-em-hash` on its block. */
export const sliceHash = (slice, screens) => hashOf({ slice, screens: screensOf(slice, screens) });

/** The slices on disk in timeline order: [{ id, folder, file, slice }]. */
export function loadSlices(p) {
  const found = [];
  if (!existsSync(p.slices)) return found;
  // .slices/ can hold other contexts too (and the build kits' own work) — only this prototype's context is its model.
  const wanted = readJson(p.state, {}).context;
  const dirs = readdirSync(p.slices).filter((c) => statSync(join(p.slices, c)).isDirectory());
  const own = dirs.filter((c) => readJson(join(p.slices, c, 'context.json'), {}).name === wanted);
  for (const ctx of own.length ? own : dirs) {
    const dir = join(p.slices, ctx);
    const index = readJson(join(dir, 'index.json'), { slices: [] }).slices || [];
    const folders = index.map((e) => e.folder);
    for (const f of readdirSync(dir)) if (!folders.includes(f) && existsSync(join(dir, f, 'slice.json'))) folders.push(f);
    for (const folder of folders) {
      const file = join(dir, folder, 'slice.json');
      const slice = readJson(file);
      if (slice) found.push({ id: slice.id, folder, file, slice });
    }
  }
  return found;
}

export const readBaseline = (p, id) => readJson(join(p.baseline, `${id}.json`));

export function writeBaseline(p, id, slice) {
  mkdirSync(p.baseline, { recursive: true });
  writeJson(join(p.baseline, `${id}.json`), slice);
}

/** Record every slice on disk as the state the board has. */
export function snapshotBaseline(p) {
  const screenHashes = readJson(join(p.baseline, 'screens.json'), null); // what fetch remembered about the screens survives a new slice baseline
  rmSync(p.baseline, { recursive: true, force: true });
  if (screenHashes) { mkdirSync(p.baseline, { recursive: true }); writeJson(join(p.baseline, 'screens.json'), screenHashes); }
  for (const { id, slice } of loadSlices(p)) writeBaseline(p, id, slice);
}

/** Slices whose model differs from the baseline — what `sync` has to look at. */
export const changedSlices = (p) =>
  loadSlices(p).filter(({ id, slice }) => {
    const base = readBaseline(p, id);
    return !base || !same(base, slice);
  });

// What `fetch` last gave (or the last sync wrote) is remembered per screen in baseline/screens.json: { id: { hash, pages } } — the hash of the whole
// record, the hash of its pages as the board has them. A screen whose files differ from it was edited here: it is synced to the board (as a
// node:changed of meta.pages), and until then a fetch keeps it. The board's own pages hash is what a sync compares to see the board changed it too.
const screenHashFile = (p) => join(p.baseline, 'screens.json');
const entryOf = (s) => ({ hash: hashOf(s), pages: hashOf(s.pages ?? null) });
const screenHashes = (p) => Object.fromEntries(Object.entries(loadScreens(p)).map(([id, s]) => [id, entryOf(s)]));
const hashOfEntry = (e) => (typeof e === 'string' ? e : e && e.hash); // a baseline from before it held the pages hash too

/** Remember the screens on disk as what the board has — except those in `keep`, which stay recorded as they were (still edited). */
export function snapshotScreens(p, keep = []) {
  mkdirSync(p.baseline, { recursive: true });
  const before = readJson(screenHashFile(p), {});
  const now = screenHashes(p);
  for (const id of keep) if (id in before) now[id] = before[id];
  writeJson(screenHashFile(p), now);
}

/** Remember one screen as what the board has now (after a sync wrote it). */
export function snapshotScreen(p, id) {
  const before = readJson(screenHashFile(p), {});
  const screen = loadScreens(p)[id];
  if (!screen) return;
  mkdirSync(p.baseline, { recursive: true });
  writeJson(screenHashFile(p), { ...before, [id]: entryOf(screen) });
}

/** Whether a fetch has remembered the screens before (a project from before that has not: its screens cannot be told from edits). */
export const hasScreenBaseline = (p) => existsSync(screenHashFile(p));

/** The pages hash the board had when the screen was last fetched or synced (undefined: not remembered). */
export const baselinePagesHash = (p, id) => { const e = readJson(screenHashFile(p), {})[id]; return e && typeof e === 'object' ? e.pages : undefined; };
export const pagesHashOf = (pages) => hashOf(pages ?? null);

// A project fetched before screens were remembered has no baseline: its edits can only be guessed — a screen whose files are newer than the last fetch.
const FETCH_GRACE_MS = 30_000;
function editedSinceFetch(p) {
  const at = Date.parse(readJson(p.state, {}).fetchedAt || '');
  if (!Number.isFinite(at) || !existsSync(p.screens)) return [];
  return readdirSync(p.screens).filter((id) => {
    const dir = join(p.screens, id);
    try { return readdirSync(dir).some((f) => statSync(join(dir, f)).mtimeMs > at + FETCH_GRACE_MS); } catch { return false; }
  });
}

/** Ids of the screens edited since the last fetch (their folder differs from what was written). A screen the baseline never saw is not an edit. */
export function editedScreens(p) {
  const before = readJson(screenHashFile(p), null);
  if (!before) return editedSinceFetch(p);
  const now = screenHashes(p);
  return Object.keys(now).filter((id) => id in before && hashOfEntry(before[id]) !== now[id].hash);
}

/** Replaces one screen's pages on disk (page-N.html files and the index in screen.json), keeping everything else of the screen. */
export function writeScreenPages(p, id, pages) {
  const dir = join(p.screens, id);
  const meta = readJson(join(dir, 'screen.json'));
  if (!meta) throw new Error(`No screen ${id} in the local model`);
  const { pages: _old, pagesAreStrings: _flag, ...rest } = meta;
  for (const f of readdirSync(dir)) if (/^page-\d+\.html$/.test(f)) rmSync(join(dir, f));
  const index = pages.map((page, i) => {
    const file = `page-${i + 1}.html`;
    const isString = typeof page === 'string';
    writeFileSync(join(dir, file), isString ? page : String(page.html ?? ''));
    return isString ? { file } : { ...Object.fromEntries(Object.entries(page).filter(([k]) => k !== 'html')), file };
  });
  writeJson(join(dir, 'screen.json'), { ...rest, pages: index, pagesAreStrings: pages.every((x) => typeof x === 'string') });
}

/** Writes every screen into its own folder, pages as real .html files: { id: { type, title, pages, marks, cssFrameworks, sketch } }. */
export function writeScreens(p, screens) {
  rmSync(p.screens, { recursive: true, force: true });
  for (const [id, s] of Object.entries(screens)) {
    const dir = join(p.screens, id);
    mkdirSync(dir, { recursive: true });
    const { pages, ...rest } = s;
    const index = (pages || []).map((page, i) => {
      const file = `page-${i + 1}.html`;
      const isString = typeof page === 'string';
      writeFileSync(join(dir, file), isString ? page : String(page.html ?? ''));
      return isString ? { file } : { ...Object.fromEntries(Object.entries(page).filter(([k]) => k !== 'html')), file };
    });
    writeJson(join(dir, 'screen.json'), { ...rest, id, pages: pages ? index : null, pagesAreStrings: (pages || []).every((x) => typeof x === 'string') });
  }
}

/** The screens on disk, in the shape writeScreens took: { id: { type, pages, marks, ... } }. Edited files count. */
export function loadScreens(p) {
  const screens = {};
  if (!existsSync(p.screens)) return screens;
  for (const id of readdirSync(p.screens)) {
    const meta = readJson(join(p.screens, id, 'screen.json'));
    if (!meta) continue;
    const { pages, pagesAreStrings, ...rest } = meta;
    screens[id] = {
      ...rest,
      pages: pages ? pages.map(({ file, ...more }) => {
        const html = readFileSync(join(p.screens, id, file), 'utf8');
        return pagesAreStrings ? html : { ...more, html };
      }) : null,
    };
  }
  return screens;
}
