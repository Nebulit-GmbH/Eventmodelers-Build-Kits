'use strict';

// migrations/V{n}__*.sql may only be ADDED, never modified or deleted — migrations
// are append-only; a fix belongs in a new migration, not an edit to an old one.

const MIGRATION_PATTERN = /^migrations\/V\d+__.*\.sql$/;

module.exports = {
  name: 'append-only-migrations',
  run(ctx) {
    const violations = [];
    for (const { status, path: p } of ctx.changes) {
      if (!MIGRATION_PATTERN.test(p)) continue;
      if (status !== 'A') {
        violations.push({ path: p, reason: 'existing migrations are append-only; add a new V{n} file instead of editing this one' });
      }
    }
    return violations;
  },
};
