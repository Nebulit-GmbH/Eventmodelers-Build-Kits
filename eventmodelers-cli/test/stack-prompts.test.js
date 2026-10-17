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
