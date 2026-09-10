'use strict';

// Shared by checks that need to cross-reference code against the slice's own
// definition. Not a check itself — no `run(ctx)` interface here.

const fs = require('fs');
const path = require('path');

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Given the {context}/{SliceName} folder names used under src/slices/, find the
// matching slice.json under .build-kit/.slices/<contextSlug>/<sliceFolder>/. The
// two sides are slugified differently (see shared/skills/load-slice/SKILL.md —
// contextSlug is hyphenated, sliceFolder strips all spaces), so this matches on
// a normalized (lowercase, alphanumeric-only) form instead of exact equality.
// Returns null — never throws — when zero or more than one candidate matches;
// callers should treat that as "can't verify" and skip rather than block.
function findSliceJson(repoRoot, context, sliceName) {
  const root = path.join(repoRoot, '.build-kit', '.slices');
  if (!fs.existsSync(root)) return null;

  const wantContext = normalize(context);
  const wantSlice = normalize(sliceName);
  const candidates = [];

  let contextDirs;
  try {
    contextDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const contextDir of contextDirs) {
    if (!contextDir.isDirectory()) continue;
    if (normalize(contextDir.name) !== wantContext) continue;
    const contextPath = path.join(root, contextDir.name);
    let sliceDirs;
    try {
      sliceDirs = fs.readdirSync(contextPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sliceDir of sliceDirs) {
      if (!sliceDir.isDirectory()) continue;
      if (normalize(sliceDir.name) !== wantSlice) continue;
      const slicePath = path.join(contextPath, sliceDir.name, 'slice.json');
      if (fs.existsSync(slicePath)) candidates.push(slicePath);
    }
  }

  if (candidates.length !== 1) return null;
  try {
    return JSON.parse(fs.readFileSync(candidates[0], 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { findSliceJson, normalize };
