import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel } from '../extensions/eventcatalog/model.js';
import { toJsonSchema, toResources } from '../extensions/eventcatalog/render.js';
import { run, check, loadFromLocal, loadSdk, isCatalog } from '../extensions/eventcatalog/index.js';
import { describeChange } from '../extensions/eventcatalog/manifest.js';

const field = (name, extra = {}) => ({ name, type: 'String', cardinality: 'Single', optional: false, subfields: [], ...extra });
const el = (id, title, fields, dependencies = []) => ({ id, title, fields, dependencies, description: '' });
const dep = (id, title, elementType, type) => ({ id, title, elementType, type });

const slices = [
  {
    index: 0, title: 'Place', context: 'Orders', chapter: 'Orders',
    commands: [el('c1', 'Place Order', [field('orderId')], [dep('e1', 'Order Placed', 'EVENT', 'OUTBOUND')])],
    events: [el('e1', 'Order Placed', [field('orderId')], [dep('c1', 'Place Order', 'COMMAND', 'INBOUND'), dep('r1', 'Open Orders', 'READMODEL', 'OUTBOUND')])],
    readmodels: [], processors: [], screens: [],
  },
  {
    index: 1, title: 'Open', context: 'Orders', chapter: 'Orders',
    commands: [], events: [el('e2', 'order placed', [field('orderId'), field('extra', { optional: true })])],
    readmodels: [el('r1', 'Open Orders', [field('orderId'), field('lines', { cardinality: 'List', subfields: [field('sku')] })], [dep('e1', 'Order Placed', 'EVENT', 'INBOUND'), dep('p1', 'Shipper', 'AUTOMATION', 'OUTBOUND')])],
    processors: [el('p1', 'Shipper', [], [dep('r1', 'Open Orders', 'READMODEL', 'INBOUND'), dep('c2', 'Ship Order', 'COMMAND', 'OUTBOUND'), dep('x', 'ghost', 'SCREEN', 'INBOUND')])],
    screens: [],
  },
];
slices[1].commands.push(el('c2', 'Ship Order', [field('orderId')]));

test('merges duplicate events by normalised title and unions their fields', () => {
  const m = buildModel(slices);
  assert.equal(m.events.length, 1);
  assert.deepEqual(m.events[0].fields.map((f) => f.name), ['orderId', 'extra']);
  assert.equal(m.events[0].id, 'OrderPlaced');
});

test('read models become queries; processors (automations) are not exported', () => {
  const m = buildModel(slices);
  assert.deepEqual(m.queries.map((q) => q.id), ['OpenOrders']);
  assert.equal(m.services, undefined);
  // the command the processor issued is still a message of the model
  assert.ok(m.commands.some((c) => c.id === 'ShipOrder'));
});

test('one flow per chapter, steps linked by dependencies', () => {
  const m = buildModel(slices);
  assert.equal(m.flows.length, 1);
  const step = m.flows[0].steps.find((s) => s.id === 'command-PlaceOrder');
  assert.deepEqual(step.next, ['event-OrderPlaced']);
});

test('fields convert to JSON Schema', () => {
  const s = toJsonSchema([field('a'), field('b', { optional: true, type: 'Date' }), field('l', { cardinality: 'List', subfields: [field('sku')] })]);
  assert.deepEqual(s.required, ['a', 'l']);
  assert.deepEqual(s.properties.b, { type: 'string', format: 'date' });
  assert.equal(s.properties.l.type, 'array');
  assert.equal(s.properties.l.items.properties.sku.type, 'string');
});

// A stand-in for the SDK's `utils(catalogDir)`: remembers what it was asked to write.
function fakeSdk() {
  const store = new Map();
  const calls = [];
  const factory = () => new Proxy({}, {
    get: (_, name) => async (...args) => {
      if (/HasVersion$/.test(name)) return store.has(`${name.replace('HasVersion', '')}:${args[0]}`);
      const write = /^write(\w+)$/.exec(name);
      if (write) { store.set(`${write[1].toLowerCase()}:${args[0].id}`, args[0]); calls.push({ name, id: args[0].id, override: args[1]?.override }); return; }
      const schema = /^addSchemaTo(\w+)$/.exec(name);
      if (schema) { calls.push({ name, id: args[0], fileName: args[1].fileName }); return; }
      throw new Error(`unexpected SDK call ${name}`);
    },
  });
  return { factory, calls, store };
}

test('writes through the SDK; existing resources are skipped unless forced', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ec-sdk-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const sdk = fakeSdk();
  const first = await run({ slices, outDir: out, sdk: sdk.factory });
  assert.ok(first.written.includes('events/OrderPlaced') && first.written.includes('queries/OpenOrders') && first.written.includes('domains/Orders'));
  assert.equal(first.skipped.length, 0);
  assert.ok(sdk.calls.some((c) => c.name === 'addSchemaToQuery' && c.id === 'OpenOrders' && c.fileName === 'schema.json'));
  assert.ok(sdk.calls.every((c) => !c.override));

  sdk.calls.length = 0;
  const second = await run({ slices, outDir: out, sdk: sdk.factory });
  assert.equal(second.written.length, 0);
  assert.ok(second.skipped.includes('events/OrderPlaced'));
  assert.equal(sdk.calls.length, 0);

  const forced = await run({ slices, outDir: out, sdk: sdk.factory, force: true });
  assert.equal(forced.skipped.length, 0);
  assert.ok(sdk.calls.filter((c) => c.name.startsWith('write')).every((c) => c.override === true));
});

test('toResources builds SDK-shaped resources', () => {
  const r = toResources(buildModel(slices));
  assert.equal(r.domain.resource.services, undefined);
  assert.equal(r.services, undefined);
  assert.deepEqual(r.domain.resource.flows, [{ id: 'OrdersFlow' }]);
  const step = r.flows[0].resource.steps.find((x) => x.id === 'command-PlaceOrder');
  assert.deepEqual(step, { id: 'command-PlaceOrder', title: 'Place Order', message: { id: 'PlaceOrder' }, next_step: 'event-OrderPlaced' });
  assert.ok(r.queries[0].schema.includes('"lines"'));
});

test('loadSdk is null when the catalog has no SDK', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ec-nosdk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), '{}');
  assert.equal(await loadSdk(dir), null);
});

test('loadFromLocal reads config.json and .slices/ folders', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ec-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ slices }));
  assert.equal(loadFromLocal({ cwd: dir, local: true }).length, 2);
  assert.equal(loadFromLocal({ cwd: dir, local: true, context: 'nope' }).length, 0);
  mkdirSync(join(dir, '.slices/Orders/place'), { recursive: true });
  writeFileSync(join(dir, '.slices/Orders/place/slice.json'), JSON.stringify(slices[0]));
  assert.equal(loadFromLocal({ cwd: dir, local: true }).length, 1); // .slices wins over config.json
  assert.throws(() => loadFromLocal({ cwd: join(dir, 'missing'), local: true }), /No local slices/);
  assert.ok(existsSync(dir));
});

test('screens and processors are not exported', () => {
  const withScreen = structuredClone(slices);
  withScreen[0].screens = [el('sc', 'Orders Screen', [field('a')], [dep('c1', 'Place Order', 'COMMAND', 'OUTBOUND')])];
  const m = buildModel(withScreen);
  assert.equal(m.services, undefined);
  assert.ok(m.flows[0].steps.every((s) => !s.id.startsWith('service-')));
});

test('--owner sets owners on every resource', () => {
  const r = toResources(buildModel(slices), { owners: ['team-a', 'jane'] });
  const all = [...r.events, ...r.commands, ...r.queries, ...r.flows, r.domain];
  assert.ok(all.length > 5 && all.every((x) => JSON.stringify(x.resource.owners) === '["team-a","jane"]'));
  assert.ok(toResources(buildModel(slices)).domain.resource.owners === undefined);
});

test('isCatalog recognises an EventCatalog project and nothing else', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ec-iscat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(isCatalog(dir), false);
  writeFileSync(join(dir, 'package.json'), '{"dependencies":{"express":"1"}}');
  assert.equal(isCatalog(dir), false);
  writeFileSync(join(dir, 'package.json'), '{"dependencies":{"@eventcatalog/core":"5.5.2"}}');
  assert.equal(isCatalog(dir), true);
  rmSync(join(dir, 'package.json'));
  writeFileSync(join(dir, 'eventcatalog.config.js'), 'export default {}');
  assert.equal(isCatalog(dir), true);
});

test('--check compares the model with the manifest written by the last export', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ec-check-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const never = check({ slices, outDir: out });
  assert.equal(never.inSync, false);
  assert.ok(never.new.includes('events/OrderPlaced') && never.changed.length === 0);

  await run({ slices, outDir: out, sdk: fakeSdk().factory });
  assert.equal(check({ slices, outDir: out }).inSync, true);

  // an event gains a field → that event is "changed", the rest is untouched
  const changed = structuredClone(slices);
  changed[0].events[0].fields.push(field('currency'));
  const diff = check({ slices: changed, outDir: out });
  assert.deepEqual(diff.changed, [{ label: 'events/OrderPlaced', changes: ['+ field currency (String)'] }]);
  assert.equal(diff.inSync, false);

  // an element disappears → "removed"
  const fewer = structuredClone(slices);
  fewer[1].commands = [];
  assert.ok(check({ slices: fewer, outDir: out }).removed.includes('commands/ShipOrder'));

  const sdk = fakeSdk();
  await run({ slices: changed, outDir: out, sdk: sdk.factory }); // nothing in the fake store → written
  assert.equal(check({ slices: changed, outDir: out }).inSync, true);
});

test('a skipped resource is not recorded in the manifest', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ec-skip-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const sdk = fakeSdk();
  await run({ slices, outDir: out, sdk: sdk.factory });
  const changed = structuredClone(slices);
  changed[0].events[0].fields.push(field('currency'));
  const r = await run({ slices: changed, outDir: out, sdk: sdk.factory }); // exists in the fake store → skipped
  assert.ok(r.skipped.includes('events/OrderPlaced'));
  assert.deepEqual(check({ slices: changed, outDir: out }).changed.map((c) => c.label), ['events/OrderPlaced']);
});

test('describeChange reports structural changes only', () => {
  const f = (name, extra = {}) => ({ name, type: 'String', cardinality: 'Single', optional: false, ...extra });
  const before = { name: 'Order Placed', summary: 'old', fields: [f('a'), f('b'), f('c')] };
  const after = { name: 'Order Was Placed', summary: 'new', fields: [f('a', { type: 'Date' }), f('c', { optional: true }), f('d', { cardinality: 'List' })] };
  assert.deepEqual(describeChange(before, after), [
    'name: "Order Placed" → "Order Was Placed"',
    'summary: "old" → "new"',
    '~ field a: type String → Date',
    '~ field c: now optional',
    '+ field d (String List)',
    '- field b',
  ]);
  // no description in the model → the summary is not ours, so it never shows up as a change
  assert.deepEqual(describeChange({ ...before, summary: 'hand written' }, { ...before, summary: null }), []);
  // flow steps
  const steps = (next) => ({ name: 'F', steps: [{ id: 'a', title: 'A', keys: ['ka'], next }] });
  assert.deepEqual(describeChange(steps([{ id: 'b', keys: ['kb'] }]), steps([{ id: 'c', keys: ['kc'] }])), ['~ step a: next b → c']);
  // the same target under a new id is not a change of the link
  assert.deepEqual(describeChange(steps([{ id: 'b', keys: ['kb'] }]), steps([{ id: 'b2', keys: ['kb'] }])), []);
});

test('--check recognises a rename by the board element id', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ec-rename-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  await run({ slices, outDir: out, sdk: fakeSdk().factory, flows: true });
  const renamed = structuredClone(slices);
  renamed[0].events[0].title = 'Order Was Placed'; // same element id e1 …
  renamed[1].events[0].title = 'Order Was Placed'; // … and its copy e2 in the other slice
  const diff = check({ slices: renamed, outDir: out, flows: true });
  assert.deepEqual(diff.new, []);
  assert.deepEqual(diff.removed, []);
  const ev = diff.changed.find((c) => c.label === 'events/OrderWasPlaced');
  assert.equal(ev.renamedFrom, 'events/OrderPlaced');
  assert.deepEqual(ev.changes.slice(0, 2), ['id: OrderPlaced → OrderWasPlaced', 'name: "Order Placed" → "Order Was Placed"']);
  // the flow follows: the step is renamed, its neighbours' links are not reported as changed
  const flow = diff.changed.find((c) => c.label === 'flows/OrdersFlow');
  assert.ok(flow.changes.includes('~ step event-OrderPlaced → event-OrderWasPlaced'));
  assert.ok(!flow.changes.some((c) => c.startsWith('~ step command-PlaceOrder')));

  // a genuinely new element with an unrelated id is still new
  const added = structuredClone(slices);
  added[0].events.push(el('e9', 'Order Shipped', []));
  assert.deepEqual(check({ slices: added, outDir: out, flows: true }).new, ['events/OrderShipped']);
});

test('flows are left out unless asked for', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ec-noflows-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const { written } = await run({ slices, outDir: out, sdk: fakeSdk().factory });
  assert.ok(!written.some((l) => l.startsWith('flows/')));
  assert.ok(written.some((l) => l.startsWith('events/')));
  const withFlows = await run({ slices, outDir: out, sdk: fakeSdk().factory, flows: true, force: true });
  assert.ok(withFlows.written.some((l) => l.startsWith('flows/')));
});
