// `init --prototype --empty`: an empty prototype with an initial Hello World page, no board needed. The model is written the way a fetch would
// write it (.slices/<context>/<slice>/slice.json, the screen under .prototype/screens/), the baseline is taken, and the page is built — so
// everything after it (the player, local-prototype-model, local-prototype-build, sync once a board is connected) works as on a fetched model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { assemble, status } from './local-build.js';
import { paths, snapshotBaseline, snapshotScreens, writeJson, writeScreens } from './state.js';

const PAGE = '<section class="section"><div class="container"><h1 class="title">Hello World</h1><p class="subtitle">This is your empty prototype. Describe what it should do in Claude Code — the model changes first, the page follows.</p></div></section>';

export function createEmptyPrototype(cwd, { name = 'My Prototype' } = {}) {
  const p = paths(cwd);
  const sliceId = randomUUID();
  const screenId = randomUUID();
  const dir = join(p.slices, 'prototype');
  mkdirSync(join(dir, 'helloworld'), { recursive: true });
  const screen = {
    id: screenId, title: 'Hello World', type: 'HTML_SCREEN', fields: [], dependencies: [], modelContext: name, lane: 'Actor', aggregate: 'default',
    aggregateDependencies: [], triggers: [], tags: [], slice: 'Hello World', description: '', context: 'INTERNAL', elementContext: 'INTERNAL',
    listElement: false, todoList: false, createsAggregate: false, elementCopy: false, linkedId: screenId, sketched: false, comments: [],
  };
  const slice = {
    id: sliceId, title: 'Hello World', status: 'Created', sliceType: 'STATE_VIEW', chapter: name, context: name,
    commands: [], events: [], readmodels: [], screens: [screen], processors: [], tables: [], specifications: [], actors: [], aggregates: [], screenImages: [], comments: [],
  };
  writeJson(join(dir, 'helloworld', 'slice.json'), slice);
  writeJson(join(dir, 'context.json'), { name });
  writeJson(join(dir, 'index.json'), { slices: [{ id: sliceId, slice: 'Hello World', contextName: name, contextSlug: 'prototype', folder: 'helloworld', status: 'Created' }] });
  mkdirSync(p.root, { recursive: true });
  writeJson(p.state, { context: name, local: true, createdAt: new Date().toISOString() });
  writeScreens(p, { [screenId]: { type: 'HTML_SCREEN', title: 'Hello World', pages: [PAGE], marks: null, cssFrameworks: ['bulma'] } });
  snapshotBaseline(p);
  snapshotScreens(p);

  // The slice's block: its part of the screen, translated 1:1 from the page (a view without a read model — there is no data yet).
  const report = status(cwd);
  const { hash } = report.slices[0];
  mkdirSync(p.blocks, { recursive: true });
  writeFileSync(join(p.blocks, `${sliceId}.html`), `<script type="text/plain" data-em-slice="${sliceId}" data-em-title="Hello World" data-em-hash="${hash}">
// The initial page of an empty prototype: no commands and no read models yet — add them to the model and rebuild.
function HelloWorld() {
  return (
    <section className="section">
      <div className="container">
        <h1 className="title">Hello World</h1>
        <p className="subtitle">This is your empty prototype. Describe what it should do in Claude Code — the model changes first, the page follows.</p>
      </div>
    </section>
  );
}

EMRuntime.defineSlice({
  id: '${sliceId}',
  title: 'Hello World',
  order: 1,
  screens: { 'Hello World': { actor: 'User', part: HelloWorld } },
});
</script>
`);
  assemble(cwd);
  return { sliceId, screenId, context: name };
}
