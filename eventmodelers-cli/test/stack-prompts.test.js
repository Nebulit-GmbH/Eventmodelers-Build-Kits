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
