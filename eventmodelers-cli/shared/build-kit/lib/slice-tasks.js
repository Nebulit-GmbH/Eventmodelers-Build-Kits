// The task queue is the event log: the realtime agent queues a slice change as `task-queued`, the loop replays
// the log to find the oldest task still waiting, hands it to the agent, and appends `task-done` when the turn is
// over. Nobody reads or rewrites a queue file, so there is nothing for two writers to collide on — a change that
// lands mid-turn is just another event, and `task-done` names the task by id.

import { appendEvent, readEvents } from './slice-events.js';
import { fold } from './slice-state.js';

// `payload` is the slice change ({ sliceId, sliceTitle, sliceStatus, ... }). Returns { id } of the task.
export function queueTask({ kitDir, payload, meta }) {
  return { id: appendEvent(kitDir, { type: 'task-queued', payload }, meta) };
}

export function pendingTasks(kitDir) {
  return fold(readEvents(kitDir)).tasks;
}

// The oldest task waiting, or null. Handing it out does not consume it — `completeTask` does.
export function nextTask(kitDir) {
  return pendingTasks(kitDir)[0] ?? null;
}

export function completeTask({ kitDir, task, meta }) {
  appendEvent(kitDir, { type: 'task-done', task }, meta);
}

// One turn for the oldest waiting task. `run(task)` is the agent turn and says whether it finished (false: it
// timed out — the task stays queued and is handed out again; a turn that throws leaves it queued too). The
// task is completed only after a finished turn. Returns whether a task was worked.
export async function workNextTask({ kitDir, meta, run }) {
  const task = nextTask(kitDir);
  if (!task) return false;
  if (await run(task)) completeTask({ kitDir, task: task.id, meta });
  return true;
}
