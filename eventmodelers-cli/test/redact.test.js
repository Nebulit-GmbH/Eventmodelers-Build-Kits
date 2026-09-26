import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactConsole, redactString } from '../shared/build-kit/lib/redact.js';

const TOKEN = '3f2c9a1e-7b44-4d0e-9c1a-2b6f8e5d4c3a';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWFsdGltZS1hZ2VudCJ9.c2lnbmF0dXJlLXZhbHVl';

test('masks the API token and anything JWT-shaped', () => {
  assert.equal(
    redactString(`curl -H "x-token: ${TOKEN}" -H "Authorization: Bearer ${JWT}"`, [TOKEN]),
    'curl -H "x-token: ***" -H "Authorization: Bearer ***"',
  );
});

test('leaves ordinary text alone, including a too-short or missing secret', () => {
  const line = '[agent] slice:changed — slice="Register User" status="Done"';
  assert.equal(redactString(line, [undefined, '', 'Done']), line);
});

test('console output is masked on the way out, objects and errors included', (t) => {
  const lines = [];
  for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, (line) => lines.push(line));
  const restore = redactConsole([TOKEN]);
  t.after(restore);

  console.log('[agent] token', TOKEN);
  console.warn({ headers: { 'x-token': TOKEN } });
  console.error(new Error(`HTTP 401: Bearer ${JWT} rejected`));

  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(!line.includes(TOKEN) && !line.includes(JWT), `leaked: ${line}`);
  }
  assert.equal(lines[0], '[agent] token ***');
});

test('restore puts the original console methods back', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const wrapped = console.log;
  const restore = redactConsole([TOKEN]);
  assert.notEqual(console.log, wrapped);
  restore();
  assert.equal(console.log, wrapped);
  assert.equal(log.mock.callCount(), 0);
});
