#!/usr/bin/env node
/*
 * Slice-by-slice bookkeeping for the `prototype` skill — runs where the agent runs, never in the page.
 *
 *   EM_TOKEN=… node prototype.mjs status   --base <BASE_URL> --org <ORG_ID> --board <BOARD_ID> --context <name> --out <dir>
 *   node prototype.mjs assemble --out <dir>
 *   EM_TOKEN=… node prototype.mjs upload   --base <BASE_URL> --org <ORG_ID> --board <BOARD_ID> --out <dir>
 *
 * status   fetches the context, hashes every slice (its elements, scenarios and screens), compares the
 *          hashes with the data-em-hash of the blocks in the prototype the platform stores (else the local
 *          <out>/index.html — so a fresh session or folder still rebuilds only what changed), copies the kept blocks to
 *          <out>/.work/slices/<id>.html and writes <out>/.work/status.json. Prints which slices are new,
 *          changed, unchanged or removed. Only new and changed slices need a new block.
 * assemble writes <out>/index.html from the template, runtime.js and every block in .work/slices that
 *          belongs to a current slice, in timeline order.
 * upload   sends <out>/index.html to the platform (POST .../prototype/<context id>), which sanitizes, gzips
 *          and stores it per effective context. Prints what the sanitizer removed — nothing, normally.
 *
 * The token comes from EM_TOKEN or EVENTMODELERS_TOKEN — never pass it on the command line.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!args.out) fail('--out <dir> is required');
const WORK = join(args.out, '.work');
const BLOCKS = join(WORK, 'slices');
const PAGE = join(args.out, 'index.html');

// Element/scenario data that changes without the slice's meaning changing — left out of the hash.
const VOLATILE = new Set(['status', 'assignee', 'ticketNumber', 'comments']);

/** Stable JSON: sorted keys, volatile keys and the random id of a SPEC_ERROR step dropped. */
function canonical(value) {
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

const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);

/** The slice blocks in an assembled page: [{ id, title, hash, block }]. */
function blocksIn(html) {
  const found = [];
  const re = /<script\b([^>]*\bdata-em-slice="[^"]*"[^>]*)>[\s\S]*?<\/script>/g;
  for (let m; (m = re.exec(html)); ) {
    const attr = (name) => ((m[1].match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '');
    found.push({ id: attr('data-em-slice'), title: attr('data-em-title'), hash: attr('data-em-hash'), block: m[0] });
  }
  return found;
}

/** The board API base and headers, from --base/--org/--board and the token in the environment. */
function boardApi(required) {
  for (const k of ['base', 'org', 'board', ...required]) if (!args[k]) fail(`--${k} is required`);
  const token = process.env.EM_TOKEN || process.env.EVENTMODELERS_TOKEN;
  if (!token) fail('Set EM_TOKEN (or EVENTMODELERS_TOKEN) to the board token');
  const api = `${args.base.replace(/\/$/, '')}/api/org/${args.org}/boards/${args.board}`;
  return { api, headers: { 'x-token': token, 'x-user-id': 'prototype-skill', 'content-type': 'application/json' } };
}

/** The id of the MODEL_CONTEXT or timeline named `name` (contexts first) — the platform keys a prototype by it. */
async function contextIdOf(get, name) {
  const lower = name.toLowerCase();
  for (const type of ['MODEL_CONTEXT', 'CHAPTER']) {
    const nodes = await get(`/nodes?type=${type}&projection=line`);
    const match = (Array.isArray(nodes) ? nodes : nodes.nodes || []).find((n) => (n.title || '').toLowerCase() === lower);
    if (match) return match.id;
  }
  fail(`No model context or timeline named "${name}" on this board`);
}

async function status() {
  const { api, headers } = boardApi(['context']);
  const get = async (path, { allow404 = false } = {}) => {
    const res = await fetch(api + path, { headers });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) fail(`GET ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  // --context is a name, or the id of a MODEL_CONTEXT / timeline (a chapter without a name has only that).
  const contextIsId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.context);
  const ctx = `${contextIsId ? 'contextId' : 'contextName'}=${encodeURIComponent(args.context)}`;
  const [fields, specs] = await Promise.all([
    get(`/slicedata?${ctx}&projection=fields&format=json`),
    get(`/slicedata?${ctx}&projection=specs&format=json`),
  ]);
  const specsById = Object.fromEntries((specs.slices || []).map((s) => [s.id, s]));

  // Screens: the slice's own node (a copy can carry its own marks), with its pages or its sketch.
  const screenIds = [...new Set((fields.slices || []).flatMap((s) => (s.screens || []).map((x) => x.linkedId || x.id)))];
  const screens = {};
  if (screenIds.length) {
    const res = await fetch(`${api}/nodes/query`, { method: 'POST', headers, body: JSON.stringify({ ids: screenIds }) });
    if (!res.ok) fail(`POST /nodes/query → ${res.status} ${await res.text()}`);
    for (const node of await res.json()) {
      const meta = typeof node.meta === 'string' ? JSON.parse(node.meta) : node.meta || {};
      const frameworks = meta.cssFrameworks || node.cssFrameworks || (node.data && node.data.cssFrameworks) || [];
      screens[node.id] = { type: node.type || meta.type, pages: meta.pages || null, marks: meta.marks || null, cssFrameworks: frameworks };
    }
    await Promise.all(
      Object.entries(screens)
        .filter(([, s]) => !s.pages)
        .map(async ([id, s]) => {
          s.sketch = await get(`/images/${id}/description`, { allow404: true });
        }),
    );
  }

  // The baseline whose blocks can be kept: the page the platform stores for this context — what everyone
  // plays, and there in any session or folder (its sanitizer leaves the blocks byte for byte) — else a
  // local one, from an earlier run whose upload failed. Neither: every slice is new.
  const contextId = contextIsId ? args.context : await contextIdOf(get, args.context);
  const storedRes = await fetch(`${api}/prototype/${encodeURIComponent(contextId)}`, { headers });
  if (!storedRes.ok && storedRes.status !== 404) fail(`GET /prototype/${contextId} → ${storedRes.status} ${await storedRes.text()}`);
  const stored = storedRes.ok ? await storedRes.text() : null;
  const baseline = stored ? 'platform' : existsSync(PAGE) ? 'local' : 'none';
  const existing = baseline === 'none' ? [] : blocksIn(stored ?? readFileSync(PAGE, 'utf8'));
  const byId = Object.fromEntries(existing.map((b) => [b.id, b]));
  rmSync(BLOCKS, { recursive: true, force: true });
  mkdirSync(BLOCKS, { recursive: true });

  const frameworkVotes = {};
  const slices = (fields.slices || []).map((slice, order) => {
    const own = (slice.screens || []).map((x) => screens[x.linkedId || x.id] || null);
    for (const s of own) if (s && s.pages) frameworkVotes[(s.cssFrameworks || [])[0] || 'bulma'] = (frameworkVotes[(s.cssFrameworks || [])[0] || 'bulma'] || 0) + 1;
    const h = hash({ slice, specs: specsById[slice.id] || null, screens: own });
    const before = byId[slice.id];
    if (before && before.hash === h) writeFileSync(join(BLOCKS, `${slice.id}.html`), before.block + '\n');
    return {
      id: slice.id,
      title: slice.title,
      sliceType: slice.sliceType,
      chapter: slice.chapter,
      order: order + 1,
      hash: h,
      state: !before ? 'new' : before.hash === h ? 'unchanged' : 'changed',
    };
  });
  const current = new Set(slices.map((s) => s.id));
  const removed = existing.filter((b) => !current.has(b.id)).map(({ id, title }) => ({ id, title }));
  const cssFramework = Object.entries(frameworkVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'bulma';

  // Asked for by id (a chapter whose context has no name), the page still shows the chapter's own name — never the id.
  let contextName = fields.contextName || '';
  if (!contextName && contextIsId) {
    const res = await fetch(`${api}/nodes/query`, { method: 'POST', headers, body: JSON.stringify({ ids: [contextId] }) });
    const node = res.ok ? (await res.json())[0] : null;
    contextName = (node && (node.title || (node.data && node.data.title))) || '';
  }
  if (!contextName && !contextIsId) contextName = args.context;

  const report = { context: contextName, contextId, baseline, cssFramework, mixedFrameworks: Object.keys(frameworkVotes).length > 1, slices, removed };
  writeFileSync(join(WORK, 'status.json'), JSON.stringify(report, null, 2));
  for (const s of slices) console.log(`${s.state.padEnd(9)} ${s.hash}  ${s.id}  ${s.title}`);
  for (const r of removed) console.log(`removed   ${''.padEnd(16)}  ${r.id}  ${r.title}`);
  const todo = slices.filter((s) => s.state !== 'unchanged').length;
  console.log(`\n${todo} of ${slices.length} slices to build, ${removed.length} removed (${{ platform: 'compared with the stored prototype', local: 'compared with the local page', none: 'no prototype yet' }[baseline]}) — see ${join(WORK, 'status.json')}`);
  console.log(`Even with 0 slices to build, this run still writes ${join(WORK, 'questions.json')} (SKILL.md Step 5b) and uploads — "nothing changed" does not skip the questions.`);
}

const CSS = {
  bulma: '<link rel="stylesheet" href="/vendor/bulma-0.9.4.css" />',
  bootstrap: '<link rel="stylesheet" href="/vendor/bootstrap-5.3.3.css" />',
  tailwind: '<script src="/vendor/tailwind-play-3.4.16.js"></script>',
  none: '',
};

function assemble() {
  const report = JSON.parse(readFileSync(join(WORK, 'status.json'), 'utf8'));
  const problems = [];
  const blocks = report.slices.map((s) => {
    const file = join(BLOCKS, `${s.id}.html`);
    if (!existsSync(file)) {
      problems.push(`missing block for ${s.state} slice "${s.title}" (${file})`);
      return '';
    }
    const block = readFileSync(file, 'utf8').trim();
    const [found] = blocksIn(block);
    if (!found || found.id !== s.id) problems.push(`${file}: not a slice block for ${s.id}`);
    else if (found.hash !== s.hash) problems.push(`${file}: data-em-hash is ${found.hash}, the slice's hash is ${s.hash}`);
    if ((block.match(/<\/script/gi) || []).length !== 1) problems.push(`${file}: a closing script tag appears inside the block`);
    return block;
  });
  const stray = readdirSync(BLOCKS).filter((f) => !report.slices.some((s) => `${s.id}.html` === f));
  if (problems.length) fail('Not assembled:\n  ' + problems.join('\n  '));

  const escape = (s) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
  // The questions are written afresh on every run (.work/questions.json) and never carried over from the stored page: a page without the file asks none.
  const questionsFile = join(WORK, 'questions.json');
  let questions = [];
  if (existsSync(questionsFile)) {
    try { questions = JSON.parse(readFileSync(questionsFile, 'utf8')); } catch (e) { fail(`${questionsFile} is not valid JSON: ${e.message}`); }
    if (!Array.isArray(questions)) fail(`${questionsFile} must be an array of { id, screen, ref, category, text }`);
    const ids = new Set();
    const bad = questions.map((q, i) => (!q || ![q.id, q.screen, q.ref, q.text].every((v) => typeof v === 'string' && v.trim()) ? `#${i}: needs id, screen, ref and text` : ids.has(q.id) ? `#${i}: duplicate id ${q.id}` : (ids.add(q.id), ''))).filter(Boolean);
    const blockText = readdirSync(BLOCKS).map((f) => readFileSync(join(BLOCKS, f), 'utf8')).join('\n');
    questions.forEach((q, i) => {
      if (!q || !q.setup) return;
      if (typeof q.setup !== 'object' || (!q.setup.spec && !Array.isArray(q.setup.given))) bad.push(`#${i}: setup needs a spec (title or id of a scenario) or a given list`);
      else if (q.setup.spec && !blockText.includes(q.setup.spec)) bad.push(`#${i}: setup.spec "${q.setup.spec}" is no scenario of the prototype`);
    });
    if (bad.length) fail('Not assembled — questions.json:\n  ' + bad.join('\n  '));
  }
  const questionsTag = questions.length ? `<script type="text/plain" data-em-questions>${JSON.stringify(questions).replace(/</g, '\\u003c')}</script>` : '';
  const html = readFileSync(join(ASSETS, 'index.template.html'), 'utf8')
    .replaceAll('{{CONTEXT}}', escape(report.context))
    .replace('<!-- @@CSS_FRAMEWORK@@', `${CSS[report.cssFramework] ?? CSS.bulma}\n  <!-- @@CSS_FRAMEWORK@@`)
    .replace('/* @@RUNTIME@@ */', () => readFileSync(join(ASSETS, 'runtime.js'), 'utf8'))
    .replace(/(     ={20,} -->\n)(\n<!-- Load:)/, (_, end, load) => `${end}\n${blocks.join('\n\n')}\n${questionsTag}\n${load}`);
  writeFileSync(PAGE, html);
  console.log(`Wrote ${PAGE} — ${blocks.length} slice blocks, ${questions.length} question(s)${stray.length ? `, ignored ${stray.length} stray file(s): ${stray.join(', ')}` : ''}`);
}

async function upload() {
  const { api, headers } = boardApi([]);
  const report = JSON.parse(readFileSync(join(WORK, 'status.json'), 'utf8'));
  if (!existsSync(PAGE)) fail(`${PAGE} does not exist — run assemble first`);
  const res = await fetch(`${api}/prototype/${encodeURIComponent(report.contextId)}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
    body: readFileSync(PAGE),
  });
  const text = await res.text();
  if (!res.ok) fail(`Upload failed → ${res.status} ${text}`);
  const stored = JSON.parse(text);
  console.log(`Stored ${stored.contextName} at ${stored.path} (${stored.bytes} bytes, ${stored.gzippedBytes} gzipped)`);
  if (stored.removed.length) console.log(`The platform removed ${stored.removed.length} thing(s) from the page:\n  ${stored.removed.join('\n  ')}`);
}

if (command === 'status') await status();
else if (command === 'assemble') assemble();
else if (command === 'upload') await upload();
else fail('usage: node prototype.mjs status|assemble|upload --out <dir> [...]');
