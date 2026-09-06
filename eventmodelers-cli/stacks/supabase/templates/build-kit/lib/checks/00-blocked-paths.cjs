'use strict';

// Rejects a slice commit that touches shared infra which must never change from
// slice work: the package manifest/lockfiles (no new/changed dependencies) and
// server.ts (routes/processors are auto-discovered — never wired there by hand).

const BLOCKED = [
  {
    pattern: /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/,
    reason: 'dependency/package manifest changes are not allowed from a slice commit',
  },
  {
    pattern: /^server\.ts$/,
    reason: 'server.ts is shared infra (routes/processors are auto-discovered) — never touched by slice work',
  },
];

module.exports = {
  name: 'blocked-paths',
  run(ctx) {
    const violations = [];
    for (const { path: p } of ctx.changes) {
      const hit = BLOCKED.find((b) => b.pattern.test(p));
      if (hit) violations.push({ path: p, reason: hit.reason });
    }
    return violations;
  },
};
