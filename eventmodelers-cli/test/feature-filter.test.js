import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFirstPlannedSlice, readFeatureFilter } from '../shared/build-kit/lib/ralph.js';
import { tempKit } from './helpers.js';

// One context with a Planned slice "Book" in feature "Seat Reservation", and a Planned slice "Pay" with none.
function kitWithSlices(t) {
  const kit = tempKit(t);
  const ctx = join(kit, '.slices', 'shop');
  const slices = [
    { id: 's1', slice: 'Book', folder: 'book', status: 'Planned', features: ['Seat Reservation'] },
    { id: 's2', slice: 'Pay', folder: 'pay', status: 'Planned' },
  ];
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'index.json'), JSON.stringify({ slices }));
  for (const s of slices) {
    mkdirSync(join(ctx, s.folder), { recursive: true });
    writeFileSync(join(ctx, s.folder, 'slice.json'), JSON.stringify({ id: s.id, title: s.slice, ...(s.features ? { features: s.features } : {}) }));
  }
  writeFileSync(join(kit, '.slices', 'current_context.json'), JSON.stringify({ name: 'shop' }));
  return kit;
}

function withFeature(t, value) {
  const prev = process.env.RALPH_FEATURE;
  t.after(() => { if (prev === undefined) delete process.env.RALPH_FEATURE; else process.env.RALPH_FEATURE = prev; });
  if (value === undefined) delete process.env.RALPH_FEATURE; else process.env.RALPH_FEATURE = value;
}

test('without --feature every Planned slice is picked up, in order', (t) => {
  withFeature(t, undefined);
  assert.equal(readFeatureFilter(), '');
  assert.equal(getFirstPlannedSlice(kitWithSlices(t)).id, 's1');
});

test('--feature picks up a Planned slice of that feature (case-insensitive)', (t) => {
  withFeature(t, ' seat reservation ');
  assert.equal(getFirstPlannedSlice(kitWithSlices(t)).id, 's1');
});

test('--feature of another feature picks up nothing, and a slice without features is never picked', (t) => {
  withFeature(t, 'Billing');
  assert.equal(getFirstPlannedSlice(kitWithSlices(t)), null);
});

test('--feature skips the slices outside the feature even when they come first', (t) => {
  withFeature(t, 'Seat Reservation');
  const kit = kitWithSlices(t);
  const index = join(kit, '.slices', 'shop', 'index.json');
  const { slices } = JSON.parse(readFileSync(index, 'utf-8'));
  writeFileSync(index, JSON.stringify({ slices: [slices[1], slices[0]] })); // Pay (no feature) first
  assert.equal(getFirstPlannedSlice(kit).id, 's1');
});
