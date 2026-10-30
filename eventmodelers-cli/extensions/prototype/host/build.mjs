// Builds the local player (dist/host.js + dist/host.css) from the board app's own source — the player and feedback components are
// the app's, not a copy. Needs the app checked out:  MIRO_APP=/path/to/miro-eventmodeling node host/build.mjs
// dist/ is committed, so using the CLI needs no app checkout; run this again when the player changes in the app.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(process.env.MIRO_APP || join(HERE, '..', '..', '..', '..', '..', 'miro-eventmodeling'));
const require = createRequire(join(APP, 'package.json'));
const esbuild = require('esbuild');
const PLAYER = join(APP, 'src', 'components', 'prototypeplayer');

// What needs the board (login, chat, the modal service) is replaced; matched by the end of the import path.
const stub = (name) => join(HERE, 'stubs', name);
const STUBS = [
  [/\/app\/canvas\/NodeStore$/, 'NodeStore.ts'],
  [/\/reactflow\/toastService$/, 'toastService.ts'],
  [/\/adapter\/OrganizationProvider$/, 'OrganizationProvider.ts'],
  [/\/reactflow\/modalService$/, 'modalService.ts'],
  [/\/reactflow\/modalRegistry$/, 'modalRegistry.ts'],
  [/(^|\/)prototypeApi$/, 'prototypeApi.ts'],
  [/(^|\/)openPrototypePlayer$/, 'openPrototypePlayer.ts'],
  [/(^|\/)canApply$/, 'canApply.ts'],
  [/(^|\/)submitFeedback$/, 'submitFeedback.ts'],
  [/(^|\/)useApplyStatus$/, 'useApplyStatus.tsx'],
  [/(^|\/)useFeedbackEntitled$/, 'useFeedbackEntitled.ts'],
  [/\/chat\/chatSend$/, 'chatSend.ts'],
  [/\/api\/BoardApi$/, 'BoardApi.ts'],
];

// The board's player has a collect-then-Submit flow, and locally it is the same: the feedback is collected in the browser (the app's own feedbackStorage)
// and Submit files it on the platform through this folder's server (stubs/submitFeedback.ts). Apply is the platform's (stubs/canApply.ts: off).
const plugin = {
  name: 'board-stubs',
  setup(build) {
    // One React: the CLI's own node_modules may carry another copy, and two copies break hooks.
    build.onResolve({ filter: /^(react|react-dom|uuid)(\/.*)?$/ }, (args) => (args.pluginData === 'app' ? undefined : build.resolve(args.path, { resolveDir: APP, kind: args.kind, pluginData: 'app' })));
    build.onResolve({ filter: /^@player\// }, (args) => build.resolve('./' + args.path.slice('@player/'.length), { resolveDir: PLAYER, kind: args.kind }));
    // TRACE=<part of a file name>: print who pulled that file in (to find what still needs a stub).
    const importer = new Map();
    if (process.env.TRACE) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData === 'trace' || !args.importer) return;
        const r = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: 'trace' });
        if (r.path && !importer.has(r.path)) importer.set(r.path, args.importer);
        return r;
      });
      build.onEnd(() => {
        let cur = [...importer.keys()].find((k) => k.includes(process.env.TRACE));
        const chain = [];
        while (cur && !chain.includes(cur)) { chain.push(cur); cur = importer.get(cur); }
        console.log('CHAIN\n' + chain.map((c) => c.replace(/^.*miro-eventmodeling\//, '')).join('\n  <- '));
      });
    }
    build.onResolve({ filter: /^\.{1,2}\// }, (args) => {
      for (const [re, file] of STUBS) if (re.test(args.path)) return { path: stub(file) };
    });
  },
};

mkdirSync(join(HERE, 'dist'), { recursive: true });
const result = await esbuild.build({
  entryPoints: [join(HERE, 'entry.tsx')],
  bundle: true, minify: true, format: 'iife', jsx: 'transform', target: 'es2020',
  outfile: join(HERE, 'dist', 'host.js'),
  nodePaths: [join(APP, 'node_modules')],
  plugins: [plugin],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API': '""' },
  logLevel: 'warning', metafile: true,
});

// The app's own look: Mirotone (the component styles) and the app's theme variables.
const css = [join(APP, 'node_modules', 'mirotone', 'dist', 'styles.css'), join(APP, 'src', 'assets', 'theme.css'), join(APP, 'src', 'assets', 'style.css')]
  .map((f) => `/* ${f.slice(APP.length + 1)} */\n${readFileSync(f, 'utf8')}`).join('\n');
writeFileSync(join(HERE, 'dist', 'host.css'), css);
if (process.env.META) writeFileSync(process.env.META, JSON.stringify(result.metafile));
console.log(`Built dist/host.js (${Object.keys(result.metafile.outputs).length} output) and dist/host.css from ${APP}`);
