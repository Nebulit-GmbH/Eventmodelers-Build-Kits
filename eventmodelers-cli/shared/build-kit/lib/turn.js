// Wall-clock cap on one agent turn. Without it a hung harness (a stuck tool call, a
// network stall, an interactive prompt nobody answers) blocks the loop forever — no
// further tasks, no further slices, and the stuck-slice guard never gets a look in.
//
// RALPH_TURN_TIMEOUT_MIN (env) or turnTimeoutMinutes (.eventmodelers/config.json);
// default 60, 0 turns the cap off.

import { execFileSync } from 'child_process';
import { constants as osConstants } from 'os';

const KILL_GRACE_MS = 10_000;

export function turnTimeoutMs(cfg) {
  const raw = process.env.RALPH_TURN_TIMEOUT_MIN ?? cfg?.turnTimeoutMinutes ?? 60;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

// What a timed-out turn rejects with. ralph.js's runWithRetry lets it (`timedOut`) through
// to the outer loop instead of re-running the same turn in place, so a slice that times out
// again is counted — and eventually Blocked — by the stuck-slice guard.
class TurnTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${Math.round(timeoutMs / 60_000)}min`);
    this.timedOut = true;
  }
}

// `shell: true` means proc is only the /bin/sh wrapping the real command, so its children are
// signalled first — killing just the shell would orphan the harness and leave it running. (A
// separate process group would be cleaner, but a background group reading the terminal gets
// stopped by SIGTTIN, and Ctrl-C would no longer reach it.) pkill runs synchronously so the
// shell is still alive, and its children still its own, when pkill -P looks for them.
function signal(proc, sig, viaShell) {
  if (viaShell && proc.pid) {
    try { execFileSync('pkill', [`-${sig}`, '-P', String(proc.pid)]); } catch { /* no children left */ }
  }
  try { proc.kill(`SIG${sig}`); } catch { /* already gone */ }
}

// SIGTERM, then SIGKILL once the grace period is up.
function stop(turn) {
  signal(turn.proc, 'TERM', turn.viaShell);
  turn.killTimer = setTimeout(() => signal(turn.proc, 'KILL', turn.viaShell), KILL_GRACE_MS);
}

// Stopping the loop has to stop its turn too: a SIGTERM from systemd, Docker or `kill` reaches
// this process alone (only Ctrl-C signals the whole foreground group), and node's default —
// exit on the spot — left the running agent orphaned, still editing the project. So every
// live turn is stopped the way a timeout stops it, and the process exits once they're gone.
// A second signal doesn't wait out the grace period: it SIGKILLs what's left and exits.
const liveTurns = new Set();
let exitCode = null; // set once a shutdown signal has arrived

function exitOnSignal(sig) {
  const code = 128 + osConstants.signals[sig];
  if (liveTurns.size === 0) process.exit(code);
  if (exitCode !== null) {
    for (const t of liveTurns) signal(t.proc, 'KILL', t.viaShell);
    process.exit(code);
  }
  exitCode = code;
  for (const t of liveTurns) {
    t.log(`Received ${sig} — stopping ${t.label} before exiting (send it again to exit now)`);
    stop(t);
  }
  // Backstop: a child whose close never fires mustn't keep the process up forever.
  setTimeout(() => process.exit(code), KILL_GRACE_MS + 2_000);
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => exitOnSignal(sig));

// Returns timeoutError(): the error to reject with once the turn has closed, or null when it
// didn't hit the cap.
export function superviseTurn(proc, { timeoutMs, label, log, viaShell = false }) {
  const turn = { proc, label, log, viaShell, killTimer: null };
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        log(`${label} exceeded ${Math.round(timeoutMs / 60_000)}min — stopping it`);
        stop(turn);
      }, timeoutMs)
    : null;
  liveTurns.add(turn);
  proc.on('close', () => {
    clearTimeout(timer);
    clearTimeout(turn.killTimer);
    liveTurns.delete(turn);
    if (exitCode !== null && liveTurns.size === 0) process.exit(exitCode);
  });
  return { timeoutError: () => (timedOut ? new TurnTimeoutError(label, timeoutMs) : null) };
}
