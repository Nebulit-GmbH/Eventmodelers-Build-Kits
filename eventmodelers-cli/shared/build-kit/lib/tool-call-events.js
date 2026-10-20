// A slice build's tool calls as events in the slice-state log, so `run --sync` can show them on the board. Any
// runner that sees its agent's individual tool calls records them through here, so every runner logs the same shape.

import { appendEvent } from './slice-events.js';
import { redactString } from './redact.js';

// Best effort, like the rest of the sharing: a failed write must not cost the build. `detail` is the one-line
// account of the call's input, with the token and anything JWT-shaped masked — a Bash command can hold
// credentials, and this log is shared. Only a planned-slice build (`slice.sliceId`) records anything.
export function recordToolCall({ kitDir, slice, tool, detail, cfg, meta }) {
  if (!slice?.sliceId) return;
  try {
    appendEvent(kitDir, { type: 'tool-call', slice: slice.sliceId, tool, detail: redactString(detail, [cfg?.token]) }, meta);
  } catch (err) {
    console.error(`[ralph] could not record a tool call (${err.message})`);
  }
}
