import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ralph.js feeds prompt.md to onTask and backend-prompt.md to onPlannedSlice.
// Swapped, a Planned slice is never claimed and the loop rebuilds it forever.
const stacksDir = fileURLToPath(new URL('../stacks', import.meta.url));
const stacks = readdirSync(stacksDir).filter((s) => existsSync(join(stacksDir, s, 'templates/build-kit/lib/prompt.md')));

const firstLine = (stack, file) => readFileSync(join(stacksDir, stack, 'templates/build-kit/lib', file), 'utf-8').split('\n')[0];

test('finds the build-kit stacks', () => {
  assert.ok(stacks.length > 0);
});

for (const stack of stacks) {
  test(`${stack}: prompt.md is the task flow, backend-prompt.md the build flow`, () => {
    assert.equal(firstLine(stack, 'prompt.md'), '# Agent Task Instructions');
    assert.equal(firstLine(stack, 'backend-prompt.md'), '# Ralph Agent Instructions');
  });
}

// The run loop claims a slice and pushes its final status; the build agent only records its outcome
// (`slice-status`). Prompts for loop-built slices must not tell the agent to claim or push anything
// itself — a claim it makes is always rejected (the loop got there first), and the prompt's "claim
// conflict" advice would then send it off to the next slice with nothing built.
for (const stack of stacks) {
  test(`${stack}: the build flow leaves slice status to the run loop and records the outcome with slice-status`, () => {
    const dir = join(stacksDir, stack, 'templates/build-kit');
    const backend = readFileSync(join(dir, 'lib/backend-prompt.md'), 'utf-8');
    assert.match(backend, /do not call `update-slice-status`/);
    assert.match(backend, /npx @eventmodelers\/cli slice-status Done/);
    assert.doesNotMatch(backend, /Set the status "InProgress"/);
    assert.doesNotMatch(backend, /Claim conflict/);
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'), /do not call `update-slice-status`/);
    assert.match(readFileSync(join(dir, 'lib/AGENT.md'), 'utf-8'), /run loop owns its status/);
  });
}

// progress.txt is gone: learnings are events (`learn`), AGENTS.md is generated from them, what a failed
// attempt tried is in slice.json's `lastAttempt`, assumptions are code comments. A prompt or skill that
// still tells the agent to write progress.txt sends it to a file nothing reads. (The modeling kit is not a
// build kit; it states its learnings in its reply — see modeling-prompts.test.js.)
const buildKitFiles = (stack) => {
  const root = join(stacksDir, stack, 'templates');
  const files = [join(root, 'build-kit/CLAUDE.md'), join(root, 'build-kit/lib/prompt.md'), join(root, 'build-kit/lib/backend-prompt.md'), join(root, 'build-kit/lib/AGENT.md')];
  const skills = join(root, '.claude/skills');
  if (existsSync(skills)) for (const d of readdirSync(skills)) if (existsSync(join(skills, d, 'SKILL.md'))) files.push(join(skills, d, 'SKILL.md'));
  return files.filter((f) => existsSync(f));
};

for (const stack of stacks) {
  test(`${stack}: no prompt or skill sends the agent to progress.txt`, () => {
    for (const file of buildKitFiles(stack)) assert.doesNotMatch(readFileSync(file, 'utf-8'), /progress\.txt|progress log/i, file);
  });

  test(`${stack}: the build prompt teaches learn, retract and lastAttempt`, () => {
    const backend = readFileSync(join(stacksDir, stack, 'templates/build-kit/lib/backend-prompt.md'), 'utf-8');
    assert.match(backend, /npx @eventmodelers\/cli learn "/);
    assert.match(backend, /learn --retract/);
    assert.match(backend, /learnings --ids/);
    assert.match(backend, /`lastAttempt`/);
    assert.match(readFileSync(join(stacksDir, stack, 'templates/build-kit/CLAUDE.md'), 'utf-8'), /npx @eventmodelers\/cli learn/);
  });
}

test('the shared request-feedback skill does not send the agent to progress.txt', () => {
  const skill = readFileSync(join(stacksDir, '..', 'shared/skills/request-feedback/SKILL.md'), 'utf-8');
  assert.doesNotMatch(skill, /progress\.txt/);
});

// There is no tasks.json: the loop replays the event log, hands the agent the oldest queued task in the task
// request and completes it when the turn ends. A prompt that still tells the agent to read the file, remove
// its task from it or reply IDLE sends it to a queue that does not exist.
for (const stack of stacks) {
  test(`${stack}: the task prompt works from the task request, not a queue file`, () => {
    const dir = join(stacksDir, stack, 'templates/build-kit');
    const prompt = readFileSync(join(dir, 'lib/prompt.md'), 'utf-8');
    for (const f of [prompt, readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'), readFileSync(join(dir, 'lib/AGENT.md'), 'utf-8')]) {
      assert.doesNotMatch(f, /tasks\.json/);
    }
    assert.match(prompt, /task request/);
    assert.match(prompt, /never read or write a queue file/);
    assert.doesNotMatch(prompt, /<promise>IDLE<\/promise>/);
    assert.doesNotMatch(prompt, /## Updating AGENT\.md/);
  });
}

test('the shared ui-contract skill speaks of queued tasks, not tasks.json', () => {
  const skill = readFileSync(join(stacksDir, '..', 'shared/skills/ui-contract/SKILL.md'), 'utf-8');
  assert.doesNotMatch(skill, /tasks\.json/);
});
