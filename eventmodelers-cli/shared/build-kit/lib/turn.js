// Wall-clock cap on one agent turn. Without it a hung harness (a stuck tool call, a
// network stall, an interactive prompt nobody answers) blocks the loop forever — no
// further tasks, no further slices, and the stuck-slice guard never gets a look in.
//
// RALPH_TURN_TIMEOUT_MIN (env) or turnTimeoutMinutes (.eventmodelers/config.json);
// default 60, 0 turns the cap off.

import { execFile, execFileSync } from 'child_process';
import { constants as osConstants } from 'os';

const KILL_GRACE_MS = 10_000;

export function turnTimeoutMs(cfg) {
  const raw = process.env.RALPH_TURN_TIMEOUT_MIN ?? cfg?.turnTimeoutMinutes ?? 60;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

// Thrown (rejected) by a runner whose turn hit the cap. ralph.js's runWithRetry lets it
// through to the outer loop instead of re-running the same turn in place, so a slice
// that times out again is counted — and eventually Blocked — by the stuck-slice guard.
export class TurnTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${Math.round(timeoutMs / 60_000)}min`);
    this.timedOut = true;
  }
}

// SIGTERM, then SIGKILL after a grace period. `shell: true` means proc is only the /bin/sh
// wrapping the real command, so its children are signalled first — killing just the shell
// would orphan the harness and leave it running. (A separate process group would be
// cleaner, but a background group reading the terminal gets stopped by SIGTTIN, and
// Ctrl-C would no longer reach it.)
// The shell is only signalled once pkill has returned: killed any earlier, its children are
// re-parented to init before pkill -P gets to look for them, and survive.
function signal(proc, sig, viaShell) {
  const killSelf = () => { try { proc.kill(`SIG${sig}`); } catch { /* already gone */ } };
  if (viaShell && proc.pid) execFile('pkill', [`-${sig}`, '-P', String(proc.pid)], killSelf);
  else killSelf();
}

// Stopping the loop has to stop its turn too. Ctrl-C only ever worked because the terminal
// signals the whole foreground group; a SIGTERM from systemd, Docker or `kill` reaches this
// process alone, and the node default (exit on the spot) left the running agent orphaned —
// still editing the project with nobody watching it. So: on SIGTERM/SIGINT/SIGHUP, stop every
// live turn the same way a timeout does and exit once they're gone. A second signal exits
// immediately (force-killing whatever is still running), for when the grace period is too
// long to wait out.
const liveTurns = new Set();
let shuttingDown = false;
let exitCode = 0;
let handlersInstalled = false;

// Synchronous SIGKILL, for the one path that exits right after: an async pkill would never
// get to run.
function killNow(proc, viaShell) {
  if (viaShell && proc.pid) {
    try { execFileSync('pkill', ['-KILL', '-P', String(proc.pid)]); } catch { /* no children left */ }
  }
  try { proc.kill('SIGKILL'); } catch { /* already gone */ }
}

function exitOnSignal(sig) {
  const code = 128 + (osConstants.signals[sig] ?? 15);
  if (liveTurns.size === 0) process.exit(code);
  if (shuttingDown) {
    // Second signal: don't wait out the grace period, but don't orphan a turn that ignored
    // the first one either.
    for (const t of liveTurns) killNow(t.proc, t.viaShell);
    process.exit(code);
  }
  shuttingDown = true;
  exitCode = code;
  for (const t of liveTurns) {
    t.log(`Received ${sig} — stopping ${t.label} before exiting (send it again to exit now)`);
    signal(t.proc, 'TERM', t.viaShell);
    setTimeout(() => signal(t.proc, 'KILL', t.viaShell), KILL_GRACE_MS);
  }
  // Backstop: a child whose close never fires mustn't keep the process up forever.
  setTimeout(() => process.exit(code), KILL_GRACE_MS + 2_000);
}

function trackTurn(entry) {
  if (!handlersInstalled) {
    handlersInstalled = true;
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => exitOnSignal(sig));
  }
  liveTurns.add(entry);
  entry.proc.on('close', () => {
    liveTurns.delete(entry);
    if (shuttingDown && liveTurns.size === 0) process.exit(exitCode);
  });
}

export function superviseTurn(proc, { timeoutMs, label, log, viaShell = false }) {
  trackTurn({ proc, label, log, viaShell });
  let timedOut = false;
  let killTimer;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        log(`${label} exceeded ${Math.round(timeoutMs / 60_000)}min — stopping it`);
        signal(proc, 'TERM', viaShell);
        killTimer = setTimeout(() => signal(proc, 'KILL', viaShell), KILL_GRACE_MS);
      }, timeoutMs)
    : null;
  proc.on('close', () => {
    clearTimeout(timer);
    clearTimeout(killTimer);
  });
  return { timedOut: () => timedOut };
}
