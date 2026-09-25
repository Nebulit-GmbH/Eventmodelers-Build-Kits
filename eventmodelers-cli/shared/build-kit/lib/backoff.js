// Exponential backoff with jitter: baseMs, 2×, 4×, … capped at capMs. Half the delay is
// fixed, half random, so agents that failed together (a platform restart takes every agent
// on it down at once) don't all come back in the same second.
//
// attempt is 1-based — the delay before the first retry is between baseMs/2 and baseMs.

export function backoffMs(attempt, { baseMs, capMs }) {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
