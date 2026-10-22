// Writes the resources through the EventCatalog SDK, which the *catalog* provides: it is resolved from the
// target directory's node_modules, never bundled with this CLI, so it always matches the catalog's version.

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

const PACKAGE = '@eventcatalog/sdk';

// An EventCatalog project has an eventcatalog.config.* file and/or depends on @eventcatalog/core.
export function isCatalog(dir) {
  if (['js', 'mjs', 'cjs', 'ts'].some((ext) => existsSync(join(dir, `eventcatalog.config.${ext}`)))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    return Boolean({ ...pkg.dependencies, ...pkg.devDependencies }['@eventcatalog/core']);
  } catch {
    return false;
  }
}

// The SDK's `utils` factory, or null when the catalog doesn't have the package.
export async function loadSdk(catalogDir) {
  let file;
  try {
    file = createRequire(join(catalogDir, 'package.json')).resolve(PACKAGE);
  } catch {
    return null;
  }
  const mod = await import(file);
  return typeof mod.default === 'function' ? mod.default : mod.default.default; // CJS entry nests the factory
}

// `npm install` into the catalog — adds the SDK to the *catalog's* package.json, not this CLI's.
export function installSdk(catalogDir) {
  execFileSync('npm', ['install', PACKAGE], { cwd: catalogDir, stdio: 'inherit' });
}

// [resources key, SDK name part, singular for `<x>HasVersion`, label folder]
const KINDS = [
  ['events', 'Event', 'event', 'events'], ['commands', 'Command', 'command', 'commands'], ['queries', 'Query', 'query', 'queries'],
  ['flows', 'Flow', 'flow', 'flows'], ['domain', 'Domain', 'domain', 'domains'],
];

// Existing resources (same id and version) are left alone — they may have been edited. `force` overwrites them.
// The schema file is attached after the resource (its `schemaPath` is already in the frontmatter).
export async function writeResources(utils, resources, { force = false } = {}) {
  const written = [];
  const skipped = [];
  for (const [key, Name, singular, folder] of KINDS) {
    const items = key === 'domain' ? [resources.domain] : resources[key];
    for (const { resource, schema } of items) {
      const label = `${folder}/${resource.id}`;
      if (await utils[`${singular}HasVersion`](resource.id, resource.version)) {
        if (!force) { skipped.push(label); continue; }
      }
      await utils[`write${Name}`](resource, { override: force });
      if (schema) await utils[`addSchemaTo${Name}`](resource.id, { schema, fileName: 'schema.json' }, resource.version);
      written.push(label);
    }
  }
  return { written, skipped };
}
