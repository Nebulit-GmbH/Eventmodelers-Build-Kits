import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineIds, filterEvents, formatEvent, formatPayload, summarize } from '../shared/build-kit/lib/events-view.js';
import { fold } from '../shared/build-kit/lib/slice-state.js';

// `eventmodelers events`: the event log, decoded for a terminal. One line per event; filters; and the state the
// log folds to. Colour is the command's business — everything here is plain text.

const AT = '2026-10-18T11:54:56.317Z';
const ev = (type, extra = {}) => ({ type, id: '11111111-2222-3333-4444-555555555555', at: AT, meta: { agent_id: 'cc9a10b3-8492-4bf7-b992-2ad19e8a4772' }, ...extra });
const S = 'ccc5e66b-6b29-40b9-a163-269b1b0b173b';
const line = (e, titles = {}) => formatEvent(e, { titles });

test('a line starts with the date and time, the event type and the agent that wrote it', () => {
  const l = line(ev('claim-confirmed', { slice: S }));
  assert.match(l, /^2026-10-18 11:54:56 +claim-confirmed +ccc5e66b +.*cc9a$/);
});

test('a claim shows the ticket and assignee the slice was built under, when it had them', () => {
  assert.match(line(ev('claimed', { slice: S, pid: 1, cleanTree: true, ticketNumber: 'PROJ-7', assignee: 'user-1' })), /clean tree, ticket PROJ-7, assignee user-1/);
  assert.doesNotMatch(line(ev('claimed', { slice: S, pid: 1, cleanTree: true })), /ticket|assignee/);
});

test('the slice is shown by its short id, with its title when the log knows it', () => {
  assert.match(line(ev('settled', { slice: S, status: 'Done' }), { [S]: 'State Change' }), /ccc5e66b "State Change" +Done/);
  assert.match(line(ev('settled', { slice: S, status: 'Done' })), /ccc5e66b +Done/);
});

test('each event type says what matters about it', () => {
  assert.match(line(ev('board-observed', { slice: S, status: 'Planned' })), /Planned/);
  assert.match(line(ev('claimed', { slice: S, pid: 9911, cleanTree: false, base: { branch: 'main', head: '1252bd0c9999' } })), /pid 9911.*dirty tree.*main@1252bd0c/);
  assert.match(line(ev('claimed', { slice: S, pid: 1, cleanTree: true, base: null })), /clean tree/);
  assert.match(line(ev('agent-recorded', { slice: S, status: 'Done' })), /Done/);
  assert.match(line(ev('released', { slice: S, reason: 'moved' })), /moved/);
  assert.match(line(ev('attempt-failed', { slice: S, reason: 'no-outcome', lastReply: 'gave up on it', branch: 'feature/x', changed: ' M a.txt\n M b.txt', status: 'Planned' })), /no-outcome.*back to Planned.*2 files.*feature\/x.*gave up on it/);
  assert.match(line(ev('blocked', { slice: S, reason: 'five failed builds' })), /five failed builds/);
  assert.match(line(ev('task-queued', { payload: { sliceId: S, sliceTitle: null, sliceStatus: 'Review' } })), /Review/);
  assert.match(line(ev('task-done', { task: 'abcdef12-0000' })), /abcdef12/);
});

test('learnings, prompts and the curator are readable too', () => {
  assert.match(line(ev('learning-recorded', { text: 'Use npm test', topic: 'Testing', scope: 'repo', tags: ['ci'] })), /\[Testing\] Use npm test.*repo.*#ci/);
  assert.match(line(ev('learning-recorded', { text: 'plain' })), /\[General\] plain/);
  assert.match(line(ev('learning-retracted', { learning: 'abcdef12-0000', reason: 'module deleted' })), /abcdef12.*module deleted/);
  assert.match(line(ev('learning-merged', { text: 'one line', sources: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], reason: 'same fact' })), /2 learnings.*one line.*same fact/);
  assert.match(line(ev('learnings-curated')), /learnings-curated/);
  assert.match(line(ev('prompt-received', { pid: 4711, prompt: { id: '0e5835db-43f2', text: 'Add one slice', priority: true } })), /0e5835db.*Add one slice.*priority.*pid 4711/);
  assert.match(line(ev('prompt-finished', { prompt: '0e5835db-43f2', outcome: 'released', reason: 'recovered after a restart' })), /0e5835db.*released.*recovered after a restart/);
});

test('long text is cut to one line, and an unknown event is shown as compact JSON', () => {
  assert.ok(line(ev('learning-recorded', { text: 'x'.repeat(400) })).length < 330);
  assert.equal(line(ev('learning-recorded', { text: 'a\nb' })).includes('\n'), false);
  assert.match(line(ev('from-the-future', { slice: S, extra: 1 })), /from-the-future.*"extra":1/);
});

test('an event without a time or agent still formats', () => {
  assert.match(formatEvent({ type: 'settled', slice: S, status: 'Done' }, {}), /^-+ +settled/);
});

test('filters: by type, by slice (id prefix or title), by tag, and the last N', () => {
  const events = [
    ev('board-observed', { slice: S, status: 'Planned' }),
    ev('claimed', { slice: S, pid: 1 }),
    ev('board-observed', { slice: 'other-slice', status: 'Done' }),
    ev('learning-recorded', { text: 'a', tags: ['ci'] }),
    ev('learning-recorded', { text: 'b', tags: ['ui'] }),
  ];
  assert.equal(filterEvents(events, { types: ['claimed', 'board-observed'] }).length, 3);
  assert.equal(filterEvents(events, { slice: 'ccc5e66b' }).length, 2);
  assert.equal(filterEvents(events, { slice: 'state change' }, { [S]: 'State Change' }).length, 2);
  assert.deepEqual(filterEvents(events, { tag: 'ui' }).map((e) => e.text), ['b']);
  assert.deepEqual(filterEvents(events, { last: 2 }).map((e) => e.text), ['a', 'b']);
  assert.equal(filterEvents(events, {}).length, 5);
});

test('the state summary lists slices with their status, claim and attempts, open tasks and prompts, and the learnings', () => {
  const state = fold([
    ev('board-observed', { slice: S, status: 'Planned' }),
    ev('claimed', { slice: S, ctx: 'cart', title: 'State Change', pid: 7, base: null, cleanTree: true }),
    ev('task-queued', { id: 't1', payload: { sliceId: 'x', sliceStatus: 'Review' } }),
    ev('prompt-received', { pid: 7, prompt: { id: 'p1-0000', text: 'do it' } }),
    ev('learning-recorded', { id: 'l1', text: 'a' }),
    ev('learning-recorded', { id: 'l2', text: 'b' }),
  ]);
  const text = summarize(state);
  assert.match(text, /ccc5e66b.*InProgress.*claimed by pid 7/);
  assert.match(text, /1 task waiting/);
  assert.match(text, /1 prompt open/);
  assert.match(text, /2 learnings/);
});

test('an empty log summarizes as nothing', () => {
  assert.match(summarize(fold([])), /no slices/i);
});

test('the summary names a slice by the title the log knows, even after its claim has closed', () => {
  const state = fold([ev('board-observed', { slice: S, status: 'Done' })]);
  assert.match(summarize(state, { [S]: 'State Change' }), /ccc5e66b "State Change" +Done/);
});

test('the board filter keeps the events stamped with that board (a global kit\'s log mixes boards)', () => {
  const events = [
    ev('settled', { slice: S, meta: { agent_id: 'a', board_id: 'c2b3b7da-f3bb-4ad6-ae89-f59873c6556c' } }),
    ev('settled', { slice: S, meta: { agent_id: 'a', board_id: '11111111-aaaa-4aaa-8aaa-111111111111' } }),
    ev('settled', { slice: S }),
  ];
  assert.equal(filterEvents(events, { board: 'c2b3b7da' }).length, 1);
  assert.equal(filterEvents(events, { board: 'C2B3' }).length, 1, 'by prefix, ignoring case');
  assert.equal(filterEvents(events, { board: 'nope' }).length, 0);
});

test('the payload is every field the line does not already show, indented — or nothing', () => {
  assert.equal(formatPayload(ev('claim-confirmed')), '');
  assert.equal(formatPayload(ev('tool-call', { prompt: 'p1', tool: 'get_node', input: { nodeId: 'n1' } })),
    '    {\n      "prompt": "p1",\n      "tool": "get_node",\n      "input": {\n        "nodeId": "n1"\n      }\n    }');
});

test('the line ends with the agent and its type, build or modeling', () => {
  assert.match(line(ev('claimed', { slice: S, meta: { agent_id: '8eb47d8d-c6fa', agent_type: 'MODELING' } })), /8eb4 modeling$/);
  assert.match(line(ev('claimed', { slice: S, meta: { agent_id: '8eb47d8d-c6fa', agent_type: 'BUILD' } })), /8eb4 build$/);
});

test('a call shows how long it took, and that it failed', () => {
  assert.match(line(ev('tool-call', { prompt: 'p1', tool: 'get_node', detail: 'get_node', durationMs: 420 })), /get_node \(420ms\)/);
  assert.match(line(ev('prompt-action', { prompt: 'p1', action: 'commented', detail: '1 comment', durationMs: 2340, error: true })), /commented 1 comment \(2\.3s, failed\)/);
  assert.doesNotMatch(line(ev('tool-call', { prompt: 'p1', tool: 'get_node' })), /\(/);
});

test('the baseline is each slice\'s first board-observed event, and omit leaves it out', () => {
  const A = 'aaaaaaaa-0000-0000-0000-000000000000';
  const log = [
    ev('board-observed', { id: 'e1', slice: S, status: 'Created' }),
    ev('board-observed', { id: 'e2', slice: A, status: 'Done' }),
    ev('board-observed', { id: 'e3', slice: S, status: 'Planned' }),
    ev('claimed', { id: 'e4', slice: S, pid: 1 }),
  ];
  assert.deepEqual([...baselineIds(log)], ['e1', 'e2']);
  assert.deepEqual(filterEvents(log, { omit: baselineIds(log) }).map((e) => e.id), ['e3', 'e4']);
  assert.deepEqual(filterEvents(log, {}).map((e) => e.id), ['e1', 'e2', 'e3', 'e4']);
  // --last counts what is left after the baseline is gone
  assert.deepEqual(filterEvents(log, { omit: baselineIds(log), last: 1 }).map((e) => e.id), ['e4']);
});
