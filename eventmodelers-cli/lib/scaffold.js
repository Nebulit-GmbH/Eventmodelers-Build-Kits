// `eventmodelers scaffold`: turns a board into a runnable app skeleton the build kits then add
// slices to. A scaffold *type* names the kits it installs, the tools its app needs and the
// generator that writes the skeleton around them — adding a type (e.g. a Java one) is adding an
// entry to SCAFFOLD_TYPES plus a generator under shared/scaffold/<type>/.
//
// The skeleton generators are adapted from the em-scaffold skill by Adrian Mowat (MIT,
// shared/scaffold/LICENSE-em-scaffold).
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCAFFOLD_DIR = join(here, '..', 'shared', 'scaffold');

export const SCAFFOLD_TYPES = {
  supabase: {
    label: 'Supabase backend + React front end (runs supabase + supabase-react)',
    // Installed in order; `dir` is relative to the target.
    kits: [
      { stack: 'supabase', dir: '.' },
      { stack: 'supabase-react', dir: 'web' },
    ],
    generator: join(SCAFFOLD_DIR, 'supabase', 'generate.mjs'),
    tools: [
      { command: 'docker', name: 'Docker' },
      { command: 'supabase', name: 'Supabase CLI' },
      { command: 'flyway', name: 'Flyway' },
      { command: 'java', name: 'Java (Flyway runtime)' },
    ],
    minNode: 22,
    // Command (run in the app root) that adds a sign-in user; omit it for a type without sign-in — `scaffold add-user` is then a no-op.
    addUser: { requires: 'scripts/create-user.mjs', command: (email, password) => [process.execPath, 'scripts/create-user.mjs', email, password] },
    // Run in the target after the generator; the first failure stops the run.
    installSteps: [
      ['npm', 'install'],
      ['npm', '--prefix', 'web', 'install'],
    ],
    checkSteps: [
      ['npx', 'tsc', '--noEmit'],
      ['npx', 'tsx', '--test', 'src/common/notImplemented.test.ts'],
      ['npm', '--prefix', 'web', 'run', 'build'],
      ['npm', '--prefix', 'web', 'run', 'lint'],
    ],
    // One entry per port the generator takes. `flag` is passed to it with the picked value, `saved` is the
    // key it writes to skeleton.json (so a refresh keeps its ports), `occupies` lists every TCP port the value
    // needs free (default: itself), `render` turns it into the flag's value. A Supabase prefix NNN owns
    // NNN20..NNN29 and can't go above 654.
    ports: [
      { name: 'api', flag: '--api-port', saved: 'apiPort', start: 3100 },
      { name: 'web', flag: '--web-port', saved: 'webPort', start: 5273 },
      { name: 'db', flag: '--db-port-prefix', saved: 'dbPortPrefix', start: 564, limit: 654,
        occupies: (n) => Array.from({ length: 10 }, (_, i) => n * 100 + 20 + i) },
    ],
  },
};

const walkFiles = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walkFiles(join(dir, n)) : [join(dir, n)]));

// The type's built-in templates as template path (the path they generate, always '/') -> source file.
export function builtInTemplates(type) {
  const dir = join(dirname(type.generator), 'template');
  return new Map(walkFiles(dir).sort().map((file) => [relative(dir, file).split(sep).join('/').replace(/\.tmpl$/, ''), file]));
}

// Copies built-in templates into `dest` so they can be edited there; the generator then uses what is in `dest`
// and falls back to the built-in template for everything else. `only` limits it to paths (a file, or a folder
// prefix); an existing file is kept unless `force`.
export function initTemplates(type, dest, { only = [], force = false } = {}) {
  const all = builtInTemplates(type);
  const wanted = only.map((p) => p.replace(/\\/g, '/').replace(/\.tmpl$/, '').replace(/\/+$/, ''));
  const unknown = wanted.filter((p) => ![...all.keys()].some((rel) => rel === p || rel.startsWith(`${p}/`)));
  if (unknown.length) throw new Error(`no built-in template at ${unknown.map((p) => `"${p}"`).join(', ')} — \`init-templates --list\` shows them`);
  const copied = [];
  const kept = [];
  for (const [rel, file] of all) {
    if (wanted.length && !wanted.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
    const out = join(dest, `${rel}.tmpl`);
    if (existsSync(out) && !force) { kept.push(rel); continue; }
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(file, out);
    copied.push(rel);
  }
  return { copied, kept };
}

export function scaffoldTypeNames() {
  return Object.keys(SCAFFOLD_TYPES);
}

// How to start `file` on this platform. On Windows npm and npx are .cmd shims that only start through a
// shell (Node refuses to spawn them directly), so they get one; everything else is a plain executable.
export function invocation(file, args, platform = process.platform) {
  const shimmed = platform === 'win32' && ['npm', 'npx'].includes(file);
  return shimmed ? { file: [file, ...args].join(' '), args: [], shell: true } : { file, args, shell: false };
}

// The command that answers "is `command` on the PATH": `where` on Windows (it honours PATHEXT), `command -v` elsewhere.
export function probe(command, platform = process.platform) {
  return platform === 'win32' ? { file: 'where', args: [command] } : { file: 'sh', args: ['-c', `command -v ${command}`] };
}

export function hasCommand(command) {
  const { file, args } = probe(command);
  try {
    execFileSync(file, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// What the type needs that this machine lacks, as printable names. Node is checked by version.
export function missingPrerequisites(type, { nodeVersion = process.versions.node, has = hasCommand } = {}) {
  const missing = [];
  if (Number(nodeVersion.split('.')[0]) < type.minNode) missing.push(`Node ${type.minNode} or newer (found ${nodeVersion})`);
  for (const tool of type.tools) if (!has(tool.command)) missing.push(tool.name);
  return missing;
}

// Free means nothing listens on any interface, which is what a Docker-published port looks like too.
export function isPortFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, () => server.close(() => done(true)));
  });
}

// The first value from the spec's start whose ports are all free, one spec at a time. Specs picked in the
// same run don't share ports as long as their ranges differ, which they do for every type so far.
export async function pickPorts(specs, { free = isPortFree } = {}) {
  const picked = {};
  for (const spec of specs) {
    const occupies = spec.occupies ?? ((n) => [n]);
    const limit = spec.limit ?? spec.start + 100;
    let value = spec.start;
    while (value <= limit && !(await Promise.all(occupies(value).map(free))).every(Boolean)) value++;
    if (value > limit) throw new Error(`no free "${spec.name}" port from ${spec.start} up to ${limit}`);
    picked[spec.name] = String(value);
  }
  return picked;
}

// An empty/new directory or an earlier skeleton (has skeleton.json) is fair game; anything else is not ours.
export function targetState(target) {
  if (!existsSync(target)) return 'new';
  if (existsSync(join(target, 'skeleton.json'))) return 'skeleton';
  return readdirSync(target).length === 0 ? 'new' : 'foreign';
}

function run(file, args, { cwd, env, quiet = false } = {}) {
  const inv = invocation(file, args);
  execFileSync(inv.file, inv.args, { cwd, env: { ...process.env, ...env }, stdio: quiet ? 'ignore' : 'inherit', shell: inv.shell });
}

// cfg: { token, organizationId, boardId, baseUrl }. Credentials reach the child installers through
// EVENTMODELERS_* env vars so the token never shows up in a process list.
// templates: a folder of *.tmpl files overriding the type's built-in templates; when omitted, `<target>/templates`
// is used if it exists, so a project's customisations survive every refresh.
export async function runScaffold({ typeName, target, cfg, model, cliPath, install = true, check = true, templates, ports: portOverrides = {}, log = console.log }) {
  const type = SCAFFOLD_TYPES[typeName];
  const root = resolve(target);
  const state = targetState(root);
  if (state === 'foreign') {
    throw new Error(`${root} is not empty and is not a scaffolded skeleton — pass an empty or new directory`);
  }

  const unknown = Object.keys(portOverrides).filter((n) => !type.ports.some((p) => p.name === n));
  if (unknown.length) {
    throw new Error(`unknown port ${unknown.map((n) => `"${n}"`).join(', ')} for type ${typeName} (it has: ${type.ports.map((p) => p.name).join(', ')})`);
  }
  // A refresh keeps the ports the skeleton already runs on; only a new one picks free ports.
  const previous = state === 'skeleton' ? JSON.parse(readFileSync(join(root, 'skeleton.json'), 'utf8')) : {};
  const pending = type.ports.filter((p) => previous[p.saved] === undefined && portOverrides[p.name] === undefined);
  const picked = await pickPorts(pending);
  const ports = Object.fromEntries(type.ports.map((p) => [p.name, String(portOverrides[p.name] ?? previous[p.saved] ?? picked[p.name])]));

  for (const kit of type.kits) mkdirSync(join(root, kit.dir), { recursive: true });
  if (!existsSync(join(root, '.git'))) run('git', ['init', '-q'], { cwd: root });

  const env = {
    EVENTMODELERS_TOKEN: cfg.token,
    EVENTMODELERS_ORGANIZATION_ID: cfg.organizationId,
    EVENTMODELERS_BOARD_ID: cfg.boardId,
    ...(cfg.baseUrl ? { EVENTMODELERS_BASE_URL: cfg.baseUrl } : {}),
  };
  for (const kit of type.kits) {
    const cwd = join(root, kit.dir);
    if (existsSync(join(cwd, '.build-kit'))) {
      log(`▶ ${kit.stack}: already installed in ${kit.dir}, skipping`);
      continue;
    }
    log(`▶ Installing the ${kit.stack} kit in ${kit.dir}`);
    run(process.execPath, [cliPath, 'init', '--stack', kit.stack, '--print'], { cwd, env });
  }

  // Next to the target, not in it: the model is an input of the skeleton, not a project file.
  const modelFile = `${root}.model.json`;
  writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
  const templatesDir = templates ? resolve(templates) : existsSync(join(root, 'templates')) ? join(root, 'templates') : null;
  if (templates && !existsSync(templatesDir)) throw new Error(`--templates ${templatesDir} does not exist`);
  log(`▶ Generating the skeleton (model: ${modelFile}${templatesDir ? `, templates: ${templatesDir}` : ''})`);
  run(process.execPath, [
    type.generator, '--model', modelFile, '--target', root,
    ...type.ports.flatMap((p) => [p.flag, ports[p.name]]),
    ...(templatesDir ? ['--templates', templatesDir] : []),
  ]);

  if (install) {
    for (const [file, ...args] of type.installSteps) run(file, args, { cwd: root });
    if (check) {
      for (const [file, ...args] of type.checkSteps) run(file, args, { cwd: root });
    }
    try {
      run('git', ['add', '-A'], { cwd: root });
      run('git', ['commit', '-q', '-m', 'chore: app skeleton from the event model'], { cwd: root });
    } catch {
      log('ℹ️  Nothing to commit (or git refused) — commit the skeleton yourself.');
    }
  }
  return { root, ports, modelFile };
}

// `scaffold re-init`: refreshes every kit the type installed in a skeleton from this CLI's version — each through
// `re-init --stack <its stack>` in its own directory, so the skeleton and the root CLAUDE.md are left alone.
// Returns the kits refreshed, as their dirs.
export function reinitKits({ typeName, target, cliPath, log = console.log }) {
  const type = SCAFFOLD_TYPES[typeName];
  const root = resolve(target);
  if (targetState(root) !== 'skeleton') {
    throw new Error(`${root} is not a scaffolded skeleton (no skeleton.json) — run this in its folder or pass the folder`);
  }
  const refreshed = [];
  for (const kit of type.kits) {
    const cwd = join(root, kit.dir);
    if (!existsSync(join(cwd, '.build-kit'))) {
      log(`▶ ${kit.stack}: not installed in ${kit.dir}, skipping — \`scaffold ${relative(process.cwd(), root) || '.'}\` installs it`);
      continue;
    }
    log(`▶ Refreshing the ${kit.stack} kit in ${kit.dir}`);
    run(process.execPath, [cliPath, 're-init', '--stack', kit.stack, '--print'], { cwd });
    refreshed.push(kit.dir);
  }
  return refreshed;
}
