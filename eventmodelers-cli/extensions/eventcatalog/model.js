// Slices → a neutral EventCatalog model: one domain, one flow per chapter, and the events, commands and queries
// (read models) of the event model. Processors, screens and services are not part of it — the model has no
// such thing as a service, so none is imported or invented. Pure — no I/O — so it is testable without a catalog.

const ELEMENT_KINDS = [
  ['commands', 'command'],
  ['events', 'event'],
  ['readmodels', 'query'],
];
const DEP_KINDS = { COMMAND: 'command', EVENT: 'event', READMODEL: 'query' };

// "Payment confirmed" / "Payment Confirmed" / "payment_confirmed" are one element.
const normalize = (title) => String(title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function pascal(title) {
  return String(title ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

const clean = (title) => String(title ?? '').trim().replace(/\s+/g, ' ');

export function buildModel(slices, { context } = {}) {
  const ordered = [...slices].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const contextName = clean(context || ordered[0]?.context || 'Default');
  const nodes = new Map(); // `${kind}:${normalized}` → node
  const byElementId = new Map(); // board element id (and linkedId) → node
  const edges = new Map(); // `${from}>${to}` → { from, to }

  function node(kind, title, slice) {
    const key = `${kind}:${normalize(title)}`;
    let n = nodes.get(key);
    if (!n) {
      n = { key, kind, id: pascal(title), name: clean(title), description: '', fields: [], slices: [], elementIds: [] };
      nodes.set(key, n);
    }
    if (slice && !n.slices.includes(slice)) n.slices.push(slice);
    return n;
  }

  function mergeFields(n, fields = []) {
    for (const f of fields) if (!n.fields.some((x) => x.name === f.name)) n.fields.push(f);
  }

  const link = (from, to) => edges.set(`${from.key}>${to.key}`, { from, to });

  const pending = [];
  for (const slice of ordered) {
    for (const [prop, kind] of ELEMENT_KINDS) {
      for (const el of slice[prop] ?? []) {
        const n = node(kind, el.title, slice.title);
        if (!n.description && el.description) n.description = el.description;
        mergeFields(n, el.fields);
        byElementId.set(el.id, n);
        if (el.linkedId) byElementId.set(el.linkedId, n);
        // The board's ids survive a rename of the title, so a later export can tell a rename from a new element.
        for (const id of [el.id, el.linkedId]) if (id && !n.elementIds.includes(id)) n.elementIds.push(id);
        pending.push([n, el]);
      }
    }
  }

  // Dependencies are resolved after every element is known, by id first and by title second.
  // A target nothing in the slices defines (e.g. a read model from another context) becomes a stub.
  for (const [n, el] of pending) {
    for (const dep of el.dependencies ?? []) {
      const kind = DEP_KINDS[dep.elementType];
      if (!kind) continue;
      // A message nothing defines (e.g. from another context) becomes a stub. Dependencies on processors
      // and screens never get here: DEP_KINDS doesn't know them, so they are dropped above.
      const target = byElementId.get(dep.id) ?? nodes.get(`${kind}:${normalize(dep.title)}`) ?? node(kind, dep.title);
      if (dep.type === 'INBOUND') link(target, n);
      else link(n, target);
    }
  }

  const real = [...nodes.values()];

  const ctxId = pascal(contextName);
  const find = (kind) => real.filter((n) => n.kind === kind);

  // The flow: one step per element in order of first appearance, edges from the dependencies.
  const inFlow = real;
  const stepId = (n) => `${n.kind}-${n.id}`;
  const steps = inFlow.map((n) => {
    const next = [...edges.values()].filter((e) => e.from === n && inFlow.includes(e.to)).map((e) => stepId(e.to));
    return { id: stepId(n), node: n, next };
  });

  const chapters = new Set(ordered.map((s) => clean(s.chapter || contextName)));
  const flows = [...chapters].map((chapter) => {
    const inChapter = new Set(ordered.filter((s) => clean(s.chapter || contextName) === chapter).map((s) => s.title));
    const chapterSteps = steps.filter((s) => s.node.slices.some((t) => inChapter.has(t)));
    const ids = new Set(chapterSteps.map((s) => s.id));
    return {
      id: `${pascal(chapter)}Flow`,
      name: chapter,
      steps: chapterSteps.map((s) => ({ ...s, next: s.next.filter((x) => ids.has(x)) })),
    };
  });

  return {
    domain: { id: ctxId, name: contextName },
    events: find('event'),
    commands: find('command'),
    queries: find('query'),
    flows,
  };
}
