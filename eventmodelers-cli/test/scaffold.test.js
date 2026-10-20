import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supervise } from '../lib/supervise.js';
import { findBuildKitDirs } from '../lib/build-kits.js';
import { SCAFFOLD_TYPES, builtInTemplates, initTemplates, invocation, missingPrerequisites, probe, pickPorts, reinitKits, runScaffold, targetState } from '../lib/scaffold.js';
import { buildModel, isHomeScreen, routeFrom } from '../lib/scaffold-model.js';

const supabase = SCAFFOLD_TYPES.supabase;

test('the supabase type installs the supabase and supabase-react kits, in that order', () => {
  assert.deepEqual(supabase.kits.map((k) => [k.stack, k.dir]), [['supabase', '.'], ['supabase-react', 'web']]);
});

test('the supabase type asks for no helper tool beyond the stack itself', () => {
  assert.deepEqual(supabase.tools.map((t) => t.command), ['docker', 'supabase', 'flyway', 'java']);
});

test('missing prerequisites name every absent tool and an old node', () => {
  const none = missingPrerequisites(supabase, { nodeVersion: '20.1.0', has: () => false });
  assert.equal(none.length, supabase.tools.length + 1);
  assert.match(none[0], /Node 22/);
  assert.deepEqual(missingPrerequisites(supabase, { nodeVersion: '22.0.0', has: () => true }), []);
});

test('ports skip a busy api port and a supabase prefix with any busy port', async () => {
  const busy = new Set([3100, 56425]);
  const ports = await pickPorts(supabase.ports, { free: async (p) => !busy.has(p) });
  assert.deepEqual(ports, { api: '3101', web: '5273', db: '565' });
});

test('a port with no free value in its range is an error naming it', async () => {
  await assert.rejects(pickPorts([{ name: 'api', start: 1, limit: 3 }], { free: async () => false }), /"api"/);
});

test('an unknown pinned port is refused before anything is written', async () => {
  await assert.rejects(
    runScaffold({ typeName: 'supabase', target: join(tmpdir(), 'scaffold-never'), cfg: {}, model: {}, cliPath: 'x', ports: { nope: '1' } }),
    /unknown port "nope".*api, web, db/,
  );
});

test('npm and npx go through a shell on Windows only', () => {
  assert.deepEqual(invocation('npm', ['--prefix', 'web', 'install'], 'win32'), { file: 'npm --prefix web install', args: [], shell: true });
  assert.deepEqual(invocation('git', ['init'], 'win32'), { file: 'git', args: ['init'], shell: false });
  assert.deepEqual(invocation('npm', ['install'], 'darwin'), { file: 'npm', args: ['install'], shell: false });
});

test('the PATH probe is `where` on Windows and `command -v` elsewhere', () => {
  assert.deepEqual(probe('docker', 'win32'), { file: 'where', args: ['docker'] });
  assert.equal(probe('docker', 'linux').file, 'sh');
});

test('targetState: new, skeleton, foreign', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(targetState(join(dir, 'missing')), 'new');
  assert.equal(targetState(dir), 'new');
  writeFileSync(join(dir, 'file.txt'), 'x');
  assert.equal(targetState(dir), 'foreign');
  writeFileSync(join(dir, 'skeleton.json'), '{}');
  assert.equal(targetState(dir), 'skeleton');
});

test('route and home come only from what the description states', () => {
  assert.equal(routeFrom('Shows orders. route /orders/:orderId.'), '/orders/:orderId');
  assert.equal(routeFrom('no route here'), undefined);
  assert.ok(isHomeScreen('This is the home page'));
  assert.ok(isHomeScreen('The page shown after sign-in'));
  assert.ok(!isHomeScreen('Lists orders'));
});

test('buildModel reads timelines, slices (deduped across timelines), screens and css', async () => {
  const outline = { slices: [
    { id: 's1', title: 'OrderList', sliceType: 'STATE_VIEW', chapter: 'Orders', screens: [{ id: 'n1', title: 'Orders Page', type: 'SCREEN' }] },
    { id: 's2', title: 'PlaceOrder', sliceType: 'STATE_CHANGE', chapter: 'Orders', screens: [{ id: 'n1', title: 'Orders Page', type: 'SCREEN' }] },
  ] };
  const api = {
    get: async (path) => (path === '/chapters/bounds'
      ? { chapters: [{ id: 'c1', title: 'Orders', x: 1, y: 2 }, { id: 'c2', title: 'More Orders', x: 1, y: 9 }] }
      : outline),
    post: async (path, body) => {
      assert.equal(path, '/nodes/query');
      assert.deepEqual(body.ids, ['n1']);
      return [{ id: 'n1', description: 'route /orders, the home page', meta: { pages: ['<nav class="navbar is-primary"></nav>'] } }];
    },
  };
  const model = await buildModel({ api, appTitle: 'Shop' });
  assert.equal(model.css, 'bulma');
  assert.equal(model.appTitle, 'Shop');
  assert.equal(model.slices.length, 2);
  assert.deepEqual(model.screens, [{ title: 'Orders Page', route: '/orders', home: true }]);
  assert.deepEqual(model.timelines.map((t) => t.title), ['Orders', 'More Orders']);
});

test('the supabase generator writes the skeleton overlay from a model', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-gen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel, content) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), content); };
  // The minimum the kits leave behind that the generator patches.
  write('package.json', '{"scripts":{}}');
  write('tsconfig.json', '{}');
  write('server.ts', '');
  write('supabase/config.toml', 'project_id = "x"\nsite_url = "http://localhost:3000"\nadditional_redirect_urls = []\n');
  write('web/package.json', '{"dependencies":{},"scripts":{}}');
  write('web/src/lib/api.ts', '');
  const model = {
    appTitle: 'Shop', css: 'none',
    timelines: [{ title: 'Orders', x: 0, y: 0 }],
    slices: [
      { title: 'Place Order', sliceType: 'STATE_CHANGE', chapter: 'Orders', screens: ['Orders Page'] },
      { title: 'Order List', sliceType: 'STATE_VIEW', chapter: 'Orders', screens: ['Orders Page'] },
    ],
    screens: [{ title: 'Orders Page', route: '/orders' }],
  };
  write('model.json', JSON.stringify(model));
  execFileSync(process.execPath, [supabase.generator, '--model', join(dir, 'model.json'), '--target', dir, '--api-port', '3100', '--web-port', '5273', '--db-port-prefix', '564'], { stdio: 'ignore' });
  const endpoints = readFileSync(join(dir, 'src/common/modeledEndpoints.ts'), 'utf8');
  assert.match(endpoints, /'POST placeorder'/);
  assert.match(endpoints, /'GET query\/orderlist-collection'/);
  assert.ok(existsSync(join(dir, 'web/src/pages/OrdersPage.tsx')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'skeleton.json'), 'utf8')).apiPort, 3100);
  // Runs on Node alone: one script behind npm scripts, no just/foreman files.
  assert.ok(existsSync(join(dir, 'scripts/dev.mjs')));
  assert.ok(!existsSync(join(dir, 'justfile')) && !existsSync(join(dir, 'Procfile')));
  const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts;
  for (const name of ['up', 'down', 'db:start', 'db:stop', 'env', 'user', 'check']) assert.ok(scripts[name], name);
  execFileSync(process.execPath, ['--check', join(dir, 'scripts/dev.mjs')]);
});

test('supervise prefixes output and stops the others when one process exits', async () => {
  const lines = [];
  const code = await supervise([
    { name: 'a', file: process.execPath, args: ['-e', 'console.log("hi")'] },
    { name: 'longer', file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
  ], { log: (l) => lines.push(l), graceMs: 2000, handleSignals: false });
  assert.equal(code, 0);
  assert.ok(lines.includes('a      | hi'), lines.join('|'));
  assert.ok(lines.some((l) => /a      \| exited \(0\), stopping the rest/.test(l)));
});

test('findBuildKitDirs finds kits at the root and up to two levels down, nowhere else', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kits-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const rel of ['.build-kit', 'web/.build-kit', 'app/web/.build-kit', 'a/b/c/.build-kit', 'docs', '.hidden/.build-kit', 'node_modules/x/.build-kit']) mkdirSync(join(dir, rel), { recursive: true });
  assert.deepEqual(findBuildKitDirs(dir, ['.build-kit']), [dir, join(dir, 'app/web'), join(dir, 'web')]);
  assert.deepEqual(findBuildKitDirs(join(dir, 'docs'), ['.build-kit']), []);
});

test('reinitKits re-inits every installed kit with its own stack, in its own dir, and skips a missing one', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-reinit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'app');
  mkdirSync(join(app, '.build-kit'), { recursive: true });
  writeFileSync(join(app, 'skeleton.json'), '{}');
  const calls = join(dir, 'calls.jsonl');
  const fakeCli = join(dir, 'fake-cli.mjs');
  writeFileSync(fakeCli, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');\n`);

  const logs = [];
  assert.deepEqual(reinitKits({ typeName: 'supabase', target: app, cliPath: fakeCli, log: (l) => logs.push(l) }), ['.']);
  assert.match(logs.join('\n'), /supabase-react: not installed in web/);

  mkdirSync(join(app, 'web', '.build-kit'), { recursive: true });
  assert.deepEqual(reinitKits({ typeName: 'supabase', target: app, cliPath: fakeCli, log: () => {} }), ['.', 'web']);
  const runs = readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).slice(1);
  const real = (p) => execFileSync('sh', ['-c', `cd "${p}" && pwd -P`]).toString().trim();
  assert.deepEqual(runs.map((r) => [real(r.cwd), r.args]), [
    [real(app), ['re-init', '--stack', 'supabase', '--print']],
    [real(join(app, 'web')), ['re-init', '--stack', 'supabase-react', '--print']],
  ]);
});

test('reinitKits refuses a directory that is not a skeleton', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-reinit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => reinitKits({ typeName: 'supabase', target: dir, cliPath: 'x', log: () => {} }), /not a scaffolded skeleton/);
});
