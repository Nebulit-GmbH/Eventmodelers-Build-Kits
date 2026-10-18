import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTurnLearnings } from '../shared/build-kit/lib/slice-learnings.js';

// The modeling agent has no progress.txt: it states learnings as `Learning [topic]: text` lines at the end
// of a reply and the CLI records them (its Bash is an allowlist, so it cannot run `learn` itself).

const kit = fileURLToPath(new URL('../stacks/modeling-kit/templates/kit', import.meta.url));
const claude = readFileSync(join(kit, 'CLAUDE.md'), 'utf-8');
const standalone = readFileSync(join(kit, 'CLAUDE-STANDALONE.md'), 'utf-8');

test('the modeling prompts no longer send the agent to progress.txt', () => {
  for (const [name, text] of [['CLAUDE.md', claude], ['CLAUDE-STANDALONE.md', standalone]]) {
    assert.doesNotMatch(text, /progress\.txt|Progress Entry Format|progress entry/i, name);
  }
});

test('the prompt teaches the Learning line the CLI records, and not to write it into a file', () => {
  assert.match(claude, /`Learning \[<topic>\]: <one terse line>`/);
  assert.match(claude, /The CLI records them — never write them into a file yourself/);
  assert.match(claude, /standalone=on/);
});

test('the format the prompt documents is the one the CLI parses', () => {
  assert.deepEqual(parseTurnLearnings('Added the event.\nLearning [Modeling]: events are past tense\n<promise>DONE</promise>'), [{ topic: 'Modeling', text: 'events are past tense' }]);
});

test('the prompt\'s steps still end in the DONE reply, numbered consecutively', () => {
  assert.match(claude, /\n8\. \*\*`standalone=off` only\*\*/);
  assert.match(claude, /\n9\. Reply `<promise>DONE<\/promise>` and wait for the next turn\./);
  assert.doesNotMatch(claude, /\n10\. Reply/);
});

test('a self-directed (standalone=on) turn records nothing', () => {
  assert.match(standalone, /no\s+`Learning:` lines in your reply/);
});
