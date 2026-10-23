import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code reads a skill's frontmatter leniently; Mastra's workspace skills (and any strict YAML parser) do not, and
// silently skip a skill whose description has an unquoted `: ` in it. This catches that without a YAML dependency.
const root = fileURLToPath(new URL('..', import.meta.url));

function skillFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return skillFiles(p);
    return name === 'SKILL.md' ? [p] : [];
  });
}

test('every skill\'s frontmatter is valid YAML for a strict parser', () => {
  const bad = [];
  for (const dir of ['stacks', 'shared']) {
    for (const file of skillFiles(join(root, dir))) {
      const m = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      for (const line of m[1].split('\n')) {
        const kv = line.match(/^([A-Za-z][\w-]*): (.+)$/);
        if (!kv) continue;
        const value = kv[2].trim();
        if (/^(["'>|\[{])/.test(value)) continue; // quoted, a block scalar or a flow collection
        if (/: |\s#/.test(value)) bad.push(`${file.slice(root.length)}: ${kv[1]} — quote it, or use \`${kv[1]}: >-\` with the text on the next line`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
