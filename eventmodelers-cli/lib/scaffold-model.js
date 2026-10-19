// Builds the `model.json` the scaffold generators read, from the board's REST API.
// `api` is `{ get(path), post(path, body) }` rooted at /api/org/:orgId/boards/:boardId, so this
// stays testable without a server.

const SCREEN_BATCH = 20;
// Class names that only a Bulma mockup uses; any one in a screen's HTML means the screen is Bulma.
const BULMA_CLASS = /class="[^"]*\b(navbar|is-primary|modal-card|columns|box)\b/;

// A route is only taken when the screen's description states one ("route /orders/:orderId").
export function routeFrom(description) {
  const m = /\broute\s+(\/[^\s,;)]*)/i.exec(description ?? '');
  return m ? m[1].replace(/[.]+$/, '') : undefined;
}

export function isHomeScreen(description) {
  return /\bhome\s*page\b|\b(?:page|screen)\s+(?:shown\s+)?after\s+sign-?\s?in\b|\bshown\s+after\s+sign-?\s?in\b/i.test(description ?? '');
}

const descriptionOf = (node) => node.description ?? node.meta?.description ?? node.data?.description ?? '';

export async function buildModel({ api, appTitle }) {
  const { chapters = [] } = await api.get('/chapters/bounds');
  const timelines = chapters.filter((c) => c.title).map(({ title, x, y }) => ({ title, x, y }));

  // Timelines of one context return the same slices, so slices are keyed by id.
  const slicesById = new Map();
  for (const t of timelines) {
    const { slices = [] } = await api.get(`/slicedata?contextName=${encodeURIComponent(t.title)}&projection=outline`);
    for (const s of slices) {
      if (s.title && !slicesById.has(s.id ?? s.title)) slicesById.set(s.id ?? s.title, s);
    }
  }

  // One screen node id per distinct screen title is enough to read route, home flag and CSS.
  const screenIdByTitle = new Map();
  for (const s of slicesById.values()) {
    for (const screen of s.screens ?? []) {
      if (screen?.title && screen.id && !screenIdByTitle.has(screen.title)) screenIdByTitle.set(screen.title, screen.id);
    }
  }
  const titleById = new Map([...screenIdByTitle].map(([title, id]) => [id, title]));
  const ids = [...screenIdByTitle.values()];
  const screens = [];
  let bulma = false;
  for (let i = 0; i < ids.length; i += SCREEN_BATCH) {
    const nodes = await api.post('/nodes/query', { ids: ids.slice(i, i + SCREEN_BATCH) });
    for (const node of nodes) {
      const title = titleById.get(node.id);
      if (!title) continue;
      const description = descriptionOf(node);
      const route = routeFrom(description);
      const home = isHomeScreen(description);
      screens.push({ title, ...(route ? { route } : {}), ...(home ? { home: true } : {}) });
      const pages = Array.isArray(node.meta?.pages) ? node.meta.pages : [];
      if (pages.some((html) => typeof html === 'string' && BULMA_CLASS.test(html))) bulma = true;
    }
  }

  return {
    appTitle: appTitle || 'App',
    css: bulma ? 'bulma' : 'none',
    timelines,
    slices: [...slicesById.values()].map((s) => ({
      title: s.title,
      sliceType: s.sliceType,
      chapter: s.chapter || s.context,
      screens: (s.screens ?? []).map((sc) => sc.title).filter(Boolean),
    })),
    screens,
  };
}
