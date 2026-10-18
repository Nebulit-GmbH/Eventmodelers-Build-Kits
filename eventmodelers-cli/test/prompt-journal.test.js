import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { journalPromptFinished, journalPromptReceived, openPrompts } from '../shared/build-kit/lib/prompt-journal.js';
import { tempKit } from './helpers.js';

// What the modeling agent keeps of the board prompts it takes: received, then finished. The platform decides
// who gets a prompt; this is the agent's own record of what it had in hand.

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };
const kitDir = (t) => { const kit = join(tempKit(t), '.agent-modeling-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const board = { id: 'p1', prompt: 'Add the OrderPlaced event', board_id: 'b1', priority: 2, agent_id: null, node_id: 'n1', comment_id: 'c1', status: 'CLAIMED', context: { big: 'x'.repeat(5000) } };

test('a received prompt is journaled with what identifies it, the process, and the agent metadata', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: board, meta: META });
  const [event] = readEvents(kit);
  assert.equal(event.type, 'prompt-received');
  assert.equal(event.pid, process.pid);
  assert.deepEqual(event.meta, META);
  assert.deepEqual(event.prompt, { id: 'p1', text: 'Add the OrderPlaced event', board_id: 'b1', priority: 2, agent_id: null, node_id: 'n1', comment_id: 'c1' });
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
});

test('only the identifying fields are kept — never the prompt\'s context or other platform columns', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: board });
  assert.equal('context' in readEvents(kit)[0].prompt, false);
  assert.equal('status' in readEvents(kit)[0].prompt, false);
});

test('a long prompt text is cut to 300 characters', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: { ...board, prompt: 'y'.repeat(500) } });
  assert.equal(readEvents(kit)[0].prompt.text.length, 300);
});

test('a prompt without an id is not journaled', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: { prompt: 'no id' } });
  assert.deepEqual(readEvents(kit), []);
});

test('finishing a prompt records the outcome and closes it', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: board });
  journalPromptFinished({ kitDir: kit, id: 'p1', outcome: 'turn-failed', reason: 'Claude exited 1', meta: META });
  const finished = readEvents(kit).find((e) => e.type === 'prompt-finished');
  assert.deepEqual({ prompt: finished.prompt, outcome: finished.outcome, reason: finished.reason, meta: finished.meta }, { prompt: 'p1', outcome: 'turn-failed', reason: 'Claude exited 1', meta: META });
  assert.deepEqual(openPrompts(kit), []);
});

test('a finished event without a reason has no reason field', (t) => {
  const kit = kitDir(t);
  journalPromptFinished({ kitDir: kit, id: 'p1', outcome: 'worked' });
  assert.equal('reason' in readEvents(kit)[0], false);
});

// ── crash recovery: hand back what a dead process was holding ───────────────────

import { decidePromptRecovery, recoverOpenPrompts } from '../shared/build-kit/lib/prompt-journal.js';

const DEAD = 2 ** 22 + 12345;
const prompt = (id, pid = DEAD) => ({ id, pid, text: `do ${id}`, board_id: 'b1', priority: 0, agent_id: null });
const noneAlive = () => false;

test('a prompt still CLAIMED or IN_PROGRESS on the platform is handed back; DONE, ADDED and vanished ones are not', () => {
  const open = ['c', 'i', 'd', 'a', 'g'].map((id) => prompt(id));
  const platform = new Map([['c', 'CLAIMED'], ['i', 'IN_PROGRESS'], ['d', 'DONE'], ['a', 'ADDED']]);
  assert.deepEqual(decidePromptRecovery(open, platform, { isAlive: noneAlive, selfPid: 1 }), [
    { id: 'c', action: 'release' },
    { id: 'i', action: 'release' },
    { id: 'd', action: 'finish', outcome: 'already-settled' },
    { id: 'a', action: 'finish', outcome: 'already-settled' },
    { id: 'g', action: 'finish', outcome: 'gone' },
  ]);
});

test('a prompt held by another live process is left alone; one of this process or a dead one is recovered', () => {
  const open = [prompt('live', 4242), prompt('mine', 7), prompt('dead', DEAD)];
  const platform = new Map(open.map((p) => [p.id, 'CLAIMED']));
  const plan = decidePromptRecovery(open, platform, { isAlive: (pid) => pid === 4242, selfPid: 7 });
  assert.deepEqual(plan.map((a) => a.id), ['mine', 'dead']);
});

function fakePlatform(statuses, { failStatuses = false, releaseError = null } = {}) {
  const calls = { released: [], asked: [] };
  return {
    calls,
    fetchStatuses: async (ids) => {
      calls.asked.push(ids);
      if (failStatuses) throw new Error('HTTP 404');
      return new Map(Object.entries(statuses).filter(([id]) => ids.includes(id)));
    },
    release: async (id) => {
      if (releaseError) throw releaseError;
      calls.released.push(id);
    },
  };
}
const recover = (kit, platform, extra = {}) => recoverOpenPrompts({ kitDir: kit, meta: META, fetchStatuses: platform.fetchStatuses, release: platform.release, isAlive: noneAlive, selfPid: 1, ...extra });
const receive = (kit, ...ids) => { for (const id of ids) journalPromptReceived({ kitDir: kit, prompt: { id, prompt: `do ${id}`, board_id: 'b1' }, meta: META }); };
const outcomes = (kit) => Object.fromEntries(readEvents(kit).filter((e) => e.type === 'prompt-finished').map((e) => [e.prompt, e.outcome]));

test('recovery hands back what is still held, closes the rest, and says what it did', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'c', 'd', 'g');
  const platform = fakePlatform({ c: 'IN_PROGRESS', d: 'DONE' });
  assert.deepEqual(await recover(kit, platform), { released: 1, settled: 2, left: 0 });
  assert.deepEqual(platform.calls.released, ['c']);
  assert.deepEqual(outcomes(kit), { c: 'released', d: 'already-settled', g: 'gone' });
  assert.deepEqual(openPrompts(kit), []);
  assert.deepEqual(readEvents(kit).find((e) => e.type === 'prompt-finished').reason, 'recovered after a restart');
});

test('with nothing open the platform is not asked', async (t) => {
  const kit = kitDir(t);
  const platform = fakePlatform({});
  assert.deepEqual(await recover(kit, platform), { released: 0, settled: 0, left: 0 });
  assert.deepEqual(platform.calls.asked, []);
});

test('it asks about its own prompts only, in one call', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'a', 'b');
  const platform = fakePlatform({ a: 'DONE', b: 'DONE' });
  await recover(kit, platform);
  assert.deepEqual(platform.calls.asked, [['a', 'b']]);
});

test('a prompt held by another live process stays open and is not touched', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'p1');
  const platform = fakePlatform({ p1: 'CLAIMED' });
  assert.deepEqual(await recover(kit, platform, { isAlive: () => true, selfPid: 1 }), { released: 0, settled: 0, left: 1 });
  assert.deepEqual(platform.calls.released, []);
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
});

test('if the platform cannot be asked nothing is released and the journal stays open for the next start', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'p1');
  const platform = fakePlatform({}, { failStatuses: true });
  assert.deepEqual(await recover(kit, platform), { released: 0, settled: 0, left: 1 });
  assert.deepEqual(platform.calls.released, []);
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
});

test('a hand-back that fails stays open; one the platform says is already in that status, or gone, is closed', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'p1');
  assert.deepEqual(await recover(kit, fakePlatform({ p1: 'CLAIMED' }, { releaseError: Object.assign(new Error('HTTP 503'), { status: 503 }) })), { released: 0, settled: 0, left: 1 });
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
  assert.deepEqual(await recover(kit, fakePlatform({ p1: 'CLAIMED' }, { releaseError: Object.assign(new Error('HTTP 409'), { status: 409 }) })), { released: 0, settled: 1, left: 0 });
  assert.deepEqual(outcomes(kit), { p1: 'already-settled' });
  receive(kit, 'p2');
  assert.deepEqual(await recover(kit, fakePlatform({ p2: 'CLAIMED' }, { releaseError: Object.assign(new Error('HTTP 404'), { status: 404 }) })), { released: 0, settled: 1, left: 0 });
  assert.equal(outcomes(kit).p2, 'gone');
});
