// A slice build's tool calls as events in the slice-state log, so `run --sync` can show them on the board. Any
// runner that sees its agent's individual tool calls records them through here, so every runner logs the same shape.

import { appendEvent } from './slice-events.js';

// Only the tool's name is recorded — never its input. A Bash command, a skill's arguments or a path can hold
// credentials or local details, and this log is shared with everyone who can open the board. Best effort, like the
// rest of the sharing: a failed write must not cost the build. Only a planned-slice build (`slice.sliceId`) records.
export function recordToolCall({ kitDir, slice, tool, meta }) {
  if (!slice?.sliceId) return;
  try {
    appendEvent(kitDir, { type: 'tool-call', slice: slice.sliceId, tool }, meta);
  } catch (err) {
    console.error(`[ralph] could not record a tool call (${err.message})`);
  }
}
