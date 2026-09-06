'use strict';

// Heuristic: a slice's *.test.ts must have at least as many `it(...)` blocks as
// slice.json has `specifications[]` entries. Doesn't verify each spec is
// actually tested (that would need matching scenario content, not just count),
// just that nobody's silently short a test case. Skipped (not blocked) when
// slice.json can't be found or has no specifications[] array.

const fs = require('fs');
const path = require('path');
const { findSliceJson } = require('../util/find-slice.cjs');

const TEST_FILE = /^src\/slices\/([^/]+)\/([^/]+)\/[^/]+\.test\.ts$/;
const IT_BLOCK = /\bit(?:\.(?:only|skip))?\s*\(/g;

module.exports = {
  name: 'spec-coverage',
  run(ctx) {
    const violations = [];

    for (const { path: p } of ctx.changes) {
      TEST_FILE.lastIndex = 0;
      const m = TEST_FILE.exec(p);
      if (!m) continue;
      const [, context, sliceName] = m;

      const slice = findSliceJson(ctx.repoRoot, context, sliceName);
      if (!slice || !Array.isArray(slice.specifications) || slice.specifications.length === 0) continue;

      let content;
      try {
        content = fs.readFileSync(path.join(ctx.repoRoot, p), 'utf8');
      } catch {
        continue; // deleted — nothing to check
      }

      const specCount = slice.specifications.length;
      const itCount = (content.match(IT_BLOCK) || []).length;

      if (itCount < specCount) {
        violations.push({
          path: p,
          reason: `slice.json declares ${specCount} specification(s) but this test file only has ${itCount} it(...) block(s)`,
        });
      }
    }

    return violations;
  },
};
