import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasPendingTasks, inTurn, writeTask } from '../shared/build-kit/lib/ralph.js';
import { quiet, tempKit } from './helpers.js';

function kit(t) {
  quiet(t);
  return tempKit(t);
}

const read = (dir) => JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf-8'));
const statuses = (dir) => read(dir).map((task) => `${task.payload.sliceId}:${task.payload.sliceStatus}`);
const change = (sliceId, sliceStatus) => ({ sliceId, sliceTitle: sliceId, sliceStatus });

test('writes the task at once when no turn is running, leaving no temp file behind', async (t) => {
  const dir = kit(t);
  await writeTask(change('a', 'Review'), dir);
  assert.deepEqual(statuses(dir), ['a:Review']);
  assert.deepEqual(readdirSync(dir), ['tasks.json']);
});

test('a newer change to the same slice replaces its queued task', async (t) => {
  const dir = kit(t);
  await writeTask(change('a', 'Review'), dir);
  await writeTask(change('b', 'Review'), dir);
  await writeTask(change('a', 'Done'), dir);
  assert.deepEqual(statuses(dir), ['b:Review', 'a:Done']);
});

test("a change arriving mid-turn survives the agent rewriting tasks.json", async (t) => {
  const dir = kit(t);
  await writeTask(change('a', 'Review'), dir);

  await inTurn(dir, async () => {
    // A slice change lands while the agent is working...
    await writeTask(change('b', 'Blocked'), dir);
    assert.deepEqual(statuses(dir), ['a:Review'], 'held, not written under the agent');
    // ...and the agent then removes the task it handled, as prompt.md tells it to.
    writeFileSync(join(dir, 'tasks.json'), '[]');
  });

  assert.deepEqual(statuses(dir), ['b:Blocked']);
});

test('only the latest held change per slice is written', async (t) => {
  const dir = kit(t);
  await inTurn(dir, async () => {
    await writeTask(change('a', 'InProgress'), dir);
    await writeTask(change('a', 'Review'), dir);
  });
  assert.deepEqual(statuses(dir), ['a:Review']);
});

test('held changes are written even when the turn fails', async (t) => {
  const dir = kit(t);
  await assert.rejects(inTurn(dir, async () => {
    await writeTask(change('a', 'Review'), dir);
    throw new Error('Claude exited 1');
  }), /Claude exited 1/);
  assert.deepEqual(statuses(dir), ['a:Review']);
});

test('an unreadable tasks.json counts as empty instead of wedging the queue', async (t) => {
  const dir = kit(t);
  writeFileSync(join(dir, 'tasks.json'), '[{"id": ');
  assert.equal(hasPendingTasks(dir), false);
  await writeTask(change('a', 'Review'), dir);
  assert.deepEqual(statuses(dir), ['a:Review']);
});
