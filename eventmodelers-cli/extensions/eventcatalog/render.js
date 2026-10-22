// Model → file contents. Everything returned is `{ path, content }`, relative to the catalog root.

const JSON_TYPES = {
  string: { type: 'string' },
  text: { type: 'string' },
  uuid: { type: 'string', format: 'uuid' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' },
  time: { type: 'string', format: 'time' },
  boolean: { type: 'boolean' },
  int: { type: 'integer' },
  integer: { type: 'integer' },
  long: { type: 'integer' },
  double: { type: 'number' },
  float: { type: 'number' },
  decimal: { type: 'number' },
  number: { type: 'number' },
};

function fieldSchema(f) {
  const base = f.subfields?.length ? objectSchema(f.subfields) : { ...(JSON_TYPES[String(f.type ?? '').toLowerCase()] ?? { type: 'string' }) };
  if (f.example !== undefined && f.example !== '') base.examples = [f.example];
  if (f.description) base.description = f.description;
  return /^(list|multiple|array)$/i.test(f.cardinality ?? '') ? { type: 'array', items: base } : base;
}

function objectSchema(fields) {
  const properties = {};
  for (const f of fields) properties[f.name] = fieldSchema(f);
  const required = fields.filter((f) => !f.optional).map((f) => f.name);
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

export function toJsonSchema(fields) {
  return { $schema: 'http://json-schema.org/draft-07/schema#', ...objectSchema(fields) };
}

const KIND_LABEL = { event: 'Event', command: 'Command', query: 'Query' };
const VERSION = '1.0.0';

// EventCatalog's linter requires a summary; fall back to a plain statement when the model has no description.
const summary = (n, context) => n.description || `${KIND_LABEL[n.kind]} ${n.name} of ${context}.`;
const usedIn = (n) => (n.slices.length ? `\nUsed in: ${n.slices.join(', ')}.\n` : '\n');

// Model → resources in the shape the EventCatalog SDK writes (`writeEvent`, `writeQuery`, …), plus the
// schema files to attach afterwards. Nothing is written here.
export function toResources(model, { owners = [] } = {}) {
  const ctx = model.domain.name;
  const owned = owners.length ? { owners } : {};
  const message = (n) => ({
    resource: {
      id: n.id, name: n.name, version: VERSION, summary: summary(n, ctx), ...owned,
      ...(n.fields.length ? { schemaPath: 'schema.json' } : {}),
      markdown: `## Overview\n\n${n.name}.${usedIn(n)}`,
    },
    schema: n.fields.length ? JSON.stringify(toJsonSchema(n.fields), null, 2) + '\n' : null,
  });
  return {
    events: model.events.map(message),
    commands: model.commands.map(message),
    queries: model.queries.map(message),
    flows: model.flows.map((flow) => ({
      resource: {
        id: flow.id, name: flow.name, version: VERSION, summary: `Event model of ${flow.name}.`, ...owned,
        steps: flow.steps.map((s) => ({
          id: s.id,
          title: s.node.name,
          message: { id: s.node.id },
          ...(s.next.length > 1 ? { next_steps: s.next } : s.next.length ? { next_step: s.next[0] } : {}),
        })),
        markdown: `## Overview\n\nGenerated from the event model chapter "${flow.name}".\n`,
      },
    })),
    domain: {
      resource: {
        id: model.domain.id, name: ctx, version: VERSION, summary: `Event model context ${ctx}.`, ...owned,
        ...(model.flows.length ? { flows: model.flows.map((f) => ({ id: f.id })) } : {}),
        markdown: `## Overview\n\nExported from the Eventmodelers context "${ctx}".\n`,
      },
    },
  };
}
