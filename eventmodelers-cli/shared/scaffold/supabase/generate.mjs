#!/usr/bin/env node
// Writes the skeleton overlay into a project that already has the eventmodelers `supabase` kit at its
// root and the `supabase-react` kit in web/. Idempotent: skeleton-owned files are rewritten on every run,
// page files (web/src/pages/*.tsx) and src/common/extraEndpoints.ts are only created when absent.
//
// Usage: node generate.mjs --model <model.json> --target <dir> --api-port <n> --web-port <n> --db-port-prefix <nnn> [--templates <dir>]
// --templates: a folder whose *.tmpl files replace the built-in template of the same path, or add files (same tokens).
// model.json is written by "eventmodelers scaffold" from the board (lib/scaffold-model.js).
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync} from 'node:fs';
import {basename, dirname, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, 'template');

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const required of ['model', 'target', 'api-port', 'web-port', 'db-port-prefix']) {
    if (!args[required]) throw new Error(`missing --${required}`);
}
const target = args.target;
const apiPort = Number(args['api-port']);
const webPort = Number(args['web-port']);
const dbPrefix = String(args['db-port-prefix']);
if (!/^\d{3}$/.test(dbPrefix) || Number(dbPrefix) > 654) throw new Error('--db-port-prefix must be 3 digits (ports become <prefix>20..<prefix>29), at most 654');
for (const p of ['package.json', 'server.ts', 'supabase/config.toml', 'web/package.json', 'web/src/lib/api.ts']) {
    if (!existsSync(join(target, p))) throw new Error(`${p} not found in ${target}: install the kits first (eventmodelers scaffold does this)`);
}

const model = JSON.parse(readFileSync(args.model, 'utf8'));
const css = ['bulma', 'none'].includes(model.css) ? model.css : 'none';
const appTitle = model.appTitle || model.boardName || 'App';

// ---------- names (kit conventions) ----------
// Backend route name: slice title lowercased, whitespace removed (build-state-change/-view `{slicename}`).
const endpointName = (title) => title.toLowerCase().replace(/\s+/g, '');
// Page file/export name: the screen title in PascalCase (web kit: `src/pages/<ScreenTitle>.tsx`).
const pageName = (title) => {
    const name = title.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return /^[A-Za-z]/.test(name) ? name : `Page${name}`;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

// ---------- timelines ----------
const slices = (model.slices ?? []).filter((s) => s && s.title);
const chapters = [...(model.timelines ?? [])].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
const timelineTitles = chapters.map((c) => c.title);
// Slices whose chapter is not a known timeline still get a nav entry, named after their chapter/context.
for (const s of slices) {
    const t = s.chapter || s.context || 'Unassigned';
    s.chapter = t;
    if (!timelineTitles.includes(t)) timelineTitles.push(t);
}
const usedSlugs = new Set();
const uniqueSlug = (base) => {
    let s = base, n = 2;
    while (usedSlugs.has(s)) s = `${base}-${n++}`;
    usedSlugs.add(s);
    return s;
};

// ---------- pages (one per distinct screen title) ----------
const screenInfo = Object.fromEntries((model.screens ?? []).map((s) => [s.title, s]));
const pages = new Map(); // name -> page
const usedRoutes = new Set(['/', '/timelines']);
const warnings = [];
for (const s of slices) {
    for (const title of s.screens ?? []) {
        const name = pageName(title);
        if (!pages.has(name)) {
            let route = screenInfo[title]?.route;
            if (route && (!route.startsWith('/') || usedRoutes.has(route))) {
                warnings.push(`screen "${title}": route ${route} unusable (not absolute or already taken), using a generated one`);
                route = undefined;
            }
            if (!route) {
                let base = `/${slug(title.replace(/\s+page$/i, ''))}`, r = base, n = 2;
                while (usedRoutes.has(r)) r = `${base}-${n++}`;
                route = r;
            }
            usedRoutes.add(route);
            pages.set(name, {name, title, route, hasParams: route.includes('/:'), home: !!screenInfo[title]?.home, slices: [], timelines: []});
        }
        const page = pages.get(name);
        if (!page.slices.includes(s.title)) page.slices.push(s.title);
        if (!page.timelines.includes(s.chapter)) page.timelines.push(s.chapter);
    }
}

const timelines = timelineTitles.map((title) => {
    const own = slices.filter((s) => s.chapter === title);
    return {
        title,
        slug: uniqueSlug(slug(title)),
        pages: [...pages.values()].filter((p) => p.timelines.includes(title)).map((p) => p.name),
        slices: own.map((s) => ({
            title: s.title,
            type: s.sliceType,
            ...(s.sliceType === 'STATE_CHANGE' ? {endpoint: `POST /api/${endpointName(s.title)}/:id`} : {}),
            ...(s.sliceType === 'STATE_VIEW' ? {endpoint: `GET /api/query/${endpointName(s.title)}-collection`} : {}),
        })),
    };
});
const homePage = [...pages.values()].find((p) => p.home && !p.hasParams);
const homeRoute = homePage ? homePage.route : timelines.length ? `/timelines/${timelines[0].slug}` : '/timelines';

// ---------- helpers ----------
const written = [];
const write = (rel, content, {onlyIfAbsent = false} = {}) => {
    const file = join(target, rel);
    if (onlyIfAbsent && existsSync(file)) return;
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, content);
    written.push(rel);
};
const tokens = {
    __APP_TITLE__: appTitle,
    __API_PORT__: String(apiPort),
    __WEB_PORT__: String(webPort),
    __DB_PORT__: `${dbPrefix}22`,
    __CSS_IMPORT__: css === 'bulma' ? `import 'bulma/css/bulma.min.css'` : `import './app/skeleton.css'`,
};
const fill = (text) => Object.entries(tokens).reduce((t, [k, v]) => t.split(k).join(v), text);

// ---------- 1. template overlay (skeleton-owned files, rewritten every run) ----------
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
// Template path relative to its folder, always with '/', without the .tmpl suffix.
const relOf = (dir, file) => relative(dir, file).split(sep).join('/').replace(/\.tmpl$/, '');
const templates = new Map(walk(templateDir).map((file) => [relOf(templateDir, file), file]));
// A project's own templates win over the built-in ones. Only *.tmpl files count, so nothing in there is
// ever compiled as project code.
const overridden = [];
const added = [];
if (args.templates) {
    if (!existsSync(args.templates)) throw new Error(`--templates ${args.templates} does not exist`);
    for (const file of walk(args.templates).filter((f) => f.endsWith('.tmpl'))) {
        const rel = relOf(args.templates, file);
        (templates.has(rel) ? overridden : added).push(rel);
        templates.set(rel, file);
    }
}
for (const [rel, file] of templates) {
    if (rel === 'web/src/app/skeleton.css' && css !== 'none') continue;
    const onlyIfAbsent = ['src/common/extraEndpoints.ts', 'supabase/migrations/_V0__supabase_stubs.sql'].includes(rel);
    write(rel, fill(readFileSync(file, 'utf8')), {onlyIfAbsent});
}

// ---------- 2. generated from the model ----------
const endpoints = slices
    .filter((s) => s.sliceType === 'STATE_CHANGE' || s.sliceType === 'STATE_VIEW')
    .map((s) => (s.sliceType === 'STATE_CHANGE' ? `POST ${endpointName(s.title)}` : `GET query/${endpointName(s.title)}-collection`));
write('src/common/modeledEndpoints.ts', `// GENERATED by "eventmodelers scaffold" from the event model. Do not edit by hand: re-run the command.
// Every endpoint the model describes (commands and read models). Used by notImplemented.ts to answer
// 501 for modeled endpoints whose slice is not built yet. Endpoints outside the naming convention go in
// extraEndpoints.ts.
export const MODELED_ENDPOINTS: string[] = [
${[...new Set(endpoints)].sort().map((e) => `    '${e}',`).join('\n')}
];
`);

const pageList = [...pages.values()].map(({name, title, route, hasParams, slices: s}) => ({name, title, route, hasParams, slices: s}));
write('web/src/app/model.ts', `// GENERATED by "eventmodelers scaffold" from the event model. Do not edit by hand: re-run the command.
// Navigation has one entry per timeline (chapter). Pages are one per distinct screen title (web kit convention).

export type SliceInfo = { title: string; type: string; endpoint?: string };
export type TimelineInfo = { title: string; slug: string; pages: string[]; slices: SliceInfo[] };
export type PageInfo = { name: string; title: string; route: string; hasParams: boolean; slices: string[] };

export const APP_TITLE = ${JSON.stringify(appTitle)};
export const HOME_ROUTE = ${JSON.stringify(homeRoute)};

export const TIMELINES: TimelineInfo[] = ${JSON.stringify(timelines, null, 2)};

export const PAGES: PageInfo[] = ${JSON.stringify(pageList, null, 2)};
`);

for (const p of pages.values()) {
    const params = p.hasParams;
    const tl = p.timelines.join(', ');
    write(`web/src/pages/${p.name}.tsx`, `${params ? "import { useParams } from 'react-router-dom';\n" : ''}import { NotBuilt } from '../lib/NotBuilt';

// Page shell for the screen "${p.title}" (timeline: ${tl}), route ${p.route}, generated by "eventmodelers scaffold".
// Slices on this screen: ${p.slices.join(', ')}.
// Compose their components here as they are built (build-state-change/-view Step 5). Keep the export name:
// the router finds this page by it.
export function ${p.name}() {
${params ? '  const params = useParams();\n' : ''}  return (
    <>
      <h1 className="title">${p.title.replace(/[{}<>]/g, '')}</h1>
${params ? `      <p className="subtitle is-6">{Object.entries(params).map(([k, v]) => \`\${k}: \${v}\`).join(', ')}</p>\n` : ''}      <NotBuilt detail={${JSON.stringify(`Slices on this page: ${p.slices.join(', ')}.`)}} />
    </>
  );
}
`, {onlyIfAbsent: true});
}

// ---------- 3. patches to kit-installed files ----------
const pkgFile = join(target, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
pkg.scripts = {
    ...pkg.scripts,
    // tsx watch restarts the API when any source file or migration changes, including new slice folders.
    dev: "tsx watch --clear-screen=false --env-file=.env --include 'src/**/*.ts' --include 'supabase/migrations/*.sql' --exclude 'src/**/*.test.ts' server.ts",
    'create-user': 'node scripts/create-user.mjs',
    // Local run without extra tools: scripts/dev.mjs (see its header).
    up: 'node scripts/dev.mjs up',
    down: 'node scripts/dev.mjs down',
    'db:start': 'node scripts/dev.mjs db:start',
    'db:stop': 'node scripts/dev.mjs db:stop',
    env: 'node scripts/dev.mjs env',
    user: 'node scripts/create-user.mjs',
    check: 'node scripts/dev.mjs check',
};
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

// The root tsc (and the kit's tsc-build check) must not compile the React app or the dist output.
const tsconfigFile = join(target, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigFile, 'utf8'));
tsconfig.exclude = [...new Set([...(tsconfig.exclude ?? []), 'node_modules', 'web', 'dist'])];
write('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n');

const webPkgFile = join(target, 'web/package.json');
const webPkg = JSON.parse(readFileSync(webPkgFile, 'utf8'));
webPkg.dependencies = {...webPkg.dependencies, 'react-router-dom': '^7.18.4', ...(css === 'bulma' ? {bulma: '^1.0.4'} : {})};
webPkg.scripts = {...webPkg.scripts, dev: `vite --port ${webPort} --strictPort`};
write('web/package.json', JSON.stringify(webPkg, null, 2) + '\n');

const indexHtml = join(target, 'web/index.html');
if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8').replace(/<title>.*<\/title>/, `<title>${appTitle.replace(/[<>&]/g, '')}</title>`);
    write('web/index.html', html);
}

// Supabase: own project id and ports, so the stack can run beside other local stacks.
let toml = readFileSync(join(target, 'supabase/config.toml'), 'utf8');
toml = toml
    .replace(/^project_id = ".*"$/m, `project_id = "${slug(args['project-id'] || basename(target))}"`)
    .replace(/^(\s*(?:shadow_)?port = )\d{3}(\d{2})$/gm, `$1${dbPrefix}$2`)
    .replace(/^(\s*#?\s*(?:smtp|pop3)_port = )\d{3}(\d{2})$/gm, `$1${dbPrefix}$2`)
    .replace(/^site_url = ".*"$/m, `site_url = "http://localhost:${webPort}"`)
    .replace(/^additional_redirect_urls = .*$/m, `additional_redirect_urls = ["http://127.0.0.1:${webPort}"]`);
write('supabase/config.toml', toml);

const gitignore = join(target, '.gitignore');
const ignoreLines = ['.env', 'web/.env', 'node_modules/', 'dist/', 'web/dist/', 'supabase/.temp/', 'supabase/.branches/', '.dev.pid'];
const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8').split('\n') : [];
const missing = ignoreLines.filter((l) => !existing.includes(l));
if (missing.length) appendFileSync(gitignore, (existing.length && existing.at(-1) !== '' ? '\n' : '') + missing.join('\n') + '\n');

// Notes for the build agents. Both kits read .build-kit/AGENTS.md at session start.
const MARK = '<!-- em-scaffold skeleton -->';
const notes = {
    '.build-kit/AGENTS.md': `${MARK}
## App skeleton (em-scaffold)
- Unbuilt endpoints answer 501 from \`notImplemented\` in \`server.ts\`, registered after every real route, so a slice's own \`routes.ts\` always wins. Never add stub routes or touch \`server.ts\`.
- Name routes by the kit convention (\`POST /api/<slicename>[/:id]\`, \`GET /api/query/<slicename>-collection\`). A route the model needs outside that convention goes in \`src/common/extraEndpoints.ts\`, or \`src/common/notImplemented.test.ts\` fails.
- Register every projection in \`src/common/loadPostgresEventstore.ts\`: slice tests pass without it, the running app does not.
- There is no \`src/core/readmodel\` (build-state-view Step 6 imports it). Read the projection's table in the route with \`createServiceClient()\` from \`src/supabase/api.ts\`, as this stack's existing routes do.
- Projection tests need \`supabase/migrations/_V0__supabase_stubs.sql\` (Supabase roles and auth stubs for plain Postgres). The skeleton ships it; never delete it. The leading underscore keeps Flyway from running it.
- Commit the slice cache (\`.build-kit/.slices/\`) in its own \`chore:\` commit before the slice commit: the commit-scope check rejects it as out of scope otherwise.
- \`npm run dev\` (via \`npm run up\`) reloads the API on any change under \`src/\` or \`supabase/migrations/\`, and runs Flyway on each start. Do not restart servers.
`,
    'web/.build-kit/AGENTS.md': `${MARK}
## App skeleton (em-scaffold)
- Every distinct screen title already has a page at \`src/pages/<ScreenTitle>.tsx\` (PascalCase, export of the same name), routed from \`src/app/model.ts\`. Compose slice components into that page, even when only one slice uses the screen. Never create a second page for the same screen and never edit \`App.tsx\`, \`src/app/*\` or the router: a new \`src/pages/*.tsx\` file is routed automatically.
- A 501 from the backend means "slice not built yet". \`src/lib/api.ts\` turns it into \`NOT_BUILT_MESSAGE\`; a missing read-model table gives the same 501. Render it with \`<NotBuilt />\` from \`src/lib/NotBuilt.tsx\` (\`isNotBuilt(err)\` from \`src/lib/api.ts\`), not as a failure.
- Prefer \`getReadModel('/api/query/<slicename>-collection')\` over \`queryReadModel\`: a table with RLS on and no policies returns an empty list through Supabase.
`,
};
for (const [rel, text] of Object.entries(notes)) {
    const file = join(target, rel);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!current.includes(MARK)) {
        mkdirSync(dirname(file), {recursive: true});
        appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + (current ? '\n' : '') + text);
        written.push(rel);
    }
}

write('skeleton.json', JSON.stringify({apiPort, webPort, dbPortPrefix: dbPrefix, css, homeRoute, timelines: timelines.length, pages: pages.size, endpoints: endpoints.length}, null, 2) + '\n');

console.log(JSON.stringify({written: written.length, templatesOverridden: overridden, templatesAdded: added, timelines: timelines.map((t) => t.title), pages: pages.size, endpoints: endpoints.length, homeRoute, css, warnings}, null, 2));
