import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

export async function writeTask(prompts, cwd) {
  const tasksPath = resolve(cwd, 'tasks.json');

  const existing = existsSync(tasksPath)
    ? JSON.parse(readFileSync(tasksPath, 'utf-8'))
    : [];

  const task = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    prompts,
  };

  existing.push(task);
  writeFileSync(tasksPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`[agent] Task ${task.id} written with ${prompts.length} prompt(s)`);
}