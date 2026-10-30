// The agent loop of `run --prototype`: each iteration reads the control log (control.js), and when the player recorded requests nobody has
// processed — Sync, Fetch, Rebuild — works through them. What was processed is in the log, so the loop remembers across restarts and never does a
// request twice. Sync and Fetch need no model: the loop runs them itself. A Rebuild (and the slices that went stale because the model changed) is one
// turn of the local-prototype-build skill, in a warm Agent Client Protocol session (the build kits' acp-session.js): one agent process kept for the
// life of the loop, so a turn does not pay for starting the agent and re-reading the skills. The conversation is reset every RESET_EVERY turns to
// keep its context small. Claude (the claude-agent-acp adapter) by default; `--agent <name>` / `--acp-cmd` pick another ACP agent. Permission
// requests are answered with "allow", as everywhere ACP is used here.
// Feedback does not come through here: it is submitted to the platform, whose /apply-feedback applies it to the model.
import { createAcpSession } from '../../shared/build-kit/lib/acp-session.js';
import { claim, control, markProcessed } from './control.js';
import { assemble } from './local-build.js';
import { hasLocalChanges, runSync } from './sync.js';

const POLL_MS = 2000;
const RESET_EVERY = 8;
const TURN_TIMEOUT_MS = 20 * 60_000;
const QUIET_MS = 15_000; // the model has to hold still this long before the prototype is rebuilt from it

/** Starts the loop; returns { stop }. `agent` is a resolved ACP agent; `credentials()` resolves the board credentials (only a sync needs them). */
export function startAgentLoop({ cwd, agent, credentials, stale = () => [], refetch = async () => {}, log = console.log }) {
  let busy = false, stopped = false, turns = 0;
  const session = createAcpSession({ agent, cwd, log: (m) => log(`   ${m}`) });

  const syncOnly = async (pending) => {
    for (const e of pending) claim(cwd, e.id);
    log('\n⚙ Agent: SyncRequested — writing the model changes back to the board …');
    try {
      await runSync({ cwd, cfg: (await credentials()).cfg, yes: true, quiet: true });
      for (const e of pending) markProcessed(cwd, e.id, 'applied', 'Synced.');
    } catch (err) {
      log(`❌ Sync failed: ${err.message}`);
      for (const e of pending) markProcessed(cwd, e.id, 'failed', err.message);
    }
  };

  // The page is a reflection of the model: a turn of the build skill brings the stale slices into it (patching the previous blocks), then it is assembled.
  const buildTurn = async (why) => {
    log(`\n⚙ Rebuild (${why}): ${stale().length} slice${stale().length === 1 ? '' : 's'} to build …`);
    try {
      if (turns > 0 && turns % RESET_EVERY === 0) session.reset();
      turns++;
      await session.runTurn('/local-prototype-build\n\nBuild the slices that are new or changed (`prototype status`): patch the previous block of a changed one, then `prototype assemble`. Unattended: do not ask questions.', { timeoutMs: TURN_TIMEOUT_MS, onToolCall: (name) => log(`   → ${name}`) });
    } catch (err) { log(`❌ rebuild: ${err.message}`); }
  };

  // The board may have changed a screen or a field since the fetch: take its version first — unless the model has edits of its own that would be lost.
  const refresh = async () => {
    if (hasLocalChanges(cwd)) { log('   the model has unsynced edits, so it was not refreshed from the board — `prototype sync` first, then Rebuild'); return; }
    try { await refetch(); log('   ↻ model refreshed from the board'); } catch (err) { log(`   could not refresh the model: ${err.message}`); }
  };

  // Fetch pressed: the board's latest slice definitions replace the local ones — unless the model has edits that are not synced, which are never overwritten.
  const fetchRequested = async (requests) => {
    for (const e of requests) claim(cwd, e.id);
    log('\n⚙ Fetch requested — the board\'s latest slice definitions …');
    if (hasLocalChanges(cwd)) {
      log('   the model has unsynced edits, so nothing was fetched — Sync first');
      for (const e of requests) markProcessed(cwd, e.id, 'needs-you', 'The local model has edits that are not synced yet — Sync first, then Fetch.');
      return;
    }
    try {
      await refetch();
      log('   ↻ model fetched from the board');
      for (const e of requests) markProcessed(cwd, e.id, 'applied', 'Fetched the latest slice definitions.');
      if (stale().length) await buildTurn('fetched');
    } catch (err) {
      log(`❌ fetch: ${err.message}`);
      for (const e of requests) markProcessed(cwd, e.id, 'failed', err.message);
    }
  };

  // Rebuild pressed: build what is stale in the local slices (one agent turn), assemble. Several open ones are one rebuild. The board is Fetch's business.
  const rebuildRequested = async (requests) => {
    for (const e of requests) claim(cwd, e.id);
    log('\n⚙ Rebuild requested …');
    let note;
    try {
      if (stale().length) { await buildTurn('requested'); note = `rebuilt ${stale().length === 0 ? 'the stale slices' : 'what it could'}`; }
      else { const r = assemble(cwd); note = `nothing was stale; the page was assembled again (${r.blocks} blocks)`; log(`   ${note}`); }
      for (const e of requests) markProcessed(cwd, e.id, stale().length ? 'needs-you' : 'applied', stale().length ? `${stale().length} slice(s) are still stale — run /local-prototype-build` : note);
    } catch (err) {
      log(`❌ rebuild: ${err.message}`);
      for (const e of requests) markProcessed(cwd, e.id, 'failed', err.message);
    }
  };

  // Without anyone asking: when the slices changed (a person edited the model, the board changed it) and held still, the prototype follows them.
  let seenStale = null, firstSeen = 0, tried = null;
  const autoRebuild = async () => {
    const s = stale();
    if (!s.length) { seenStale = null; return; }
    const sig = JSON.stringify(s.map((x) => [x.id, x.hash]));
    if (sig !== seenStale) { seenStale = sig; firstSeen = Date.now(); return; }
    if (sig === tried || Date.now() - firstSeen < QUIET_MS) return;
    tried = sig;
    await buildTurn('the slices changed');
  };

  const iterate = async () => {
    if (busy || stopped) return;
    try {
      await iterateOnce();
    } catch (err) {
      // One bad iteration (a file rewritten under it, a board error) must not take the player down with it: say so and go on.
      busy = false;
      log(`❌ Agent loop: ${err && err.message ? err.message : err}`);
    }
  };

  const iterateOnce = async () => {
    if (!control(cwd).pending.length && !stale().length) { seenStale = null; return; }
    busy = true;
    try {
      // One iteration is the whole update: the open requests in order, then the prototype brought up to date with the slices.
      for (let guard = 0; guard < 50; guard++) {
        const open = control(cwd).pending;
        const next = open[0];
        if (!next) break;
        if (next.type === 'SyncRequested') await syncOnly(open.filter((e) => e.type === 'SyncRequested'));
        else if (next.type === 'FetchRequested') await fetchRequested(open.filter((e) => e.type === 'FetchRequested'));
        else await rebuildRequested(open.filter((e) => e.type === 'RebuildRequested'));
      }
      await autoRebuild();
    } finally { busy = false; }
  };

  const timer = setInterval(() => { void iterate(); }, POLL_MS);
  void iterate();
  return { busy: () => busy, stop: () => { stopped = true; clearInterval(timer); session.close(); } };
}
