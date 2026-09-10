'use strict';

// Everything staged in a slice commit must be inside the slice's own folder (or
// a webhook's self-contained edge function), or one of the documented
// shared-infra exceptions a slice legitimately registers *into* (never rewrites
// wholesale). See build-kit/lib/AGENT.md and the build-state-view/
// build-automation/build-webhook SKILL.md files for what a compliant edit to an
// exception file looks like. Migration files have their own dedicated check
// (20-append-only-migrations.cjs), so they're allowed through here.

const WEBHOOK_FUNCTION_PATTERN = /^supabase\/functions\/[^/]+\/index\.ts$/;

const ALLOWED_EXCEPTIONS = [
  /^src\/slices\/[^/]+\/[A-Za-z0-9]+Events\.ts$/, // per-context event union (append-only)
  /^src\/common\/loadPostgresEventstore\.ts$/, // projection registration / schema.migrate()
  /^supabase\/config\.toml$/, // webhook function registration (verify_jwt entry)
];

const MIGRATION_PATTERN = /^supabase\/migrations\/V\d+__.*\.sql$/;

// Captures the {context}/{slice} segment so files from two different slices
// in one commit can be told apart — SLICE_PATTERN alone only proves a path is
// *inside some* slice folder, not which one.
const SLICE_KEY_PATTERN = /^src\/slices\/([^/]+\/[^/]+)\//;

module.exports = {
  name: 'slice-scope',
  run(ctx) {
    const violations = [];

    const sliceKeys = new Set();
    for (const { path: p } of ctx.changes) {
      const m = p.match(SLICE_KEY_PATTERN);
      if (m) sliceKeys.add(m[1]);
    }
    const primarySlice = [...sliceKeys].sort()[0] || null;

    for (const { path: p } of ctx.changes) {
      if (WEBHOOK_FUNCTION_PATTERN.test(p)) continue;
      if (MIGRATION_PATTERN.test(p)) continue;
      if (ALLOWED_EXCEPTIONS.some((r) => r.test(p))) continue;

      const m = p.match(SLICE_KEY_PATTERN);
      if (!m) {
        violations.push({ path: p, reason: 'outside src/slices/{context}/{slice}/ and not a documented exception' });
        continue;
      }
      if (m[1] !== primarySlice) {
        violations.push({
          path: p,
          reason: `touches slice "${m[1]}" but this commit's scope is "${primarySlice}" — split into separate commits`,
        });
      }
    }
    return violations;
  },
};
