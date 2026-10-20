import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents } from '../shared/build-kit/lib/slice-events.js';
import { parseTurnInfos, recordTurnInfos } from '../shared/build-kit/lib/slice-info.js';
import { tempKit } from './helpers.js';

const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], {
  cwd: root, encoding: 'utf-8', env: { ...process.env, RALPH_AGENT_ID: 'agent-7', EVENTMODELERS_TOKEN: '', FORCE_COLOR: '0' },
});

test('info records an info-recorded event with kind, stamped with the agent', (t) => {
  const root = tempKit(t);
  const kit = join(root, '.build-kit');
  mkdirSync(kit, { recursive: true });
  const res = run(root, 'info', 'cannot change the schema: owned by another team', '--kind', 'limitation');
  assert.equal(res.status, 0, res.stderr);
  const [event] = readEvents(kit);
  assert.equal(event.type, 'info-recorded');
  assert.equal(event.kind, 'limitation');
  assert.equal(event.meta.agent_id, 'agent-7');
});

test('info rejects an unknown kind', (t) => {
  const root = tempKit(t);
  mkdirSync(join(root, '.build-kit'), { recursive: true });
  assert.notEqual(run(root, 'info', 'x', '--kind', 'bogus').status, 0);
});

test('Info lines in a reply are parsed, capped and recorded; fenced ones are not', (t) => {
  assert.deepEqual(parseTurnInfos('done\nInfo [limitation]: no access to X\n- Info: plain note\n```\nInfo: fenced\n```\nInfo [none]: none'),
    [{ kind: 'limitation', text: 'no access to X' }, { kind: 'note', text: 'plain note' }, { kind: 'note', text: 'none' }].slice(0, 2));
  const kit = join(tempKit(t), '.agent-modeling-kit');
  assert.equal(recordTurnInfos({ kitDir: kit, reply: 'Info [decision]: kept the name', meta: { agent_type: 'MODELING' } }), 1);
  assert.equal(readEvents(kit)[0].kind, 'decision');
});
