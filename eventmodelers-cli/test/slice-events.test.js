import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, readEvents, EVENTS_DIR, INDEX_FILE } from '../shared/build-kit/lib/slice-events.js';
import { tempKit } from './helpers.js';

// Design: slice-state-test-design.md (layer C). One JSON file per event, an index log for the order.

const modulePath = fileURLToPath(new URL('../shared/build-kit/lib/slice-events.js', import.meta.url));
const indexLines = (kit) => readFileSync(join(kit, INDEX_FILE), 'utf-8').split('\n').filter(Boolean);

test('append creates the kit dir, the event file and the index, and stamps the event', (t) => {
  const kit = join(tempKit(t), 'missing', '.build-kit');
  const id = appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Planned' });
  assert.deepEqual(indexLines(kit), [id]);
  const [event] = readEvents(kit);
  assert.equal(event.type, 'board-observed');
  assert.equal(event.id, id);
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('every event is a standalone, valid JSON file', (t) => {
  const kit = tempKit(t);
  const id = appendEvent(kit, { type: 'claimed', slice: 's1', pid: 7 });
  const file = JSON.parse(readFileSync(join(kit, EVENTS_DIR, `${id}.json`), 'utf-8'));
  assert.deepEqual({ type: file.type, slice: file.slice, pid: file.pid, id: file.id }, { type: 'claimed', slice: 's1', pid: 7, id });
});

test('the event keeps the timestamp it was given, and cannot override its own id', (t) => {
  const kit = tempKit(t);
  const id = appendEvent(kit, { type: 'blocked', slice: 's1', reason: 'x', at: '2026-10-18T10:00:00.000Z', id: 'forged' });
  const [event] = readEvents(kit);
  assert.equal(event.at, '2026-10-18T10:00:00.000Z');
  assert.equal(event.id, id);
});

test('events come back in index order, not file-name order', (t) => {
  const kit = tempKit(t);
  for (const status of ['Planned', 'InProgress', 'Done']) appendEvent(kit, { type: 'board-observed', slice: 's1', status });
  assert.deepEqual(readEvents(kit).map((e) => e.status), ['Planned', 'InProgress', 'Done']);
});

test('reading a kit without a log gives no events', (t) => {
  assert.deepEqual(readEvents(tempKit(t)), []);
});

test('an event file the index does not list is never applied (crash between the two writes)', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1', pid: 1 });
  writeFileSync(join(kit, EVENTS_DIR, '11111111-1111-1111-1111-111111111111.json'), JSON.stringify({ type: 'settled', slice: 's1', status: 'Done' }));
  assert.deepEqual(readEvents(kit).map((e) => e.type), ['claimed']);
});

test('an indexed id with a missing or corrupt file is skipped, the rest still load', (t) => {
  const kit = tempKit(t);
  const first = appendEvent(kit, { type: 'claimed', slice: 's1', pid: 1 });
  const lost = appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
  const corrupt = appendEvent(kit, { type: 'settled', slice: 's1', status: 'Done' });
  appendEvent(kit, { type: 'board-observed', slice: 's1', status: 'Done' });
  rmSync(join(kit, EVENTS_DIR, `${lost}.json`));
  writeFileSync(join(kit, EVENTS_DIR, `${corrupt}.json`), '{"type":"settl');
  assert.deepEqual(readEvents(kit).map((e) => e.type), ['claimed', 'board-observed']);
  assert.equal(readEvents(kit)[0].id, first);
});

test('a crash mid-append of the index: the fragment is ignored and the next id is not glued onto it', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1', pid: 1 });
  appendFileSync(join(kit, INDEX_FILE), '3f2a9c');
  assert.deepEqual(readEvents(kit).map((e) => e.type), ['claimed']);
  appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
  assert.deepEqual(readEvents(kit).map((e) => e.type), ['claimed', 'claim-confirmed']);
});

test('an id indexed twice is applied once', (t) => {
  const kit = tempKit(t);
  const id = appendEvent(kit, { type: 'claimed', slice: 's1', pid: 1 });
  appendFileSync(join(kit, INDEX_FILE), `${id}\n`);
  assert.equal(readEvents(kit).length, 1);
});

test('append never rewrites the index or earlier event files', (t) => {
  const kit = tempKit(t);
  const id = appendEvent(kit, { type: 'claimed', slice: 's1', pid: 1 });
  const index = readFileSync(join(kit, INDEX_FILE), 'utf-8');
  const file = readFileSync(join(kit, EVENTS_DIR, `${id}.json`), 'utf-8');
  appendEvent(kit, { type: 'claim-confirmed', slice: 's1' });
  assert.ok(readFileSync(join(kit, INDEX_FILE), 'utf-8').startsWith(index));
  assert.equal(readFileSync(join(kit, EVENTS_DIR, `${id}.json`), 'utf-8'), file);
});

test('no temp files are left behind', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1', pid: 1 });
  assert.deepEqual(readdirSync(join(kit, EVENTS_DIR)).filter((f) => !f.endsWith('.json')), []);
});

test('two processes appending at the same time lose and tear nothing, whatever the event size', async (t) => {
  const kit = tempKit(t);
  const writer = (id) => new Promise((resolve, reject) => {
    // 100 KB payloads: far past what one atomic line append could carry, which is why only the id is indexed.
    const script = `import { appendEvent } from ${JSON.stringify(modulePath)};
      for (let i = 0; i < 100; i++) appendEvent(${JSON.stringify(kit)}, { type: 'agent-recorded', slice: 'p${id}', status: 'Done', seq: i, lastReply: 'x'.repeat(100_000) });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${id} exited ${code}`))));
  });
  await Promise.all([writer(1), writer(2)]);
  assert.equal(indexLines(kit).length, 200);
  const events = readEvents(kit);
  assert.equal(events.length, 200);
  for (const p of ['p1', 'p2']) {
    assert.deepEqual(events.filter((e) => e.slice === p).map((e) => e.seq), Array.from({ length: 100 }, (_, i) => i));
  }
  assert.equal(existsSync(join(kit, EVENTS_DIR)), true);
});

test('tags are stored in the event file, trimmed, de-duplicated and without blanks', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'learning-recorded', text: 'x', tags: [' api ', 'api', '', 'testing', 42, null] });
  assert.deepEqual(readEvents(kit)[0].tags, ['api', 'testing']);
});

test('an event without usable tags carries no tags field', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1', tags: ['  ', ''] });
  appendEvent(kit, { type: 'claimed', slice: 's2', tags: 'not-a-list' });
  appendEvent(kit, { type: 'claimed', slice: 's3' });
  for (const e of readEvents(kit)) assert.equal('tags' in e, false);
});

test('readEvents can filter by tag, keeping the index order', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'learning-recorded', text: 'a', tags: ['api'] });
  appendEvent(kit, { type: 'learning-recorded', text: 'b', tags: ['ui'] });
  appendEvent(kit, { type: 'learning-recorded', text: 'c', tags: ['ui', 'api'] });
  appendEvent(kit, { type: 'claimed', slice: 's1' });
  assert.deepEqual(readEvents(kit, { tag: 'api' }).map((e) => e.text), ['a', 'c']);
  assert.deepEqual(readEvents(kit, { tag: 'nope' }), []);
  assert.equal(readEvents(kit).length, 4);
});

const META = { agent_id: 'a1', organization_id: 'o1', board_id: 'b1' };

test('metadata (agent, organization, board) is stored under meta on the event', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1' }, META);
  assert.deepEqual(readEvents(kit)[0].meta, META);
});

test('blank metadata values and unknown keys are dropped; no usable metadata means no meta field', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1' }, { agent_id: ' a1 ', organization_id: '', board_id: undefined, token: 'secret' });
  appendEvent(kit, { type: 'claimed', slice: 's2' }, { agent_id: '', board_id: null });
  appendEvent(kit, { type: 'claimed', slice: 's3' });
  const [a, b, c] = readEvents(kit);
  assert.deepEqual(a.meta, { agent_id: 'a1' });
  assert.equal('meta' in b, false);
  assert.equal('meta' in c, false);
});

test('the metadata the caller passes wins over a meta field smuggled into the event', (t) => {
  const kit = tempKit(t);
  appendEvent(kit, { type: 'claimed', slice: 's1', meta: { agent_id: 'forged', board_id: 'forged' } }, META);
  appendEvent(kit, { type: 'claimed', slice: 's2', meta: { agent_id: 'forged' } });
  const [a, b] = readEvents(kit);
  assert.deepEqual(a.meta, META);
  assert.equal('meta' in b, false);
});

test('the store lives in the kit dir under fixed names', () => {
  assert.equal(EVENTS_DIR, 'events');
  assert.equal(INDEX_FILE, 'events.log');
});
