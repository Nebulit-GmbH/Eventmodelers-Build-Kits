import { createElement, type ComponentType } from 'react';
import { PAGES } from './model';
import { NotBuilt } from '../lib/NotBuilt';

// Every file in src/pages is routed without editing the router: a page from the model gets its route from
// model.ts, and any other page file gets /pages/<file-name>. The page component is the export named like the
// file (web kit convention), or the default export.
const modules = import.meta.glob<Record<string, ComponentType>>('../pages/*.tsx', { eager: true });

const byName = new Map(
  Object.entries(modules).map(([file, mod]) => {
    const name = file.replace(/^.*\/(.*)\.tsx$/, '$1');
    return [name, mod[name] ?? mod.default] as const;
  }),
);

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const missing = (title: string): ComponentType => () => createElement(NotBuilt, { detail: `The page file for "${title}" is missing.` });

export const pageRoutes: { route: string; Component: ComponentType }[] = [
  ...PAGES.map((p) => ({ route: p.route, Component: byName.get(p.name) ?? missing(p.title) })),
  ...[...byName.entries()]
    .filter(([name, Component]) => Component && !PAGES.some((p) => p.name === name))
    .map(([name, Component]) => ({ route: `/pages/${kebab(name)}`, Component: Component! })),
];
