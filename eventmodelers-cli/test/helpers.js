import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Silences the loop's own logging for the duration of a test.
export function quiet(t, methods = ['log', 'warn', 'error']) {
  for (const m of methods) t.mock.method(console, m, () => {});
}

// process.exit can't really run inside the test process — make it throw instead, so the test
// sees that (and how) it was called.
export function mockExit(t) {
  return t.mock.method(process, 'exit', (code) => {
    throw Object.assign(new Error('process.exit'), { exitCode: code });
  });
}

// An empty kit dir, removed again after the test.
export function tempKit(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ralph-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
