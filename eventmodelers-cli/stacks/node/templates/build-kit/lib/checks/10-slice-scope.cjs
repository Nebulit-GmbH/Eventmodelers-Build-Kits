'use strict';

// Everything staged in a slice commit must be inside the slice's own folder, or
// one of the documented shared-infra exceptions a slice legitimately registers
// *into* (never rewrites wholesale). See build-kit/lib/AGENT.md and the
// build-state-view/build-automation SKILL.md files for what a compliant edit to
// an exception file looks like. Migration files have their own dedicated check
// (20-append-only-migrations.cjs), so they're allowed through here.

const ALLOWED_EXCEPTIONS = [
  /^src\/slices\/[^/]+\/[A-Za-z0-9]+Events\.ts$/, // per-context event union (append-only)
  /^src\/common\/loadPostgresEventstore\.ts$/, // projection registration / schema.migrate()
];

const MIGRATION_PATTERN = /^migrations\/V\d+__.*\.sql$/;

module.exports = {
  name: 'slice-scope',
  run(ctx) {
    const violations = [];
    for (const { path: p } of ctx.changes) {
      if (ctx.SLICE_PATTERN.test(p)) continue;
      if (MIGRATION_PATTERN.test(p)) continue;
      if (ALLOWED_EXCEPTIONS.some((r) => r.test(p))) continue;
      violations.push({ path: p, reason: 'outside src/slices/{context}/{slice}/ and not a documented exception' });
    }
    return violations;
  },
};
