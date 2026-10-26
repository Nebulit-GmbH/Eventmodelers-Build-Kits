// One walkthrough of everything that is only local: a summary page, then one step per slice that differs from the board (new or changed).
// Deterministic — no agent: it reads the same differences `prototype sync --dry-run` lists (slice.json against its baseline, edited screens)
// and words them. Same shape as the modeling kit's `/walkthrough` impact mode (status, changes, elements per step), so the snippet can move
// into the player later. Read-only: nothing is synced, rebuilt or written.
import { pending } from './sync.js';
import { loadSlices, paths, readBaseline, same } from './state.js';
import { screenOps } from './screens-sync.js';

const KINDS = ['screens', 'commands', 'events', 'readmodels', 'processors'];
const TYPE = { screens: 'SCREEN', commands: 'COMMAND', events: 'EVENT', readmodels: 'READMODEL', processors: 'AUTOMATION' };

/** "+email ~name -age" for a field list, as lines: "add field email", "change field name", "remove field age". */
function fieldChanges(label, was, now) {
  const names = (v) => new Map((v || []).map((f) => [f.name, f]));
  const before = names(was), after = names(now);
  const out = [];
  for (const [n, f] of after) {
    if (!before.has(n)) out.push(`${label}: add field ${n}${f.type ? ` (${f.type})` : ''}`);
    else if (!same(before.get(n), f)) out.push(`${label}: change field ${n}`);
  }
  for (const n of before.keys()) if (!after.has(n)) out.push(`${label}: remove field ${n}`);
  return out.length ? out : [`${label}: fields reordered`];
}

const opLine = (op) => {
  const label = `${op.type} ${op.title}`;
  return op.attr === 'description' ? [`${label}: description changed`] : fieldChanges(label, op.was, op.value);
};

/** { summary, counts, steps } — the steps in timeline order; empty when nothing is local-only. */
export function buildWalkthrough(cwd) {
  const p = paths(cwd);
  const screens = new Map(screenOps(cwd).map((s) => [s.nodeId, s]));
  const byId = new Map(pending(cwd).map((x) => [x.id, x]));
  const steps = [];
  for (const { id, slice } of loadSlices(p)) {
    const diff = byId.get(id);
    const screenIds = (slice.screens || []).map((s) => s.linkedId || s.id);
    const edited = screenIds.filter((sid) => screens.has(sid));
    if (!diff && !edited.length) continue;
    const isNew = !readBaseline(p, id);
    const elements = KINDS.flatMap((k) => (slice[k] || []).map((e) => ({ type: TYPE[k], title: e.title, fields: (e.fields || []).map((f) => f.name) })));
    const changes = [
      ...(diff ? diff.ops.flatMap(opLine) : []),
      ...edited.map((sid) => `SCREEN ${screens.get(sid).title}: page design edited`),
    ];
    steps.push({
      title: slice.title || id,
      sliceId: id,
      status: isNew ? 'new' : 'changed',
      description: isNew
        ? `Not on the board yet: ${elements.map((e) => `${e.type.toLowerCase()} ${e.title}`).join(', ') || 'an empty slice'}.`
        : `${changes.length + (diff ? diff.notSynced.length : 0)} local change${changes.length + (diff ? diff.notSynced.length : 0) === 1 ? '' : 's'} on this slice.`,
      changes: isNew ? [] : changes,
      // what sync would skip — the part that has to be carried over by hand, so worth the closest look
      notSynced: diff ? diff.notSynced : [],
      elements: isNew ? elements : undefined,
    });
  }
  const counts = { new: steps.filter((s) => s.status === 'new').length, changed: steps.filter((s) => s.status === 'changed').length, notSynced: steps.reduce((n, s) => n + s.notSynced.length, 0) };
  const summary = steps.length
    ? `${steps.length} slice${steps.length === 1 ? '' : 's'} differ from the board: ${counts.changed} changed, ${counts.new} new.${counts.notSynced ? ` ${counts.notSynced} change${counts.notSynced === 1 ? '' : 's'} cannot be synced and would have to be carried over by hand.` : ' Everything can be synced.'}`
    : 'Nothing is local-only: the model matches the board.';
  return { title: 'Local changes', summary, counts, steps };
}

/** The same, as plain text — what `prototype walkthrough` prints. */
export function walkthroughText(w) {
  const lines = [w.summary, ''];
  w.steps.forEach((s, i) => {
    lines.push(`${i + 1}. [${s.status}] ${s.title}`, `   ${s.description}`);
    for (const c of s.changes) lines.push(`   • ${c}`);
    for (const c of s.notSynced) lines.push(`   ⚠ not synced: ${c}`);
    if (s.elements) for (const e of s.elements) lines.push(`   + ${e.type} ${e.title}${e.fields.length ? ` (${e.fields.join(', ')})` : ''}`);
  });
  return lines.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** A self-contained page: the summary, then one card per slice. */
export function walkthroughHtml(w) {
  const li = (items, cls = '') => (items.length ? `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
  const card = (s, i) => `<section class="step ${s.status}">
  <h2><span class="n">${i + 1}</span>${esc(s.title)}<span class="chip">${s.status}</span></h2>
  <p>${esc(s.description)}</p>
  ${li(s.changes)}
  ${s.elements ? li(s.elements.map((e) => `${e.type} ${e.title}${e.fields.length ? ` — ${e.fields.join(', ')}` : ''}`), 'els') : ''}
  ${s.notSynced.length ? `<h3>Not synced</h3>${li(s.notSynced, 'warn')}` : ''}
</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local changes</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;color:#1a1a1a;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e8e8e8;background:#161616}.step{border-color:#333}}
h1{margin:0 0 .25rem}.lead{font-size:1.05rem;margin:0 0 1.5rem}
.step{border:1px solid #ddd;border-left:4px solid #3b82f6;border-radius:6px;padding:.75rem 1rem;margin:0 0 1rem}
.step.new{border-left-color:#22a559}
h2{font-size:1.05rem;margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem}
h3{font-size:.85rem;margin:.75rem 0 0;color:#b45309}
.n{opacity:.5}.chip{margin-left:auto;font-size:.75rem;padding:1px 8px;border-radius:99px;background:#3b82f622}
.new .chip{background:#22a55922}.warn li{color:#b45309}.els{opacity:.85}
ul{margin:.4rem 0 0;padding-left:1.2rem}
</style></head><body>
<h1>${esc(w.title)}</h1><p class="lead">${esc(w.summary)}</p>
${w.studio ? `<p><a href="${esc(w.studio)}" target="_blank" rel="noopener noreferrer">Open the board in EM Studio ↗</a></p>` : ''}
${w.steps.map(card).join('\n')}
</body></html>`;
}
