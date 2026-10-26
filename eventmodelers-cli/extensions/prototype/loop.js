// The agent loop of `run --prototype`: each iteration reads the control log (control.js), and when the player recorded requests nobody has
// processed — a saved feedback, Sync, Fetch, Rebuild — works through them. What was processed is in the log, so the loop remembers across restarts and
// never does a request twice. A sync with nothing else open needs no model: the loop runs it itself. Everything else is one turn of the
// local-prototype-control skill over the open requests, in order — in a warm Agent Client Protocol session (the build kits' acp-session.js): one
// agent process kept for the life of the loop, so a turn does not pay for starting the agent and re-reading the skills. The conversation is
// reset every RESET_EVERY turns to keep its context small. Claude (the claude-agent-acp adapter) by default; `--agent <name>` / `--acp-cmd`
// pick another ACP agent. Permission requests are answered with "allow", as everywhere ACP is used here.
// One iteration is the whole update: translate the feedback (one agent turn: feedback → executable ChangeRequested events, changes.js), execute the
// changes one by one in global order (execute.js — deterministic: applied to the local model, written to the board as the node:changed event or the
// recorded tool call), refresh the model after tool calls, rebuild the stale slices (a second agent turn). The model judges only the translation and
// the rebuild; everything in between is executed as recorded.
// Feedback is always translated and its changes applied to the local model and the page. Whether they also go to the board is `direct`
// (run --prototype --sync: executed right away, one by one); without it they stay local — recorded in .prototype/changes/ — until
// `prototype sync` (or the player's Sync button, a SyncRequested) executes them. Pressing Sync or Rebuild is a request for exactly that.
import { createAcpSession } from '../../shared/build-kit/lib/acp-session.js';
import { claim, control, markProcessed } from './control.js';
import { runChanges, runnableLocally, syncAll } from './pipeline.js';
import { assemble } from './local-build.js';
import { hasLocalChanges } from './sync.js';
import { screensToDesign, syncScreens } from './screens-sync.js';

const POLL_MS = 2000;
const RESET_EVERY = 8;
const TURN_TIMEOUT_MS = 20 * 60_000;
const QUIET_MS = 15_000; // the model has to hold still this long before the prototype is rebuilt from it

const where = (c) => (c
  ? `You are connected to board ${c.boardId} on ${c.api.replace(/^https?:\/\//, '')}${c.context ? `, ${c.contextType || 'context'} "${c.context}"${c.contextId ? ` (id ${c.contextId}${c.contextType === 'timeline' ? ' — the chapter / timelineId a tool asks for' : ''})` : ''}` : ''}. `
  : 'No board is connected (a local-only prototype): there are no board changes to make, only the local model. ');

const PROMPT = (ids, connection) => [
  '/local-prototype-control',
  '',
  `Open requests (event ids, oldest first): ${ids.join(', ')}. Work only on these; leave any other open request alone.`,
  where(connection).trim(),
  'You run unattended inside `run --prototype`: nobody can answer questions. This is feedback (a `FeedbackRecorded`, or a `FeedbackAnswered` — the answers of the person to the questions of an earlier one): translate it only — record its executable changes (`prototype changes add`) and `prototype changes translated`; do NOT execute them, the loop runs `prototype changes run` right after and rebuilds the page. A field a screen should show is TWO changes — the `fields` of the node and the `pages` of the HTML screen (the board screen is only updated by a change of pages). Reading the board is yours (the connect skill; credentials in `.eventmodelers/config.json`), writing it is not (the changes do that when executed). Changes must follow the event modeling rules (the `eventmodeling-*` skills; read `eventmodeling-core-rules` first): for example every automation needs a todo-list read model, so "when X happens, do Y" is several changes in order. Never ask for what you can look up: the ids of the board (context / timeline = chapter, slices) are in `prototype board`, the exact input of a tool is in `prototype tools <name>` — look them up and write the call. For an item that is a real choice of the person, do not guess and do not ask — leave it out of the changes and pass it as an `--ask` to `changes translated` with 2–3 concrete options.',
].join('\n');

/** Starts the loop; returns { stop }. `agent` is a resolved ACP agent; `credentials()` resolves the board credentials (only a sync needs them). */
export function startAgentLoop({ cwd, agent, connection = null, credentials, direct = false, stale = () => [], refetch = async () => {}, log = console.log }) {
  let busy = false, stopped = false, turns = 0;
  const session = createAcpSession({ agent, cwd, log: (m) => log(`   ${m}`) });
  let waitingTold = 0; // how many changes the loop last said are waiting for the board

  const agentRun = async (pending) => {
    const ids = pending.map((e) => e.id);
    for (const id of ids) claim(cwd, id);
    log(`\n⚙ Agent: ${pending.map((e) => e.type).join(', ')} — working through ${ids.length} request${ids.length === 1 ? '' : 's'} (${agent.label}, warm session) …`);
    try {
      if (turns > 0 && turns % RESET_EVERY === 0) session.reset();
      turns++;
      const { text } = await session.runTurn(PROMPT(ids, connection), { timeoutMs: TURN_TIMEOUT_MS, onToolCall: (name) => log(`   → ${name}`) });
      const tail = text.split('\n').slice(-8).join('\n');
      if (tail) log(tail.replace(/^/gm, '   '));
    } catch (err) {
      log(`❌ ${err.message}`);
    }
    // A request the turn did not record is recorded now, so it is not retried forever; the player shows it, the person decides.
    for (const e of control(cwd).pending.filter((p) => ids.includes(p.id))) markProcessed(cwd, e.id, 'needs-you', 'The agent turn ended without finishing this request — run /local-prototype-control in Claude Code.');
  };

  const syncOnly = async (pending) => {
    for (const e of pending) claim(cwd, e.id);
    log('\n⚙ Agent: SyncRequested — writing the model changes back to the board …');
    try {
      await syncAll(cwd, (await credentials()).cfg, { log });
      for (const e of pending) markProcessed(cwd, e.id, 'applied', 'Synced.');
    } catch (err) {
      log(`❌ Sync failed: ${err.message}`);
      for (const e of pending) markProcessed(cwd, e.id, 'failed', err.message);
    }
  };

  // The rest of the iteration after the feedback was translated: execute the changes, refresh, rebuild.
  const changesStage = async () => {
    const todo = direct ? control(cwd).pendingChanges.length + control(cwd).unsubmitted.length : runnableLocally(cwd).length;
    if (!todo) return;
    log(`\n⚙ Changes: executing ${todo} one by one${direct ? ' (applied locally and written to the board)' : ' (applied locally; the board gets them with `prototype sync`)'} …`);
    let cfg = null;
    if (direct) {
      try { cfg = (await credentials()).cfg; } catch (err) { log(`❌ No board credentials: ${err.message} — the changes stay pending (apply them locally with \`prototype changes run\`).`); return; }
    }
    const { local, toolCalls } = await runChanges(cwd, cfg, { toBoard: direct, log });
    if (!direct) {
      const waiting = control(cwd).pendingChanges.length + control(cwd).unsubmitted.length;
      if (waiting && waiting !== waitingTold) log(`   ${waiting} change${waiting === 1 ? '' : 's'} wait${waiting === 1 ? 's' : ''} for the board — \`prototype sync\` (or Sync in the player) writes them, one by one, in order.`);
      waitingTold = waiting;
    }
    // A tool call changed the board, not the local model: take the board's version — unless the model has edits of its own that would be lost.
    if (toolCalls && !hasLocalChanges(cwd)) { try { await refetch(); log('   ↻ model refreshed from the board'); } catch (err) { log(`   could not refresh the model: ${err.message}`); } }
    else if (toolCalls) log('   the model has unsynced edits, so it was not refreshed — run `prototype fetch` after syncing');
    if ((local || toolCalls) && stale().length) await buildTurn('changes applied');
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

  // A slice a tool call created brings its screen with no design (\"Untitled screen — design pending\" on the board). Once the model is fetched the screens are
  // known here: one agent turn designs them in the look of the existing screens (local-prototype-model), locally; they reach the board with the sync like any
  // screen edit — here at once with --sync.
  let designedSig = null;
  const designScreens = async () => {
    const todo = screensToDesign(cwd);
    const sig = JSON.stringify(todo.map((s) => s.screenId));
    if (!todo.length || sig === designedSig) return;
    designedSig = sig;
    log(`\n⚙ Screens to design: ${todo.map((s) => `"${s.title || s.sliceTitle}"`).join(', ')} …`);
    const list = todo.map((s) => `- screen "${s.title}" of slice "${s.sliceTitle}" (${s.sliceType}), folder .prototype/screens/${s.screenId}/ — fields: ${s.fields.join(', ') || '(none)'}; connected: ${s.connectedTo.join('; ') || '(none)'}`).join('\n');
    try {
      if (turns > 0 && turns % RESET_EVERY === 0) session.reset();
      turns++;
      await session.runTurn(`/local-prototype-model\n\nDesign the HTML screens below — each is a screen of a slice that was just created and still shows "Untitled screen — design pending". Follow the html-screen skill and the look of the existing screens (same shell, colors, spacing; read a few of .prototype/screens/*/page-1.html first). Each screen shows what its slice is about: the inputs of its command (the fields above, with their types) and the button that fires it, or the columns of its read model. Write the pages into the screen's folder (page-1.html, and the pages list of its screen.json) — locally only; do not touch the board. Unattended: do not ask questions.\n\n${list}`, { timeoutMs: TURN_TIMEOUT_MS, onToolCall: (name) => log(`   → ${name}`) });
      if (direct) { try { await syncScreens(cwd, (await credentials()).cfg, { log }); } catch (err) { log(`   could not write the screens to the board: ${err.message}`); } }
    } catch (err) { log(`❌ screens: ${err.message}`); }
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
    const idle = !control(cwd).pending.length && !(direct ? control(cwd).pendingChanges.length + control(cwd).unsubmitted.length : runnableLocally(cwd).length);
    if (idle && !stale().length && !(screensToDesign(cwd).length && JSON.stringify(screensToDesign(cwd).map((s) => s.screenId)) !== designedSig)) { seenStale = null; return; }
    busy = true;
    try {
      // One iteration is the whole update: the open requests in order — feedback is translated and its changes executed at once — then whatever
      // changes are left, then the prototype brought up to date with the slices.
      for (let guard = 0; guard < 50; guard++) {
        const open = control(cwd).pending;
        const next = open[0];
        if (!next) break;
        if (next.type === 'SyncRequested') await syncOnly(open.filter((e) => e.type === 'SyncRequested'));
        else if (next.type === 'FetchRequested') await fetchRequested(open.filter((e) => e.type === 'FetchRequested'));
        else if (next.type === 'RebuildRequested') await rebuildRequested(open.filter((e) => e.type === 'RebuildRequested'));
        else { await agentRun([next]); await changesStage(); }
      }
      await changesStage();
      await designScreens();
      await autoRebuild();
    } finally { busy = false; }
  };

  const timer = setInterval(() => { void iterate(); }, POLL_MS);
  void iterate();
  return { busy: () => busy, stop: () => { stopped = true; clearInterval(timer); session.close(); } };
}
