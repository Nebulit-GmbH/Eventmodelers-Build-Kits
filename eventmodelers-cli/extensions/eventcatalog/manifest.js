// What the last export wrote, so `export --check` can tell what moved in the model since — and say what.
// Only the parts EM-Studio owns are recorded and compared (name, summary from the description, fields,
// flow steps). Everything else in a catalog resource belongs to the catalog and is never looked at.
// Kept in the catalog, per context: label ("events/OrderPlaced") → snapshot.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const FILE = join('.eventmodelers', 'eventcatalog-export.json');

const field = (f) => ({
  name: f.name,
  type: f.type ?? 'String',
  cardinality: f.cardinality ?? 'Single',
  optional: Boolean(f.optional),
  ...(f.example ? { example: f.example } : {}),
  ...(f.subfields?.length ? { subfields: f.subfields.map(field) } : {}),
});

// The summary is only EM-Studio's when the model has a description; otherwise null = "not ours".
const message = (n) => ({ name: n.name, summary: n.description || null, keys: [...n.elementIds].sort(), fields: n.fields.map(field) });

export function snapshotsOf(model) {
  const out = {};
  for (const [folder, list] of [['events', model.events], ['commands', model.commands], ['queries', model.queries]]) {
    for (const n of list) out[`${folder}/${n.id}`] = message(n);
  }
  for (const flow of model.flows) {
    out[`flows/${flow.id}`] = {
      name: flow.name,
      steps: flow.steps.map((s) => ({
        id: s.id, title: s.node.name, keys: [...s.node.elementIds].sort(),
        // next carries the target's keys too, so a renamed target is still the same target
        next: s.next.map((nid) => { const t = flow.steps.find((x) => x.id === nid).node; return { id: nid, keys: [...t.elementIds].sort() }; }),
      })),
    };
  }
  out[`domains/${model.domain.id}`] = { name: model.domain.name };
  return out;
}

export function readManifest(catalogDir) {
  const path = join(catalogDir, FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {}; // unreadable → treated as "nothing exported yet"
  }
}

// Merges `snapshots` into the context's entry.
export function updateManifest(catalogDir, context, snapshots) {
  const manifest = readManifest(catalogDir);
  manifest[context] = { resources: { ...(manifest[context]?.resources ?? {}), ...snapshots }, exportedAt: new Date().toISOString() };
  const path = join(catalogDir, FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const quote = (s) => (s === null || s === undefined ? '(none)' : `"${s}"`);

function describeFields(before, after, prefix = '') {
  const lines = [];
  const was = new Map(before.map((f) => [f.name, f]));
  const now = new Map(after.map((f) => [f.name, f]));
  for (const [name, f] of now) {
    const old = was.get(name);
    if (!old) { lines.push(`+ field ${prefix}${name} (${f.type}${f.cardinality === 'Single' ? '' : ` ${f.cardinality}`}${f.optional ? ', optional' : ''})`); continue; }
    const parts = [];
    if (old.type !== f.type) parts.push(`type ${old.type} → ${f.type}`);
    if (old.cardinality !== f.cardinality) parts.push(`cardinality ${old.cardinality} → ${f.cardinality}`);
    if (old.optional !== f.optional) parts.push(f.optional ? 'now optional' : 'now required');
    if (old.example !== f.example) parts.push(`example ${quote(old.example)} → ${quote(f.example)}`);
    if (parts.length) lines.push(`~ field ${prefix}${name}: ${parts.join(', ')}`);
    if (old.subfields || f.subfields) lines.push(...describeFields(old.subfields ?? [], f.subfields ?? [], `${prefix}${name}.`));
  }
  for (const name of was.keys()) if (!now.has(name)) lines.push(`- field ${prefix}${name}`);
  return lines;
}

// Two entries are the same element when they share a board id; entries without ids (stubs) match by id.
const matches = (a, b) => (a.keys?.length && b.keys?.length ? a.keys.some((k) => b.keys.includes(k)) : a.id === b.id);
const nextIds = (list) => list.map((n) => n.id).join(', ') || '(none)';

function describeSteps(before, after) {
  const lines = [];
  const used = new Set();
  for (const s of after) {
    const old = before.find((b) => !used.has(b) && matches(b, s));
    if (!old) { lines.push(`+ step ${s.id}`); continue; }
    used.add(old);
    if (old.id !== s.id) lines.push(`~ step ${old.id} → ${s.id}`);
    const oldNext = old.next.map((n) => (typeof n === 'string' ? { id: n } : n));
    const gone = oldNext.filter((o) => !s.next.some((n) => matches(o, n)));
    const added = s.next.filter((n) => !oldNext.some((o) => matches(o, n)));
    if (gone.length || added.length) lines.push(`~ step ${s.id}: next ${nextIds(oldNext)} → ${nextIds(s.next)}`);
  }
  for (const b of before) if (!used.has(b)) lines.push(`- step ${b.id}`);
  return lines;
}

// The human-readable changes between two snapshots of one resource.
export function describeChange(before, after) {
  const lines = [];
  if (before.name !== after.name) lines.push(`name: ${quote(before.name)} → ${quote(after.name)}`);
  // A summary only counts when the model has a description (see `message`).
  if (after.summary !== null && after.summary !== undefined && before.summary !== after.summary) lines.push(`summary: ${quote(before.summary)} → ${quote(after.summary)}`);
  if (after.fields) lines.push(...describeFields(before.fields ?? [], after.fields));
  if (after.steps) lines.push(...describeSteps(before.steps ?? [], after.steps));
  return lines;
}

// new: not exported yet · changed: [{ label, changes, renamedFrom? }] · removed: exported before, gone from the model.
// A "new" and a "removed" resource of the same kind that share a board element id are one resource, renamed.
export function diffAgainst(manifest, context, snapshots) {
  const before = manifest[context]?.resources ?? {};
  const result = { new: [], changed: [], removed: [], unchanged: [] };
  const kind = (label) => label.split('/')[0];
  const missing = Object.keys(before).filter((label) => !(label in snapshots));

  for (const [label, snap] of Object.entries(snapshots)) {
    const old = before[label];
    if (old && typeof old === 'object') {
      const changes = describeChange(old, snap);
      if (changes.length) result.changed.push({ label, changes });
      else result.unchanged.push(label);
      continue;
    }
    const was = snap.keys?.length ? missing.find((m) => kind(m) === kind(label) && before[m]?.keys?.some((k) => snap.keys.includes(k))) : null;
    if (!was) { result.new.push(label); continue; }
    missing.splice(missing.indexOf(was), 1);
    const id = (l) => l.split('/').slice(1).join('/');
    result.changed.push({ label, renamedFrom: was, changes: [`id: ${id(was)} → ${id(label)}`, ...describeChange(before[was], snap)] });
  }
  result.removed = missing;
  return result;
}
