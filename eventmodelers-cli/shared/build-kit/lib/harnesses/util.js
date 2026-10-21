// Helpers the harness modules share.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// POSIX single-quote escaping: close, insert an escaped quote, reopen. A turn is multi-line
// text with backticks and $ in it, so it cannot go in unquoted.
export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Adds or refreshes one key in a project JSON config, leaving everything else in it alone. A file
// that isn't plain JSON (a JSONC one with comments) is not rewritten — returns false instead, and
// the caller says what to add by hand.
export function mergeJsonConfig(path, apply) {
  let config = {};
  if (existsSync(path)) {
    try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
  }
  apply(config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}
