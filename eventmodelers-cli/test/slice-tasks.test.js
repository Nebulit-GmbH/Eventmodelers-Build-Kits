import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { completeTask, nextTask, pendingTasks, queueTask } from '../shared/build-kit/lib/slice-tasks.js';
import { tempKit } from './helpers.js';

// The task queue is the log: the loop replays it to find the next task, the agent never touches a queue file.

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };
const kitDir = (t) => { const kit = join(tempKit(t), '.build-kit'); mkdirSync(kit, { recursive: true }); return kit; };
const change = (sliceId, sliceStatus) => ({ sliceId, sliceTitle: sliceId, sliceStatus });
const statuses = (kit) => pendingTasks(kit).map((t) => `${t.payload.sliceId}:${t.payload.sliceStatus}`);

test('a queued change is a task-queued event stamped with the agent, and shows up as pending', (t) => {
  const kit = kitDir(t);
  const { id } = queueTask({ kitDir: kit, payload: change('a', 'Review'), meta: META });
  const [event] = readEvents(kit);
  assert.deepEqual({ type: event.type, id: event.id, meta: event.meta, payload: event.payload }, { type: 'task-queued', id, meta: META, payload: change('a', 'Review') });
  assert.deepEqual(statuses(kit), ['a:Review']);
});

test('the next task is the oldest; a newer change to a slice replaces its task and goes to the back', (t) => {
  const kit = kitDir(t);
  queueTask({ kitDir: kit, payload: change('a', 'Review') });
  queueTask({ kitDir: kit, payload: change('b', 'Review') });
  assert.equal(nextTask(kit).payload.sliceId, 'a');
  queueTask({ kitDir: kit, payload: change('a', 'Done') });
  assert.deepEqual(statuses(kit), ['b:Review', 'a:Done']);
  assert.equal(nextTask(kit).payload.sliceId, 'b');
});

test('an empty queue has no next task', (t) => {
  assert.equal(nextTask(kitDir(t)), null);
  assert.deepEqual(pendingTasks(kitDir(t)), []);
});

test('completing a task removes just that one, and records who did it', (t) => {
  const kit = kitDir(t);
  const a = queueTask({ kitDir: kit, payload: change('a', 'Review') });
  queueTask({ kitDir: kit, payload: change('b', 'Review') });
  completeTask({ kitDir: kit, task: a.id, meta: META });
  assert.deepEqual(statuses(kit), ['b:Review']);
  assert.deepEqual(readEvents(kit).find((e) => e.type === 'task-done').meta, META);
});

test('a change arriving while the agent works a task is kept when that task is completed', (t) => {
  const kit = kitDir(t);
  const handed = queueTask({ kitDir: kit, payload: change('a', 'Review') });
  const task = nextTask(kit); // handed to the agent
  queueTask({ kitDir: kit, payload: change('a', 'Done') }); // arrives mid-turn
  completeTask({ kitDir: kit, task: task.id });
  assert.equal(task.id, handed.id);
  assert.deepEqual(statuses(kit), ['a:Done']);
});

test('the queue survives a restart: a task nobody completed is still there', (t) => {
  const kit = kitDir(t);
  queueTask({ kitDir: kit, payload: change('a', 'Review') });
  assert.equal(nextTask(kit).payload.sliceId, 'a');
  assert.equal(nextTask(kit).payload.sliceId, 'a'); // handing it out does not consume it
});

// ── workNextTask: one task per call, completed only when its turn finished ───────

import { workNextTask } from '../shared/build-kit/lib/slice-tasks.js';

test('with nothing queued no turn is run', async (t) => {
  const kit = kitDir(t);
  let ran = 0;
  assert.equal(await workNextTask({ kitDir: kit, meta: META, run: async () => { ran++; return true; } }), false);
  assert.equal(ran, 0);
});

test('the oldest task is handed to the turn and completed once the turn finished', async (t) => {
  const kit = kitDir(t);
  queueTask({ kitDir: kit, payload: change('a', 'Review') });
  queueTask({ kitDir: kit, payload: change('b', 'Review') });
  let handed;
  assert.equal(await workNextTask({ kitDir: kit, meta: META, run: async (task) => { handed = task; return true; } }), true);
  assert.equal(handed.payload.sliceId, 'a');
  assert.deepEqual(statuses(kit), ['b:Review']);
  assert.deepEqual(readEvents(kit).find((e) => e.type === 'task-done').meta, META);
});

test('a turn that did not finish (timed out) leaves the task queued to be handed out again', async (t) => {
  const kit = kitDir(t);
  queueTask({ kitDir: kit, payload: change('a', 'Review') });
  assert.equal(await workNextTask({ kitDir: kit, meta: META, run: async () => false }), true);
  assert.deepEqual(statuses(kit), ['a:Review']);
});

test('a turn that throws leaves the task queued and lets the error through', async (t) => {
  const kit = kitDir(t);
  queueTask({ kitDir: kit, payload: change('a', 'Review') });
  await assert.rejects(workNextTask({ kitDir: kit, meta: META, run: async () => { throw new Error('Claude exited 1'); } }), /Claude exited 1/);
  assert.deepEqual(statuses(kit), ['a:Review']);
});

test('a change that lands during the turn is kept when the handed-out task is completed', async (t) => {
  const kit = kitDir(t);
  queueTask({ kitDir: kit, payload: change('a', 'Review') });
  await workNextTask({ kitDir: kit, meta: META, run: async () => { queueTask({ kitDir: kit, payload: change('a', 'Done') }); return true; } });
  assert.deepEqual(statuses(kit), ['a:Done']);
});
