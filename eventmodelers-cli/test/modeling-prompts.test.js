import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTurnLearnings } from '../shared/build-kit/lib/slice-learnings.js';

// The modeling agent has no progress.txt: it states learnings as `Learning [topic]: text` lines at the end
// of a reply and the CLI records them (its Bash is an allowlist, so it cannot run `learn` itself).

const kit = fileURLToPath(new URL('../stacks/modeling-kit/templates/kit', import.meta.url));
const claude = readFileSync(join(kit, 'CLAUDE.md'), 'utf-8');
const prompts = readFileSync(join(kit, 'CLAUDE-PROMPTS.md'), 'utf-8');
const chat = readFileSync(join(kit, 'CLAUDE-CHAT.md'), 'utf-8');
const standalone = readFileSync(join(kit, 'CLAUDE-STANDALONE.md'), 'utf-8');

test('the modeling prompts no longer send the agent to progress.txt', () => {
  for (const [name, text] of [['CLAUDE.md', claude], ['CLAUDE-PROMPTS.md', prompts], ['CLAUDE-CHAT.md', chat], ['CLAUDE-STANDALONE.md', standalone]]) {
    assert.doesNotMatch(text, /progress\.txt|Progress Entry Format|progress entry/i, name);
  }
});

test('the prompt teaches the Learning line the CLI records, and not to write it into a file', () => {
  assert.match(prompts, /`Learning \[<topic>\]: <one terse line>`/);
  assert.match(prompts, /The CLI records them — never write them into a file yourself/);
  assert.match(claude, /standalone=on/);
});

test('the format the prompt documents is the one the CLI parses', () => {
  assert.deepEqual(parseTurnLearnings('Added the event.\nLearning [Modeling]: events are past tense\n<promise>DONE</promise>'), [{ topic: 'Modeling', text: 'events are past tense' }]);
});

test('the prompt\'s steps still end in the DONE reply, numbered consecutively', () => {
  assert.match(prompts, /\n8\. \*\*`standalone=off` only\*\*/);
  assert.match(prompts, /\n9\. Reply `<promise>DONE<\/promise>` and wait for the next turn\./);
  assert.doesNotMatch(prompts, /\n10\. Reply/);
});

test('a self-directed (standalone=on) turn records nothing', () => {
  assert.match(standalone, /no\s+`Learning:` lines in your reply/);
});

// The core file stays small because each kind of turn has its steps in a file of its own, read the first time that kind
// arrives. That only works if every file the kit points at is there, and the CLI's turn text points at real ones.
test('every kit file the instructions point at exists', () => {
  const texts = [claude, prompts, chat, standalone, readFileSync(join(kit, 'references', 'chat-kinds.md'), 'utf-8')];
  for (const text of texts) {
    for (const [, rel] of text.matchAll(/\.agent-modeling-kit\/((?:references\/)?[A-Za-z-]+\.md)/g)) {
      assert.ok(existsSync(join(kit, rel)), `${rel} is referenced but not in the kit`);
    }
  }
});

test('the core file routes each kind of turn to its own steps', () => {
  for (const [first, file] of [['prompt_id=', 'CLAUDE-PROMPTS.md'], ['CHAT message_id=', 'CLAUDE-CHAT.md'], ['BOARD_CHANGE', 'CLAUDE-STANDALONE.md']]) {
    assert.match(claude, new RegExp(`\\| \`${first}[^|]*\\|[^|]*\\| \`\\.agent-modeling-kit/${file}\``), `${first} -> ${file}`);
  }
});

test('the CLI points every prompt and chat turn at the file with its steps', () => {
  const cli = readFileSync(fileURLToPath(new URL('../cli.js', import.meta.url)), 'utf-8');
  assert.match(cli, /turnSteps\('CLAUDE-PROMPTS\.md'\)/);
  assert.match(cli, /turnSteps\('CLAUDE-CHAT\.md'\)/);
  assert.match(cli, /see \.agent-modeling-kit\/CLAUDE-CHAT\.md/);
});
