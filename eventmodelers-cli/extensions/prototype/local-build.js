// The local counterpart of prototype.mjs's `status` and `assemble` (modeling-kit's `prototype` skill): same page, same
// slice blocks and hashes-per-block mechanism, but the data comes from .slices/ instead of the board and
// nothing is uploaded. The template and runtime are the skill's own — read from the package, never copied.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScreens, loadSlices, paths, readJson, sliceHash, writeJson } from './state.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SKILL_SRC = join(PKG, 'stacks', 'modeling-kit', 'templates', '.claude', 'skills', 'prototype');
const ASSETS = join(SKILL_SRC, 'assets');

const CSS = {
  bulma: '<link rel="stylesheet" href="/vendor/bulma-0.9.4.css" />',
  bootstrap: '<link rel="stylesheet" href="/vendor/bootstrap-5.3.3.css" />',
  tailwind: '<script src="/vendor/tailwind-play-3.4.16.js"></script>',
  none: '',
};

/** The slice blocks in an assembled page: [{ id, title, hash, block }]. */
export function blocksIn(html) {
  const found = [];
  const re = /<script\b([^>]*\bdata-em-slice="[^"]*"[^>]*)>[\s\S]*?<\/script>/g;
  for (let m; (m = re.exec(html)); ) {
    const attr = (name) => ((m[1].match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '');
    found.push({ id: attr('data-em-slice'), title: attr('data-em-title'), hash: attr('data-em-hash'), block: m[0] });
  }
  return found;
}

/** Which slices need a block: compares the model on disk with the blocks in the current page. Touches nothing. */
export function plan(cwd) {
  const p = paths(cwd);
  const state = readJson(p.state, {});
  const screens = loadScreens(p);
  const byId = Object.fromEntries((existsSync(p.page) ? blocksIn(readFileSync(p.page, 'utf8')) : []).map((b) => [b.id, b]));
  const votes = {};
  const slices = loadSlices(p).map(({ slice }, order) => {
    for (const s of (slice.screens || []).map((x) => screens[x.linkedId || x.id])) {
      if (s && s.pages) {
        const f = (s.cssFrameworks || [])[0] || 'bulma';
        votes[f] = (votes[f] || 0) + 1;
      }
    }
    const hash = sliceHash(slice, screens);
    const before = byId[slice.id];
    return {
      id: slice.id, title: slice.title, sliceType: slice.sliceType, chapter: slice.chapter, order: order + 1, hash,
      state: !before ? 'new' : before.hash === hash ? 'unchanged' : 'changed',
    };
  });
  const current = new Set(slices.map((s) => s.id));
  const removed = Object.values(byId).filter((b) => !current.has(b.id)).map(({ id, title }) => ({ id, title }));
  const cssFramework = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'bulma';
  const context = state.context || '';
  return { context, contextId: context, baseline: Object.keys(byId).length ? 'local' : 'none', cssFramework, mixedFrameworks: Object.keys(votes).length > 1, slices, removed, byId };
}

/** `plan`, plus the work folder the agent writes blocks into: the existing blocks copied (changed ones to patch), status.json written. */
export function status(cwd) {
  const p = paths(cwd);
  const { byId, ...report } = plan(cwd);
  mkdirSync(p.blocks, { recursive: true });
  // Every slice that already has a block keeps it in the work folder: unchanged ones as the page has them, changed ones as the previous
  // version — to be patched in place (Edit) and given the new hash, not rewritten from nothing. Work already done on a changed
  // slice's block is never overwritten by running `status` again. Only new slices start empty.
  for (const s of report.slices) {
    const file = join(p.blocks, `${s.id}.html`);
    if (byId[s.id] && (s.state === 'unchanged' || !existsSync(file))) writeFileSync(file, byId[s.id].block + '\n');
  }
  writeJson(join(p.work, 'status.json'), report);
  return report;
}

/** Writes .prototype/index.html. Throws with every problem when a flagged slice has no valid block. */
export function assemble(cwd) {
  const p = paths(cwd);
  // The blocks are the slices' source files: assembling without a fresh status first would compare against nothing, so take one now.
  const report = readJson(join(p.work, 'status.json')) || status(cwd);
  const problems = [];
  const blocks = report.slices.map((s) => {
    const file = join(p.blocks, `${s.id}.html`);
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
  if (problems.length) throw new Error('Not assembled:\n  ' + problems.join('\n  '));
  const escape = (s) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
  const html = readFileSync(join(ASSETS, 'index.template.html'), 'utf8')
    .replaceAll('{{CONTEXT}}', escape(report.context))
    .replace('<!-- @@CSS_FRAMEWORK@@', `${CSS[report.cssFramework] ?? CSS.bulma}\n  <!-- @@CSS_FRAMEWORK@@`)
    .replace('/* @@RUNTIME@@ */', () => readFileSync(join(ASSETS, 'runtime.js'), 'utf8'))
    .replace(/(     ={20,} -->\n)(\n<!-- Load:)/, (_, end, load) => `${end}\n${blocks.join('\n\n')}\n${load}`);
  writeFileSync(p.page, html);
  return { blocks: blocks.length, page: p.page };
}

/** The libraries the page loads from /vendor/ — downloaded from the app once, served locally. */
export const VENDOR_FILES = [
  'react-18.3.1.production.min.js', 'react-dom-18.3.1.production.min.js', 'babel-standalone-7.24.7.min.js',
  'bulma-0.9.4.css', 'bootstrap-5.3.3.css', 'tailwind-play-3.4.16.js',
];
