import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, latestPublishedVersion, updateHints } from '../lib/update-check.js';
import { tempKit } from './helpers.js';

const registry = (version) => async () => ({ ok: true, json: async () => ({ version }) });
const offline = async () => { throw new Error('ENOTFOUND'); };

function kit(root, name, version) {
  const dir = join(root, name);
  mkdirSync(join(dir, '.eventmodelers'), { recursive: true });
  writeFileSync(join(dir, '.eventmodelers', 'install-manifest.json'), JSON.stringify(version ? { version } : {}));
  return dir;
}

test('compareVersions compares numerically, not lexically', () => {
  assert.ok(compareVersions('1.0.9', '1.0.10') < 0);
  assert.ok(compareVersions('1.1.0', '1.0.99') > 0);
  assert.equal(compareVersions('1.0.90', '1.0.90'), 0);
});

test('latestPublishedVersion caches the registry answer for a day', async (t) => {
  const cachePath = join(tempKit(t), 'update-check.json');
  assert.equal(await latestPublishedVersion({ cachePath, now: 0, fetchImpl: registry('1.0.91') }), '1.0.91');
  assert.equal(await latestPublishedVersion({ cachePath, now: 1000, fetchImpl: registry('9.9.9') }), '1.0.91');
  assert.equal(await latestPublishedVersion({ cachePath, now: 25 * 3600 * 1000, fetchImpl: registry('1.0.92') }), '1.0.92');
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf-8')).latest, '1.0.92');
});

test('latestPublishedVersion falls back to the cache, or null, when offline', async (t) => {
  const cachePath = join(tempKit(t), 'update-check.json');
  assert.equal(await latestPublishedVersion({ cachePath, fetchImpl: offline }), null);
  writeFileSync(cachePath, JSON.stringify({ latest: '1.0.91', checkedAt: 0 }));
  assert.equal(await latestPublishedVersion({ cachePath, now: 25 * 3600 * 1000, fetchImpl: offline }), '1.0.91');
});

test('updateHints flags a newer CLI on npm, not an older or equal one', () => {
  assert.equal(updateHints({ currentVersion: '1.0.90', latestVersion: '1.0.91' }).length, 1);
  assert.deepEqual(updateHints({ currentVersion: '1.0.90', latestVersion: '1.0.90' }), []);
  assert.deepEqual(updateHints({ currentVersion: '1.0.90', latestVersion: null }), []);
});

test('updateHints flags kits written by an older CLI with the matching re-init command', (t) => {
  const root = tempKit(t);
  const kitDirs = [
    kit(root, '.build-kit', '1.0.80'),
    kit(root, '.agent-modeling-kit'),
    kit(root, '.bridge-kit', '1.0.1'),
  ];
  const hints = updateHints({ currentVersion: '1.0.90', latestVersion: '1.0.90', kitDirs, cwd: root });
  assert.equal(hints.length, 2);
  assert.match(hints[0], /\.build-kit\/ was installed by CLI 1\.0\.80 .* eventmodelers re-init$/);
  assert.match(hints[1], /\.agent-modeling-kit\/ .* eventmodelers re-init --modeling$/);
});

test('updateHints stays quiet for a kit already on the current CLI', (t) => {
  const root = tempKit(t);
  const kitDirs = [kit(root, '.build-kit', '1.0.90')];
  assert.deepEqual(updateHints({ currentVersion: '1.0.90', latestVersion: null, kitDirs, cwd: root }), []);
});
