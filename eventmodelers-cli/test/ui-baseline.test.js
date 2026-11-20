import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, findSliceDir, fingerprint, readBaseline, writeBaseline } from '../lib/ui-baseline.js';

function setup(slice) {
  const kit = mkdtempSync(join(tmpdir(), 'ui-baseline-'));
  mkdirSync(join(kit, '.slices', 'ctx', 'tag'), { recursive: true });
  writeFileSync(join(kit, '.slices', 'ctx', 'tag', 'slice.json'), JSON.stringify(slice));
  return findSliceDir(kit, slice.title);
}

const slice = { id: 'S', title: 'Assign Tag', screens: [{ id: 'scr' }], commands: [{ id: 'cmd' }], codeGen: { uiPrompts: ['new layout'] } };
const board = (hashes) => async (ids) => ids.map((id) => ({ id, hash: hashes[id] }));

test('no baseline, then unchanged once recorded', async () => {
  const found = setup(slice);
  const fetchNodes = board({ scr: 'a', cmd: 'b' });
  assert.equal(compare(readBaseline(found.path), await fingerprint({ slice, fetchNodes })).verdict, 'NO_BASELINE');
  writeBaseline(found.path, await fingerprint({ slice, fetchNodes }));
  assert.equal(compare(readBaseline(found.path), await fingerprint({ slice, fetchNodes })).verdict, 'UNCHANGED');
});

test('a changed screen hash, element hash or prompt is reported on its own', async () => {
  const found = setup(slice);
  writeBaseline(found.path, await fingerprint({ slice, fetchNodes: board({ scr: 'a', cmd: 'b' }) }));
  const baseline = readBaseline(found.path);

  const screen = compare(baseline, await fingerprint({ slice, fetchNodes: board({ scr: 'a2', cmd: 'b' }) }));
  assert.deepEqual([screen.screenChanged, screen.elementsChanged, screen.promptsChanged], [true, false, false]);

  const element = compare(baseline, await fingerprint({ slice, fetchNodes: board({ scr: 'a', cmd: 'b2' }) }));
  assert.deepEqual([element.screenChanged, element.elementsChanged, element.promptsChanged], [false, true, false]);

  const edited = { ...slice, codeGen: { uiPrompts: ['new layout', 'add a dropdown'] } };
  const prompt = compare(baseline, await fingerprint({ slice: edited, fetchNodes: board({ scr: 'a', cmd: 'b' }) }));
  assert.deepEqual([prompt.screenChanged, prompt.elementsChanged, prompt.promptsChanged, prompt.newPrompts], [false, false, true, ['add a dropdown']]);
});

test('a screen node missing on the board is an error, never UNCHANGED', async () => {
  await assert.rejects(fingerprint({ slice, fetchNodes: async () => [] }), /screen node/);
});

test('a check names the nodes that changed, were added and were removed', async () => {
  const two = { ...slice, events: [{ id: 'evt', title: 'Tag Assigned' }], commands: [{ id: 'cmd', title: 'Assign Tag' }] };
  const found = setup(two);
  writeBaseline(found.path, await fingerprint({ slice: two, fetchNodes: board({ scr: 'a', cmd: 'b', evt: 'c' }) }));
  const later = { ...two, events: [], commands: [{ id: 'cmd', title: 'Assign Tag' }, { id: 'cmd2', title: 'Untag' }] };
  const result = compare(readBaseline(found.path), await fingerprint({ slice: later, fetchNodes: board({ scr: 'a', cmd: 'b2', cmd2: 'd' }) }));
  assert.deepEqual(result.changedNodes.map((n) => n.title), ['Assign Tag']);
  assert.deepEqual(result.addedNodes.map((n) => n.title), ['Untag']);
  assert.deepEqual(result.removedNodes.map((n) => n.title), ['Tag Assigned']);
});

test('backend scope ignores screens and UI prompts, and a baseline of another scope is no baseline', async () => {
  const found = setup(slice);
  const hashes = { scr: 'a', cmd: 'b' };
  writeBaseline(found.path, await fingerprint({ slice, fetchNodes: board(hashes), scope: 'backend' }), 'backend');
  const edited = { ...slice, codeGen: { uiPrompts: ['something else'] } };
  const result = compare(readBaseline(found.path), await fingerprint({ slice: edited, fetchNodes: board({ scr: 'a2', cmd: 'b' }), scope: 'backend' }), 'backend');
  assert.equal(result.verdict, 'UNCHANGED');
  assert.equal(compare(readBaseline(found.path), await fingerprint({ slice, fetchNodes: board(hashes) }), 'ui').verdict, 'NO_BASELINE');
});

test('a slice present in two contexts is read from the active one, not a stale leftover', () => {
  const kit = mkdtempSync(join(tmpdir(), 'ui-baseline-'));
  for (const [ctx, body] of [['default', { id: 'S', title: 'Assign Tag' }], ['foo', { id: 'S', title: 'Assign Tag', commands: [{ id: 'cmd' }] }]]) {
    mkdirSync(join(kit, '.slices', ctx, 'assign-tag'), { recursive: true });
    writeFileSync(join(kit, '.slices', ctx, 'assign-tag', 'slice.json'), JSON.stringify(body));
  }
  writeFileSync(join(kit, '.slices', 'current_context.json'), JSON.stringify({ name: 'foo' }));
  assert.ok(findSliceDir(kit, 'Assign Tag').path.endsWith(join('foo', 'assign-tag')));
  assert.ok(findSliceDir(kit, 'S').slice.commands);
});

test('an edited interaction model (e.g. fields added to a navigated event) is a change; an old baseline without it is one only when the slice has a model', async () => {
  const withModel = { ...slice, interactionModel: { steps: [{ events: [{ kind: 'navigated' }] }] } };
  const found = setup(withModel);
  const fetchNodes = board({ scr: 'a', cmd: 'b' });
  writeBaseline(found.path, await fingerprint({ slice: withModel, fetchNodes }));
  assert.equal(compare(readBaseline(found.path), await fingerprint({ slice: withModel, fetchNodes })).verdict, 'UNCHANGED');
  const edited = { ...withModel, interactionModel: { steps: [{ events: [{ kind: 'navigated', fields: ['email'] }] }] } };
  const result = compare(readBaseline(found.path), await fingerprint({ slice: edited, fetchNodes }));
  assert.equal(result.verdict, 'CHANGED');
  assert.equal(result.interactionChanged, true);
  // baseline recorded before the interaction model was tracked
  const old = { ...readBaseline(found.path) }; delete old.interactionHash;
  assert.equal(compare(old, await fingerprint({ slice: withModel, fetchNodes })).interactionChanged, true);
  assert.equal(compare(old, await fingerprint({ slice, fetchNodes })).interactionChanged, false);
});
