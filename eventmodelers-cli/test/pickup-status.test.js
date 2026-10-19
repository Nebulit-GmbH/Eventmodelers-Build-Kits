import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPickupStatus, resolveHandover } from '../shared/build-kit/lib/ralph.js';
import { tempKit } from './helpers.js';

test('a kit without lib/kit.json claims Planned slices', (t) => {
  assert.equal(readPickupStatus(tempKit(t)), 'Planned');
});

test('lib/kit.json names the status the kit claims from', (t) => {
  const kit = tempKit(t);
  mkdirSync(join(kit, 'lib'));
  writeFileSync(join(kit, 'lib', 'kit.json'), '{ "pickupStatus": "Waiting" }');
  assert.equal(readPickupStatus(kit), 'Waiting');
});

test('an unreadable or empty kit.json falls back to Planned', (t) => {
  const kit = tempKit(t);
  mkdirSync(join(kit, 'lib'));
  writeFileSync(join(kit, 'lib', 'kit.json'), '{ nope');
  assert.equal(readPickupStatus(kit), 'Planned');
  writeFileSync(join(kit, 'lib', 'kit.json'), '{ "pickupStatus": "  " }');
  assert.equal(readPickupStatus(kit), 'Planned');
});

test('handover is off unless the project setting or this run turns it on', (t) => {
  const prev = process.env.RALPH_HANDOVER;
  t.after(() => { if (prev === undefined) delete process.env.RALPH_HANDOVER; else process.env.RALPH_HANDOVER = prev; });
  delete process.env.RALPH_HANDOVER;
  assert.equal(resolveHandover({}), false);
  assert.equal(resolveHandover(null), false);
  assert.equal(resolveHandover({ handover: false }), false);
  assert.equal(resolveHandover({ handover: true }), true);
  process.env.RALPH_HANDOVER = '1'; // run --handover
  assert.equal(resolveHandover({}), true);
  process.env.RALPH_HANDOVER = '';
  assert.equal(resolveHandover({}), false);
});

test('a kit.json written before the rename (Handover) still reads as Waiting', (t) => {
  const kit = tempKit(t);
  mkdirSync(join(kit, 'lib'), { recursive: true });
  writeFileSync(join(kit, 'lib', 'kit.json'), '{ "pickupStatus": "Handover" }');
  assert.equal(readPickupStatus(kit), 'Waiting');
});
