#!/usr/bin/env node
'use strict';

// Runner for the slice commit-scope guard. Loads every check module from
// ./checks/*.cjs and runs it against the currently staged changeset.
//
// Check interface (see ./checks/README.md for the full contract + a template):
//   module.exports = {
//     name: 'my-check',              // short id, shown in violation output
//     skipIfAlreadyFailing: false,   // optional — skip this check once an earlier
//                                    // one has already failed (use for slow checks)
//     run(ctx) {
//       return [{ path: 'some/file.ts', reason: 'why this is a problem' }];
//     },
//   };
// `run()` returns an array of violations (empty array/undefined/null = pass).
//
// `ctx` passed to every check:
//   changes        [{status, path}] — staged files (git status letter + path)
//   touchesSlice    true — this commit touches src/slices/{context}/{slice}/**
//                   (the runner already gates on this before loading checks)
//   repoRoot        absolute path to the repo root
//   SLICE_PATTERN   RegExp matching a path inside a slice's own folder
//
// Zero dependencies — plain Node, so it works from git's pre-commit hook
// (see ../../.githooks/pre-commit), from `npm run run:checks`, or from CI.
// Invoked as: node .build-kit/lib/check-commit-scope.cjs

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SLICE_PATTERN = /^src\/slices\/[^/]+\/[^/]+\//;

function stagedChanges() {
  const out = execSync('git diff --cached --name-status --no-renames', { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status: status[0], path: rest.join('\t') };
    });
}

function loadChecks() {
  const checksDir = path.join(__dirname, 'checks');
  if (!fs.existsSync(checksDir)) return [];
  return fs
    .readdirSync(checksDir)
    .filter((f) => f.endsWith('.cjs'))
    .sort() // numeric filename prefixes (00-, 10-, ...) control run order
    .map((f) => {
      let mod;
      try {
        mod = require(path.join(checksDir, f));
      } catch (err) {
        console.error(`check-commit-scope: failed to load checks/${f} — ${err.message}`);
        return null;
      }
      if (typeof mod?.run !== 'function') {
        console.error(`check-commit-scope: skipping checks/${f} — does not export { name, run(ctx) }`);
        return null;
      }
      return { file: f, name: mod.name || f, run: mod.run, skipIfAlreadyFailing: !!mod.skipIfAlreadyFailing };
    })
    .filter(Boolean);
}

function main() {
  let changes;
  try {
    changes = stagedChanges();
  } catch (err) {
    console.error('check-commit-scope: could not read staged changes —', err.message);
    process.exit(1);
  }

  if (changes.length === 0) process.exit(0);

  const touchesSlice = changes.some((c) => SLICE_PATTERN.test(c.path));
  if (!touchesSlice) process.exit(0); // not a slice commit — nothing to enforce

  const ctx = {
    changes,
    touchesSlice,
    repoRoot: execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(),
    SLICE_PATTERN,
  };

  const checks = loadChecks();
  const violations = [];
  const claimedPaths = new Set(); // first check to flag a path wins — avoids repeat noise

  for (const check of checks) {
    if (check.skipIfAlreadyFailing && violations.length > 0) continue;

    let result;
    try {
      result = check.run(ctx) || [];
    } catch (err) {
      violations.push({ path: '(check error)', reason: `[${check.name}] threw: ${err.message}` });
      continue;
    }

    for (const v of result) {
      if (claimedPaths.has(v.path)) continue;
      claimedPaths.add(v.path);
      violations.push({ path: v.path, reason: `[${check.name}] ${v.reason}` });
    }
  }

  if (violations.length > 0) {
    console.error('\n❌ commit blocked — slice commit-scope guard found issues:\n');
    for (const v of violations) console.error(`  - ${v.path} — ${v.reason}`);
    console.error('\nSee .build-kit/lib/checks/ for what each check enforces.\n');
    process.exit(1);
  }

  process.exit(0);
}

main();
