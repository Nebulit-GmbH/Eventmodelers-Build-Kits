import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/turn-parent.mjs', import.meta.url));

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Starts the fixture, waits until its turn is running, and resolves the turn's pid.
function startParent(t, mode) {
  const parent = spawn(process.execPath, [fixture, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => parent.on('exit', (code, signal) => resolve({ code, signal })));
  const childPid = new Promise((resolve, reject) => {
    let out = '';
    parent.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/child (\d+)/);
      if (m) resolve(Number(m[1]));
    });
    parent.on('exit', () => reject(new Error('parent exited before its turn started')));
  });
  t.after(async () => { // never leave a process behind, even when an assertion failed
    const pid = await childPid.catch(() => null);
    if (pid && isAlive(pid)) process.kill(pid, 'SIGKILL');
    if (parent.exitCode === null) parent.kill('SIGKILL');
  });
  return { parent, exited, childPid };
}

for (const mode of ['plain', 'shell']) {
  test(`SIGTERM stops the running turn before exiting (${mode})`, async (t) => {
    const { parent, exited, childPid } = startParent(t, mode);
    const pid = await childPid;
    parent.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 143, signal: null });
    assert.equal(isAlive(pid), false, 'the turn outlived its loop');
  });
}

test('a second signal exits at once and still kills a turn that ignores SIGTERM', async (t) => {
  const { parent, exited, childPid } = startParent(t, 'stubborn');
  const pid = await childPid;
  parent.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(isAlive(pid), true, 'a stubborn turn survives the first SIGTERM');
  const startedAt = Date.now();
  parent.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 143, signal: null });
  assert.ok(Date.now() - startedAt < 2_000, 'exited without waiting out the grace period');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(isAlive(pid), false, 'the stubborn turn outlived its loop');
});
