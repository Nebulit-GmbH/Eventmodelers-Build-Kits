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
