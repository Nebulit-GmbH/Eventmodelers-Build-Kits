// `eventmodelers export --type eventcatalog` — writes an EventCatalog project's resources
// (domain, flow, events, commands, queries) from the slices of an event model, through the
// EventCatalog SDK. Exports run({ slices, outDir, context, force, owners, sdk, only, flows }), plan() and check() — `flows: false` leaves the flows out.

import { buildModel } from './model.js';
import { toResources } from './render.js';
import { writeResources } from './write.js';
import { diffAgainst, readManifest, snapshotsOf, updateManifest } from './manifest.js';

export { loadFromBoard, loadFromLocal, listContexts, listLocalContexts, ContextNotFoundError } from './load.js';
export { loadSdk, installSdk, isCatalog } from './write.js';

// Without `--flows`: the model without its chapters' flows — the domain then lists none either.
const withoutFlows = (model, flows) => (flows ? model : { ...model, flows: [] });

// `export --check`: compares the model with what the last export recorded. Writes nothing, needs no SDK.
export function check({ slices, outDir, context, flows = false }) {
  if (!slices.length) return null;
  const model = withoutFlows(buildModel(slices, { context }), flows);
  const diff = diffAgainst(readManifest(outDir), model.domain.name, snapshotsOf(model));
  return { context: model.domain.name, ...diff, inSync: !diff.new.length && !diff.changed.length && !diff.removed.length };
}

// `export --interactive`: every resource the model would write, with how it differs from the last export.
export function plan({ slices, outDir, context, flows = false }) {
  if (!slices.length) return null;
  const model = withoutFlows(buildModel(slices, { context }), flows);
  const snapshots = snapshotsOf(model);
  const diff = diffAgainst(readManifest(outDir), model.domain.name, snapshots);
  const changed = new Map(diff.changed.map((c) => [c.label, c.changes]));
  const items = Object.keys(snapshots).map((label) => (
    diff.new.includes(label) ? { label, status: 'new' }
      : changed.has(label) ? { label, status: 'changed', changes: changed.get(label) }
        : { label, status: 'unchanged' }
  ));
  return { context: model.domain.name, items };
}

// `sdk` is the SDK's factory (see loadSdk); the catalog at `outDir` is where it writes.
export async function run({ slices, outDir, context, force = false, owners = [], sdk, only, flows = false }) {
  if (!slices.length) return { written: [], skipped: [], model: null };
  const model = withoutFlows(buildModel(slices, { context }), flows);
  const resources = toResources(model, { owners });
  const { written, skipped } = await writeResources(sdk(outDir), resources, { force, only });
  // Only what was actually written is recorded: a skipped resource keeps its old snapshot (or none), so
  // `--check` keeps reporting it until it is really brought up to date.
  const snapshots = snapshotsOf(model);
  updateManifest(outDir, model.domain.name, Object.fromEntries(written.map((label) => [label, snapshots[label]])));
  return { written, skipped, model };
}
