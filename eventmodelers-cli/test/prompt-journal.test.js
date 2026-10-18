import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { createCallTracker, journalPromptAction, journalPromptFinished, journalPromptReceived, openPrompts, shouldJournalCall } from '../shared/build-kit/lib/prompt-journal.js';
import { tempKit } from './helpers.js';

// What the modeling agent keeps of the board prompts it takes: received, then finished. The platform decides
// who gets a prompt; this is the agent's own record of what it had in hand.

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };
const kitDir = (t) => { const kit = join(tempKit(t), '.agent-modeling-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const board = { id: 'p1', prompt: 'Add the OrderPlaced event', board_id: 'b1', priority: 2, agent_id: null, node_id: 'n1', comment_id: 'c1', status: 'CLAIMED', context: { big: 'x'.repeat(5000) } };

test('a received prompt is journaled with what identifies it and what replay needs, the process, and the agent metadata', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: board, meta: META });
  const [event] = readEvents(kit);
  assert.equal(event.type, 'prompt-received');
  assert.equal(event.pid, process.pid);
  assert.deepEqual(event.meta, META);
  assert.deepEqual(event.prompt, { id: 'p1', text: 'Add the OrderPlaced event', board_id: 'b1', priority: 2, agent_id: null, node_id: 'n1', comment_id: 'c1', context: board.context });
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
});

test('what replay needs is kept — text, timeline, context — and the platform\'s own columns are not', (t) => {
  const kit = kitDir(t);
  journalPromptReceived({ kitDir: kit, prompt: { ...board, timeline_id: 'tl1', prompt: 'y'.repeat(500) } });
  const { prompt } = readEvents(kit)[0];
  assert.equal(prompt.text.length, 500);
  assert.equal(prompt.timeline_id, 'tl1');
  assert.deepEqual(prompt.context, board.context);
  assert.equal('status' in prompt, false);
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

// ── restart recovery: hand back what this agent was holding ─────────────────────
// The platform records who holds a prompt (claimed_by) and never re-queues one by itself. A freshly started
// agent holds nothing, so whatever the platform still shows as held by its id is what an earlier run left behind.

import { recoverOwnPrompts } from '../shared/build-kit/lib/prompt-journal.js';

function fakePlatform(held, { failHeld = false, releaseError = null } = {}) {
  const calls = { asked: [], released: [] };
  return {
    calls,
    fetchHeld: async (agentId) => {
      calls.asked.push(agentId);
      if (failHeld) throw new Error('HTTP 404');
      return held.map((id) => ({ id, status: 'IN_PROGRESS' }));
    },
    release: async (id) => {
      if (releaseError) throw releaseError;
      calls.released.push(id);
    },
  };
}
const recover = (kit, platform) => recoverOwnPrompts({ kitDir: kit, meta: META, agentId: 'me', fetchHeld: platform.fetchHeld, release: platform.release });
const receive = (kit, ...ids) => { for (const id of ids) journalPromptReceived({ kitDir: kit, prompt: { id, prompt: `do ${id}`, board_id: 'b1' }, meta: META }); };
const outcomes = (kit) => Object.fromEntries(readEvents(kit).filter((e) => e.type === 'prompt-finished').map((e) => [e.prompt, e.outcome]));
const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test('everything the platform shows as held by this agent is handed back, and its journal entries are closed', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'a', 'b');
  const platform = fakePlatform(['a', 'b']);
  assert.deepEqual(await recover(kit, platform), { released: 2, settled: 0, left: 0 });
  assert.deepEqual(platform.calls.asked, ['me']);
  assert.deepEqual(platform.calls.released, ['a', 'b']);
  assert.deepEqual(outcomes(kit), { a: 'released', b: 'released' });
  assert.deepEqual(readEvents(kit).find((e) => e.type === 'prompt-finished').reason, 'recovered after a restart');
  assert.deepEqual(openPrompts(kit), []);
});

test('a prompt held on the platform is handed back even when the journal never heard of it', async (t) => {
  const kit = kitDir(t);
  const platform = fakePlatform(['lost']);
  assert.deepEqual(await recover(kit, platform), { released: 1, settled: 0, left: 0 });
  assert.deepEqual(platform.calls.released, ['lost']);
  assert.deepEqual(outcomes(kit), {}, 'nothing to close in the journal');
});

test('a journal entry the platform no longer shows as held is closed without anything being released', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'done', 'held');
  const platform = fakePlatform(['held']);
  assert.deepEqual(await recover(kit, platform), { released: 1, settled: 1, left: 0 });
  assert.deepEqual(platform.calls.released, ['held']);
  assert.deepEqual(outcomes(kit), { done: 'already-settled', held: 'released' });
});

test('with nothing held and nothing open the platform is asked once and nothing happens', async (t) => {
  const kit = kitDir(t);
  const platform = fakePlatform([]);
  assert.deepEqual(await recover(kit, platform), { released: 0, settled: 0, left: 0 });
  assert.deepEqual(platform.calls.asked, ['me']);
  assert.deepEqual(readEvents(kit), []);
});

test('if the platform cannot be asked nothing is released and the journal stays open for the next start', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'p1');
  const platform = fakePlatform([], { failHeld: true });
  assert.deepEqual(await recover(kit, platform), { released: 0, settled: 0, left: 1 });
  assert.deepEqual(platform.calls.released, []);
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
});

test('a hand-back that fails stays open; one the platform says is already back, or gone, is settled', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'p1');
  assert.deepEqual(await recover(kit, fakePlatform(['p1'], { releaseError: err(503) })), { released: 0, settled: 0, left: 1 });
  assert.deepEqual(openPrompts(kit).map((p) => p.id), ['p1']);
  assert.deepEqual(await recover(kit, fakePlatform(['p1'], { releaseError: err(409) })), { released: 0, settled: 1, left: 0 });
  assert.deepEqual(outcomes(kit), { p1: 'already-settled' });
  receive(kit, 'p2');
  assert.deepEqual(await recover(kit, fakePlatform(['p2'], { releaseError: err(404) })), { released: 0, settled: 1, left: 0 });
  assert.equal(outcomes(kit).p2, 'gone');
});

test('an agent without an id recovers nothing', async (t) => {
  const kit = kitDir(t);
  receive(kit, 'p1');
  const platform = fakePlatform(['p1']);
  assert.deepEqual(await recoverOwnPrompts({ kitDir: kit, meta: META, agentId: '', fetchHeld: platform.fetchHeld, release: platform.release }), { released: 0, settled: 0, left: 1 });
  assert.deepEqual(platform.calls.asked, []);
});

// ── the request that asks the platform what this agent is holding ───────────────

import { heldPromptsRequest } from '../shared/build-kit/lib/prompt-journal.js';

test('the held-prompts request carries the API token and the realtime JWT — the prompt routes need both — and the agent id', () => {
  const { url, headers } = heldPromptsRequest({ baseUrl: 'https://api.test', organizationId: 'o1', boardId: 'b 1', token: 'tok', jwt: 'jwt-123', agentId: 'agent-9' });
  assert.equal(headers['x-token'], 'tok');
  assert.equal(headers.Authorization, 'Bearer jwt-123');
  assert.equal(headers['x-agent-id'], 'agent-9');
  const u = new URL(url);
  assert.equal(u.pathname, '/api/org/o1/prompts');
  assert.deepEqual(Object.fromEntries(u.searchParams), { board_id: 'b 1', claimed_by: 'agent-9', status: 'CLAIMED,IN_PROGRESS', limit: '500' });
});

test('the board writes a turn makes are journaled against its prompt, reads are not', (t) => {
  const kit = kitDir(t);
  const act = (toolName, input) => journalPromptAction({ kitDir: kit, id: 'p1', toolName, input, meta: META });
  act('mcp__eventmodelers__add_comment', { comments: [{ nodeId: 'n1', text: 'Which flow is this?' }, { nodeId: 'n2', text: 'x' }] });
  act('mcp__eventmodelers__update_slice_status', { sliceTitle: 'Place order', newStatus: 'Blocked' });
  act('mcp__eventmodelers__submit_node_events', { events: [{ type: 'node:created' }, { type: 'node:changed' }, { type: 'node:changed' }] });
  act('mcp__eventmodelers__get_node', { nodeId: 'n1' });
  act('Bash', { command: 'ls' });
  assert.deepEqual(readEvents(kit).map((e) => [e.type, e.prompt, e.action, e.detail]), [
    ['prompt-action', 'p1', 'commented', '2 comments on 2 nodes: "Which flow is this?"'],
    ['prompt-action', 'p1', 'slice-status', '"Place order" → Blocked'],
    ['prompt-action', 'p1', 'nodes-changed', '1 node:created, 2 node:changed'],
  ]);
});

test('with verbose, every other tool call becomes an event of its own', (t) => {
  const kit = kitDir(t);
  const act = (toolName, input, verbose) => journalPromptAction({ kitDir: kit, id: 'p1', toolName, input, verbose, detail: `${toolName}!`, meta: META });
  act('mcp__eventmodelers__get_node', { nodeId: 'n1' }, false);
  act('mcp__eventmodelers__get_node', { nodeId: 'n1' }, true);
  act('mcp__eventmodelers__add_comment', { comments: [{ nodeId: 'n1', text: 'q' }] }, true);
  assert.deepEqual(readEvents(kit).map((e) => [e.type, e.action ?? e.tool]), [
    ['tool-call', 'mcp__eventmodelers__get_node'],
    ['prompt-action', 'commented'],
  ]);
});

test('with verbose the full input is stored, with the API token and JWTs masked; without it, no input', (t) => {
  const kit = kitDir(t);
  const TOKEN = '3f2c9a1e-7b44-4d0e-9c1a-2b6f8e5d4c3a';
  const call = (verbose) => journalPromptAction({ kitDir: kit, id: 'p1', toolName: 'Skill', input: { skill: 'connect', args: `token=${TOKEN} board=b1` }, verbose, secrets: [TOKEN], meta: META });
  call(false);
  call(true);
  const events = readEvents(kit);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].input, { skill: 'connect', args: 'token=*** board=b1' });
  assert.doesNotMatch(JSON.stringify(events[0]), new RegExp(TOKEN));
});

test('a call is timed from when it begins to when it ends, and one that never ends is drained without a duration', () => {
  let t = 100;
  const tracker = createCallTracker({ now: () => t, clock: () => '2026-10-18T10:00:00.000Z' });
  tracker.begin('a', { name: 'get_node', input: { nodeId: 'n1' } });
  tracker.begin('b', { name: 'add_comment', input: {} });
  t = 1350;
  assert.deepEqual(tracker.end('a'), { name: 'get_node', input: { nodeId: 'n1' }, startedAt: '2026-10-18T10:00:00.000Z', durationMs: 1250, error: false });
  assert.equal(tracker.end('a'), null);
  assert.deepEqual(tracker.drain().map((c) => c.name), ['add_comment']);
  assert.deepEqual(tracker.drain(), []);
  tracker.begin('c', { name: 'x', input: {} });
  t = 1400;
  assert.equal(tracker.end('c', { isError: true }).error, true);
});

test('a journaled call carries when it started and how long it took; only calls the journal keeps are worth timing', (t) => {
  const kit = kitDir(t);
  journalPromptAction({ kitDir: kit, id: 'p1', toolName: 'mcp__eventmodelers__update_slice_status', input: { sliceTitle: 'S', newStatus: 'Blocked' }, startedAt: '2026-10-18T10:00:00.000Z', durationMs: 420, error: true, meta: META });
  const [e] = readEvents(kit);
  assert.equal(e.at, '2026-10-18T10:00:00.000Z');
  assert.equal(e.durationMs, 420);
  assert.equal(e.error, true);
  assert.equal(shouldJournalCall('get_node', {}, false), false);
  assert.equal(shouldJournalCall('get_node', {}, true), true);
  assert.equal(shouldJournalCall('mcp__eventmodelers__add_comment', { comments: [] }, false), true);
});
