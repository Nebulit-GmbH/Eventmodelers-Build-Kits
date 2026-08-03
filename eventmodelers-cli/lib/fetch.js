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

// Pulls full slice detail from every context on a board and writes it into
// .slices/, mirroring the layout code-export.mjs's /api/generate handler produces
// (minus screen images, which only ever arrive via that push-based listener).
//
// { cwd, kitDir, cfg: { token, organizationId, boardId, baseUrl }, opts: { sliceId?, sliceTitle? } }
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

  console.log(`▶ Fetching slices from ${baseUrl} (board ${cfg.boardId})...`);

  // No dedicated "list contexts" endpoint — MODEL_CONTEXT nodes are the contexts,
  // same as how the connect skill lists CHAPTER nodes for its health check.
  const contextNodes = await fetchJson(
    `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes?type=MODEL_CONTEXT`,
    'nodes?type=MODEL_CONTEXT',
  );
  if (!contextNodes?.length) {
    console.log('ℹ️  No contexts found on this board.');
    return;
  }

  // /slicedata (buildSliceData) is per-context and returns full slice detail —
  // commands/events/readmodels/screens/processors/specifications/comments — unlike
  // the lightweight /slicedata/slices summary. There's no "all contexts in one
  // call" variant, so fetch each context's full data and merge client-side.
  const allSlices = [];
  for (const node of contextNodes) {
    const contextName = node.meta?.title ?? node.node?.data?.title ?? '';
    // contextId is the normal path (we already have the node id); contextName is
    // the fallback the endpoint itself supports when an id can't be resolved.
    const contextQuery = node.id ? `contextId=${encodeURIComponent(node.id)}` : `contextName=${encodeURIComponent(contextName)}`;
    const { slices } = await fetchJson(
      `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata?${contextQuery}`,
      `slicedata?${contextQuery}`,
    );
    allSlices.push(...slices);
  }

  if (!allSlices.length) {
    console.log('ℹ️  No slices found on this board.');
    return;
  }

  const SLICES_DIR = join(kitDir, '.slices');
  const contextNames = new Set();

  for (const slice of allSlices) {
    // buildSliceData names this field `context`, not `contextName` (that's the
    // /slicedata/slices summary endpoint's field) — read the one this endpoint sends.
    const contextName = slice.context || 'default';
    contextNames.add(contextName);
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

  // A single shared current_context.json only makes sense when everything fetched
  // belongs to one context — with several, any one choice would be arbitrary, so
  // leave whatever `listen`/a prior fetch already wrote there untouched.
  if (contextNames.size === 1) {
    writeFileSync(join(SLICES_DIR, 'current_context.json'), JSON.stringify({ name: [...contextNames][0] }, null, 2));
  }

  console.log(`✅ Fetched ${allSlices.length} slice${allSlices.length === 1 ? '' : 's'} across ${contextNames.size} context${contextNames.size === 1 ? '' : 's'} → ${relative(cwd, SLICES_DIR)}/`);

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
