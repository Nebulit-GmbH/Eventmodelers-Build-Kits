'use strict';

// A slice commit that adds/changes a command handler, projection, or processor
// must also include a *.test.ts for that slice — catches the agent skipping the
// matching build skill's test step (build-state-change Step 4 / build-state-view
// Step 5 / build-automation's DeciderSpecification tests).

const { execSync } = require('child_process');

const IMPLEMENTATION_FILE = /^src\/slices\/([^/]+)\/([^/]+)\/(?:[A-Za-z0-9]+Command|[A-Za-z0-9]+Projection|processor(?:-[A-Za-z0-9]+)?)\.ts$/;

module.exports = {
  name: 'test-file-present',
  run(ctx) {
    const sliceDirs = new Set();
    for (const { path: p } of ctx.changes) {
      const m = IMPLEMENTATION_FILE.exec(p);
      if (m) sliceDirs.add(`src/slices/${m[1]}/${m[2]}`);
    }
    if (sliceDirs.size === 0) return [];

    let tracked = [];
    try {
      tracked = execSync('git ls-files -- src/slices', { cwd: ctx.repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
    } catch {
      // best-effort — fall through with whatever's staged
    }
    const known = new Set([...tracked, ...ctx.changes.map((c) => c.path)]);

    const violations = [];
    for (const dir of sliceDirs) {
      const hasTest = [...known].some((f) => f.startsWith(`${dir}/`) && f.endsWith('.test.ts'));
      if (!hasTest) {
        violations.push({
          path: dir,
          reason: 'no *.test.ts found for this slice — command handlers/projections/processors need test coverage',
        });
      }
    }
    return violations;
  },
};
