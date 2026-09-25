// Wall-clock cap on one agent turn. Without it a hung harness (a stuck tool call, a
// network stall, an interactive prompt nobody answers) blocks the loop forever — no
// further tasks, no further slices, and the stuck-slice guard never gets a look in.
//
// RALPH_TURN_TIMEOUT_MIN (env) or turnTimeoutMinutes (.eventmodelers/config.json);
// default 60, 0 turns the cap off.

import { execFile } from 'child_process';

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

export function superviseTurn(proc, { timeoutMs, label, log, viaShell = false }) {
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
