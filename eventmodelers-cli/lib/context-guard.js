// The warm `claude` process carries every turn in one conversation, so it only grows. Two rules keep it from wedging:
//  - when a turn fails because the conversation no longer fits ("Prompt is too long"), the session is poisoned — every
//    later turn would fail the same way — so it is replaced by a fresh one and the turn is tried once more;
//  - before that happens, a conversation that has grown past a share of the window is compacted between turns.
// Pure: the runner decides what to do with the answers.

/** True when a turn's error says the conversation does not fit the model's context window. */
export function isPromptTooLong(err) {
  const text = typeof err === 'string' ? err : err?.message;
  return /prompt is too long|context (length|window).*(exceed|too (long|large))|exceeds the context/i.test(String(text ?? ''));
}

/** The window the warm session is assumed to have; override with EVENTMODELERS_CONTEXT_WINDOW (tokens). */
export const DEFAULT_CONTEXT_WINDOW = 200000;
/** Share of the window after which the conversation is compacted before the next turn. */
export const COMPACT_AT = 0.75;

export function contextWindow(env = process.env) {
  const n = Number(env.EVENTMODELERS_CONTEXT_WINDOW);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTEXT_WINDOW;
}

/** Should the next turn start with a /compact? `contextTokens` is what the last model call carried. */
export function shouldCompact(contextTokens, window = DEFAULT_CONTEXT_WINDOW) {
  return Number.isFinite(contextTokens) && contextTokens >= window * COMPACT_AT;
}
