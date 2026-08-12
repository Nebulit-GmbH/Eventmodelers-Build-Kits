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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the server's exporter registry (backend/src/slices/change/slicedata/exporters/
// ExporterRegistry.ts) — json is the canonical shape (drives the full .slices/ folder
// structure below); every other format is a transform of it and gets dumped as a single
// file instead, so its extension reflects the transform's actual output, not its name
// (textual is JSON-wrapped; emlang/esdm are YAML documents; toon is its own thing).
const SUPPORTED_FORMATS = ['json', 'yaml', 'textual', 'toon', 'emlang', 'esdm'];
const FORMAT_EXTENSIONS = { yaml: 'yaml', textual: 'json', toon: 'toon', emlang: 'yaml', esdm: 'yaml' };

// `--context` accepts any of: a MODEL_CONTEXT name or id, or a timeline (CHAPTER) name or id.
// /slicedata's contextId/contextName params now both resolve against MODEL_CONTEXT nodes first,
// then timelines (id matched exactly, name case-insensitively) — including a timeline with no
// assigned/connected context, which is its own context, not an error (same rule the canvas
// frontend's resolveContext applies: "an unassigned timeline is its own context"). So there's
// nothing left to resolve here — just route a uuid-shaped input to contextId, everything else to
// contextName, and let the server do the actual lookup.

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

  // assertBoardAccess (the guard every one of these routes runs behind) only ever
  // answers 401/403 for credential/board-access problems — a 404 here always means
  // "the thing at this path doesn't exist" (e.g. no MODEL_CONTEXT with that name),
  // never "board not found". Only 401/403 are credential problems worth the
  // reconfigure-and-retry dance in cli.js; 404 gets reported and the process exits,
  // same as any other non-auth error.
  async function fetchResponse(url, what, { allow404 = false } = {}) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      console.error(`❌ Request failed (${what}): ${err.message}`);
      process.exit(1);
    }
    if (res.status === 401) throw new FetchAuthError(401, `${what}: invalid or expired token`);
    if (res.status === 403) throw new FetchAuthError(403, `${what}: token's organization does not match this board`);
    if (res.status === 404) {
      if (allow404) return null;
      const body = await res.json().catch(() => null);
      console.error(`❌ ${what}: ${body?.error || 'not found'}`);
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`❌ ${what}: HTTP ${res.status}`);
      process.exit(1);
    }
    return res;
  }

  async function fetchJson(url, what, options) {
    const res = await fetchResponse(url, what, options);
    return res ? res.json() : res;
  }

  // Non-json formats aren't a {slices: [...]} payload — just the exporter's raw output
  // (a YAML doc, a TOON encoding, ...) — so it's written straight to disk, not parsed.
  async function fetchText(url, what, options) {
    const res = await fetchResponse(url, what, options);
    return res ? res.text() : res;
  }

  // Falls back to cwd when no kit is installed — fetch doesn't need kit-specific
  // files, just somewhere to write .slices/.
  const SLICES_DIR = join(kitDir || cwd, '.slices');

  const contextInput = opts.context;
  const format = (opts.format || 'json').toLowerCase();
  if (!SUPPORTED_FORMATS.includes(format)) {
    console.error(`❌ Unsupported format "${format}". Supported: ${SUPPORTED_FORMATS.join(', ')}`);
    process.exit(1);
  }
  // --slice-id/--slice-title/--spec-kitty all depend on the parsed {slices: [...]} list
  // that only the json format produces — fail fast instead of silently ignoring them.
  if (format !== 'json' && (opts.sliceId || opts.sliceTitle || opts.specKitty)) {
    console.error('❌ --slice-id, --slice-title, and --spec-kitty require --format json (the default).');
    process.exit(1);
  }

  console.log(`▶ Fetching context "${contextInput}" from ${baseUrl} (board ${cfg.boardId})...`);

  // /slicedata (buildSliceData) is per-context and returns full slice detail —
  // commands/events/readmodels/screens/processors/specifications/comments. It resolves
  // contextId/contextName against MODEL_CONTEXT nodes first, then timelines, entirely
  // server-side — including the self-context fallback for a timeline with no assigned
  // context — so all that's left here is routing a uuid-shaped input to contextId and
  // everything else to contextName. A 404 (no match) surfaces via fetchJson below.
  const contextQuery = UUID_RE.test(contextInput)
    ? `contextId=${encodeURIComponent(contextInput)}`
    : `contextName=${encodeURIComponent(contextInput)}`;
  const url = `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/slicedata?${contextQuery}&format=${format}`;

  // Only json builds the full .slices/<context>/<slice>/slice.json folder structure —
  // every other format has no guaranteed {slices: [...]} shape to walk (it's the
  // exporter's raw output: a YAML doc, a TOON encoding, ...), so it's just dumped
  // as a single file. The resolved context name isn't known without parsing JSON,
  // so the folder is slugified from the raw --context input instead.
  if (format !== 'json') {
    const body = await fetchText(url, `slicedata?${contextQuery}&format=${format}`);
    const contextSlug = slugify(contextInput) || 'default';
    const baseFolder = join(SLICES_DIR, contextSlug);
    mkdirSync(baseFolder, { recursive: true });
    const outFile = join(baseFolder, `slicedata.${FORMAT_EXTENSIONS[format]}`);
    writeFileSync(outFile, body);
    console.log(`✅ Fetched context "${contextInput}" as ${format} → ${relative(cwd, outFile)}`);
    return;
  }

  const payload = await fetchJson(url, `slicedata?${contextQuery}&format=${format}`);
  const { slices: allSlices } = payload;
  const displayContext = allSlices[0]?.context || contextInput;

  if (allSlices.length) {
    // Mirrors code-export.mjs's /api/generate: a raw per-context payload dump at
    // .slices/<context>/config.json, alongside the per-slice output below — kept
    // for parity with `listen` even though nothing in this repo reads it back.
    const contextSlug = slugify(displayContext || 'default') || 'default';
    const baseFolder = join(SLICES_DIR, contextSlug);
    mkdirSync(baseFolder, { recursive: true });
    writeFileSync(join(baseFolder, 'config.json'), JSON.stringify(payload, null, 2));
  }

  if (!allSlices.length) {
    console.log(`ℹ️  No slices found in context "${displayContext}".`);
    return;
  }

  for (const slice of allSlices) {
    // buildSliceData names this field `context`, not `contextName` (that's the
    // /slicedata/slices summary endpoint's field) — read the one this endpoint sends.
    const contextName = slice.context || displayContext || 'default';
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

  // Persist the *resolved* context name (not the raw --context input, which may
  // have been a timeline name/id or context id) so the next run's assigned-context
  // fallback, and shared/build-kit/lib/ralph.js's readCurrentContext, see a real name.
  writeFileSync(join(SLICES_DIR, 'current_context.json'), JSON.stringify({ name: displayContext }, null, 2));

  console.log(`✅ Fetched ${allSlices.length} slice${allSlices.length === 1 ? '' : 's'} from context "${displayContext}" → ${relative(cwd, SLICES_DIR)}/`);

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
