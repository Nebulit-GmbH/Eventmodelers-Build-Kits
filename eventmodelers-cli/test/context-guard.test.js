import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPromptTooLong, shouldCompact, contextWindow, DEFAULT_CONTEXT_WINDOW } from '../lib/context-guard.js';

test('recognises the context-overflow errors of a turn', () => {
  assert.equal(isPromptTooLong(new Error('Prompt is too long')), true);
  assert.equal(isPromptTooLong('prompt is too long: 213000 tokens > 200000 maximum'), true);
  assert.equal(isPromptTooLong(new Error('claude process exited (1) mid-turn')), false);
  assert.equal(isPromptTooLong(undefined), false);
});

test('compacts once the conversation passes three quarters of the window', () => {
  assert.equal(shouldCompact(100000), false);
  assert.equal(shouldCompact(150000), true);
  assert.equal(shouldCompact(null), false);
  assert.equal(shouldCompact(80000, 100000), true);
});

test('the window can be overridden from the environment', () => {
  assert.equal(contextWindow({}), DEFAULT_CONTEXT_WINDOW);
  assert.equal(contextWindow({ EVENTMODELERS_CONTEXT_WINDOW: '1000000' }), 1000000);
  assert.equal(contextWindow({ EVENTMODELERS_CONTEXT_WINDOW: 'x' }), DEFAULT_CONTEXT_WINDOW);
});
