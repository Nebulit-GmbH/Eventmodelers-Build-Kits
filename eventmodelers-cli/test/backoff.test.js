import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs } from '../shared/build-kit/lib/backoff.js';

const opts = { baseMs: 1_000, capMs: 60_000 };

test('doubles per attempt, starting at baseMs', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  assert.deepEqual([1, 2, 3, 4].map((a) => backoffMs(a, opts)), [1_000, 2_000, 4_000, 8_000]);
});

test('keeps half of every delay fixed, randomizes the other half', (t) => {
  t.mock.method(Math, 'random', () => 0);
  assert.equal(backoffMs(3, opts), 2_000); // ceiling 4000 → at least half of it
});

test('never exceeds capMs, however many attempts', (t) => {
  t.mock.method(Math, 'random', () => 0.999999);
  assert.equal(backoffMs(50, opts), 60_000);
  assert.equal(backoffMs(1_000, opts), 60_000);
});
