// What the agent's session holds of the board's chat conversations: `cursors` maps a chat session to the last message
// handed to it, so a later turn reads only what came since. That is only true while the agent's session lives — one that
// starts over (or never keeps anything) has read nothing, and must read a conversation whole. The warm `claude` process
// clears the map when it goes, as does an ACP agent's (the runner's `onSessionLost`); these two cover the rest.

/**
 * The message a chat turn reads after, or null to read the conversation whole: always for a compact request (it is
 * summarized from what the platform holds, not from what the agent remembers), and whenever the runner holds nothing —
 * a local model, an --exec harness with a process per turn, or a warm session that has yet to complete a turn.
 */
export function readAfter(cursors, sessionId, { compact = false, localRunner = null, execRunner = null } = {}) {
  // Every conversation, not only this one: this turn primes the session, and the next one must not trust an old cursor.
  if (localRunner || (execRunner && !execRunner.keepsSession)) cursors.clear();
  return compact ? null : cursors.get(sessionId) ?? null;
}

/**
 * Drops a runner's session (a local model has none to drop), and with it what it had read. How the context of a runner
 * that isn't the warm `claude` process is shrunk: it can't be compacted from here, so it starts over.
 */
export async function resetRunnerSession(runner, cursors) {
  await runner.resetSession?.();
  cursors.clear();
}
