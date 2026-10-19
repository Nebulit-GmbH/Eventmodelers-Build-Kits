// Where the build kits of a project live: the root and up to two directory levels below it, so `run --all` finds
// both kits of a scaffolded app (root and web/) whether it is started in the app or in the folder holding it.
// Hidden directories and node_modules are not searched.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_DEPTH = 2;

export function findBuildKitDirs(root, kitDirNames) {
  const has = (dir) => kitDirNames.some((name) => existsSync(join(dir, name)));
  const found = [];
  const visit = (dir, depth) => {
    if (has(dir)) found.push(dir);
    if (depth === MAX_DEPTH) return;
    const children = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => join(dir, e.name))
      .sort();
    for (const child of children) visit(child, depth + 1);
  };
  visit(root, 0);
  return found;
}
