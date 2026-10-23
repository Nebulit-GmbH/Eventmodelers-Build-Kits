// `eventmodelers export --type eventcatalog` — writes an EventCatalog project's resources
// (domain, flow, events, commands, queries) from the slices of an event model, through the
// EventCatalog SDK. Exports run({ slices, outDir, context, force, owners, sdk }).

import { buildModel } from './model.js';
import { toResources } from './render.js';
import { writeResources } from './write.js';
import { diffAgainst, readManifest, snapshotsOf, updateManifest } from './manifest.js';

export { loadFromBoard, loadFromLocal, listContexts, listLocalContexts, ContextNotFoundError } from './load.js';
export { loadSdk, installSdk, isCatalog } from './write.js';

// `export --check`: compares the model with what the last export recorded. Writes nothing, needs no SDK.
export function check({ slices, outDir, context }) {
  if (!slices.length) return null;
  const model = buildModel(slices, { context });
  const diff = diffAgainst(readManifest(outDir), model.domain.name, snapshotsOf(model));
  return { context: model.domain.name, ...diff, inSync: !diff.new.length && !diff.changed.length && !diff.removed.length };
}

// `sdk` is the SDK's factory (see loadSdk); the catalog at `outDir` is where it writes.
export async function run({ slices, outDir, context, force = false, owners = [], sdk }) {
  if (!slices.length) return { written: [], skipped: [], model: null };
  const model = buildModel(slices, { context });
  const resources = toResources(model, { owners });
  const { written, skipped } = await writeResources(sdk(outDir), resources, { force });
  // Only what was actually written is recorded: a skipped resource keeps its old snapshot (or none), so
  // `--check` keeps reporting it until it is really brought up to date.
  const snapshots = snapshotsOf(model);
  updateManifest(outDir, model.domain.name, Object.fromEntries(written.map((label) => [label, snapshots[label]])));
  return { written, skipped, model };
}
