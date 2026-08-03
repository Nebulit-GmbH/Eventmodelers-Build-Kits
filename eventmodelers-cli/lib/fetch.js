import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const DEFAULT_BASE_URL = 'https://api.eventmodelers.ai';

// Thrown instead of exiting on 401/403/404 — these mean the *credentials* (not the
// network/server) are the problem, so the caller gets a chance to re-prompt and retry
// instead of just dying, the same way the connect skill's Step 4 (Verify) reacts to
// each status. Other statuses (500, etc.) still exit directly — reconfiguring
// credentials wouldn't fix those.
export class FetchAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJsonSafe(path) {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

// Mirrors shared/build-kit/code-export.mjs's slugify — kept in sync by hand since
// that file is copied verbatim into every stack's kit dir and isn't importable here.
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// Same folder-naming rule code-export.mjs applies to a slice title when writing
// .slices/<context>/<folder>/slice.json — kept identical so `fetch` and `listen`
// produce interchangeable output.
function sliceFolderName(title) {
  return (title ?? '').replaceAll(' ', '').replaceAll('slice:', '').toLowerCase();
}

// Pulls full slice detail from a single context on a board and writes it into
// .slices/, mirroring the layout code-export.mjs's /api/generate handler produces
// (minus screen images, which only ever arrive via that push-based listener).
//
// kitDir here is null for modeling-kit (see cli.js's fetch action) — nothing
// nests .slices/ under .agent-modeling-kit/, so it lands at cwd instead.
// { cwd, kitDir, cfg: { token, organizationId, boardId, baseUrl }, opts: { context, sliceId?, sliceTitle? } }
export async function runFetch({ cwd, kitDir, cfg, opts = {} }) {
  const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
  const headers = { 'x-token': cfg.token, 'x-board-id': cfg.boardId, 'x-user-id': 'cli-fetch' };

  async function fetchJson(url, what) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      console.error(`❌ Request failed (${what}): ${err.message}`);
      process.exit(1);
    }
    if (res.status === 401) throw new FetchAuthError(401, `${what}: invalid or expired token`);
    if (res.status === 403) throw new FetchAuthError(403, `${what}: token's organization does not match this board`);
    if (res.status === 404) throw new FetchAuthError(404, `${what}: board not found`);
    if (!res.ok) {
      console.error(`❌ ${what}: HTTP ${res.status}`);
      process.exit(1);
    }
    return res.json();
  }

  console.log(`▶ Fetching context "${opts.context}" from ${baseUrl} (board ${cfg.boardId})...`);

  // Falls back to cwd when no kit is installed — fetch doesn't need kit-specific
  // files, just somewhere to write .slices/.
  const SLICES_DIR = join(kitDir || cwd, '.slices');

  // /slicedata (buildSliceData) is per-context and returns full slice detail —
  // commands/events/readmodels/screens/processors/specifications/comments. It
  // resolves contextName by exact match, so no separate "list contexts" lookup
  // is needed first.
  const contextQuery = `contextName=${encodeURIComponent(opts.context)}`;
  const payload = await fetchJson(
    `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata?${contextQuery}`,
    `slicedata?${contextQuery}`,
  );
  const { slices: allSlices } = payload;

  if (allSlices.length) {
    // Mirrors code-export.mjs's /api/generate: a raw per-context payload dump at
    // .slices/<context>/config.json, alongside the per-slice output below — kept
    // for parity with `listen` even though nothing in this repo reads it back.
    const contextSlug = slugify(allSlices[0]?.context || opts.context || 'default') || 'default';
    const baseFolder = join(SLICES_DIR, contextSlug);
    mkdirSync(baseFolder, { recursive: true });
    writeFileSync(join(baseFolder, 'config.json'), JSON.stringify(payload, null, 2));
  }

  if (!allSlices.length) {
    console.log(`ℹ️  No slices found in context "${opts.context}".`);
    return;
  }

  for (const slice of allSlices) {
    // buildSliceData names this field `context`, not `contextName` (that's the
    // /slicedata/slices summary endpoint's field) — read the one this endpoint sends.
    const contextName = slice.context || opts.context || 'default';
    const contextSlug = slugify(contextName) || 'default';
    const baseFolder = join(SLICES_DIR, contextSlug);
    const sliceFolder = sliceFolderName(slice.title);
    mkdirSync(join(baseFolder, sliceFolder), { recursive: true });

    const sliceData = { ...slice };
    delete sliceData.index;
    writeFileSync(join(baseFolder, sliceFolder, 'slice.json'), JSON.stringify(sliceData, null, 2));
    writeFileSync(join(baseFolder, 'context.json'), JSON.stringify({ name: contextName }, null, 2));

    const indexFile = join(baseFolder, 'index.json');
    const sliceIndices = readJsonSafe(indexFile);
    if (!Array.isArray(sliceIndices.slices)) sliceIndices.slices = [];

    const entry = {
      id: slice.id,
      slice: slice.title,
      contextName,
      contextSlug,
      folder: sliceFolder,
      status: slice.status,
      definition: slice,
    };

    const existingIdx = sliceIndices.slices.findIndex((it) => it.id === slice.id);
    if (existingIdx === -1) {
      sliceIndices.slices.push(entry);
    } else {
      // Preserve `assigned` — it's local agent-claim state, not something the board tracks.
      sliceIndices.slices[existingIdx] = { ...entry, assigned: sliceIndices.slices[existingIdx].assigned };
    }
    writeFileSync(indexFile, JSON.stringify(sliceIndices, null, 2));
  }

  writeFileSync(join(SLICES_DIR, 'current_context.json'), JSON.stringify({ name: opts.context }, null, 2));

  console.log(`✅ Fetched ${allSlices.length} slice${allSlices.length === 1 ? '' : 's'} from context "${opts.context}" → ${relative(cwd, SLICES_DIR)}/`);

  // --slice-id/--slice-title mirror load-slice's Step 4/5 — fetch+persist everything
  // regardless, then just report the one the caller asked about.
  if (opts.sliceId || opts.sliceTitle) {
    const match = opts.sliceId
      ? allSlices.find((s) => s.id === opts.sliceId)
      : allSlices.find((s) => (s.title ?? '').toLowerCase() === opts.sliceTitle.toLowerCase());

    if (!match) {
      console.error(`\n❌ No slice found matching ${opts.sliceId ? `id "${opts.sliceId}"` : `title "${opts.sliceTitle}"`}. Available titles:`);
      allSlices.forEach((s) => console.error(`  - ${s.title}`));
      process.exit(1);
    }

    const contextSlug = slugify(match.context || 'default') || 'default';
    const sliceFolder = sliceFolderName(match.title);
    console.log('\nRequested slice:');
    console.log(`  Title:  ${match.title}`);
    console.log(`  ID:     ${match.id}`);
    console.log(`  Status: ${match.status}`);
    console.log(`  Folder: ${relative(cwd, join(SLICES_DIR, contextSlug, sliceFolder, 'slice.json'))}`);
  }
}
