// Runs several long-lived processes side by side in one terminal: output prefixed with the process name,
// Ctrl+c (or any one of them exiting) stops all of them, children included.
import { spawn, spawnSync } from 'node:child_process';
import { invocation } from './scaffold.js';

// Stops a process and everything it started. POSIX: the child leads its own process group, so one signal
// reaches the tree. Windows has no groups, taskkill walks the tree instead.
export function killTree(pid, signal = 'SIGINT', platform = process.platform) {
  if (platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-pid, signal); } catch {}
}

// specs: [{ name, file, args, cwd }]. Resolves with the exit code once everything has stopped.
export function supervise(specs, { log = console.log, graceMs = 3000, handleSignals = true } = {}) {
  const width = Math.max(...specs.map((s) => s.name.length));
  return new Promise((done) => {
    let stopping = false;
    let exitCode = 0;
    let running = specs.length;
    const children = [];

    const finish = () => done(exitCode);
    const stop = (code = 0) => {
      if (stopping) return;
      stopping = true;
      exitCode = code;
      for (const child of children) if (child.exitCode === null) killTree(child.pid);
      setTimeout(finish, graceMs).unref();
    };

    for (const spec of specs) {
      const inv = invocation(spec.file, spec.args);
      // POSIX: detached makes the child its own group leader (see killTree). Windows: it would open a console window.
      const child = spawn(inv.file, inv.args, { cwd: spec.cwd, shell: inv.shell, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      for (const out of [child.stdout, child.stderr]) {
        let rest = '';
        out.on('data', (chunk) => {
          const lines = (rest + chunk).split('\n');
          rest = lines.pop();
          for (const line of lines) log(`${spec.name.padEnd(width)} | ${line}`);
        });
      }
      child.on('error', (err) => {
        log(`${spec.name.padEnd(width)} | failed to start: ${err.message}`);
        stop(1);
      });
      child.on('exit', (code) => {
        if (!stopping) log(`${spec.name.padEnd(width)} | exited (${code}), stopping the rest`);
        stop(code ?? 0);
        if (--running === 0) finish();
      });
    }

    if (handleSignals) {
      process.once('SIGINT', () => stop());
      process.once('SIGTERM', () => stop());
    }
  });
}
