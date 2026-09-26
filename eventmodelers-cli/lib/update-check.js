import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';

const REGISTRY_URL = 'https://registry.npmjs.org/@eventmodelers/cli/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

// Kit dirs `re-init` can refresh, and how to ask it to.
const REINIT_COMMANDS = {
  '.build-kit': 'eventmodelers re-init',
  '.agent-modeling-kit': 'eventmodelers re-init --modeling',
};

// Numeric compare of x.y.z versions — negative when a < b. Pre-release suffixes are ignored.
export function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

// The latest published version, asked of the npm registry at most once a day — in between,
// the answer cached at cachePath is reused. Best effort: offline, slow or broken registry
// responses just yield whatever was cached last (or null).
export async function latestPublishedVersion({ cachePath, now = Date.now(), fetchImpl = fetch } = {}) {
  const cache = readJson(cachePath);
  if (cache.latest && now - (cache.checkedAt || 0) < CHECK_INTERVAL_MS) return cache.latest;

  try {
    const res = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return cache.latest || null;
    const { version } = await res.json();
    if (!version) return cache.latest || null;
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify({ latest: version, checkedAt: now }));
    } catch {}
    return version;
  } catch {
    return cache.latest || null;
  }
}

// Hint lines for everything that's behind: this CLI against npm, and each installed kit
// against the CLI running now (its install manifest records the version that wrote it).
export function updateHints({ currentVersion, latestVersion, kitDirs = [], cwd = process.cwd() }) {
  const hints = [];
  if (latestVersion && compareVersions(currentVersion, latestVersion) < 0) {
    hints.push(`💡 A new eventmodelers CLI is available: ${currentVersion} → ${latestVersion}. Update with: npm i -g @eventmodelers/cli@latest (or use npx @eventmodelers/cli@latest)`);
  }
  for (const kitDir of kitDirs) {
    const reinit = REINIT_COMMANDS[basename(kitDir)];
    const manifestPath = join(kitDir, '.eventmodelers', 'install-manifest.json');
    if (!reinit || !existsSync(manifestPath)) continue;
    const kitVersion = readJson(manifestPath).version;
    if (kitVersion && compareVersions(kitVersion, currentVersion) >= 0) continue;
    hints.push(`💡 ${relative(cwd, kitDir) || kitDir}/ was installed by CLI ${kitVersion || '(unknown version)'} — refresh it to ${currentVersion} with: ${reinit}`);
  }
  return hints;
}
