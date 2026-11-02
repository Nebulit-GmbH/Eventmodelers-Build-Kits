import { CommandCompleted, CommandFailed, CommandStarted } from './commandGateway';
import { defineProjection } from './projection';

export interface CommandStatus {
  /** Commands of this name started but not yet completed/failed. */
  pending: number;
  /** Last failure, cleared when the same command is sent again. */
  error?: { message: string; status?: number; body?: unknown };
}

/** Per-command-name status, derived from the gateway's lifecycle events (so it replays too). */
export const commandStatusProjection = defineProjection<Record<string, CommandStatus>>({
  initial: {},
  evolve(state, event) {
    if (CommandStarted.is(event)) {
      const { name } = event.data;
      return { ...state, [name]: { pending: (state[name]?.pending ?? 0) + 1 } };
    }
    if (CommandCompleted.is(event)) {
      const { name } = event.data;
      const current = state[name];
      return { ...state, [name]: { pending: Math.max(0, (current?.pending ?? 1) - 1), error: current?.error } };
    }
    if (CommandFailed.is(event)) {
      const { name, message, status, body } = event.data;
      return { ...state, [name]: { pending: Math.max(0, (state[name]?.pending ?? 1) - 1), error: { message, status, body } } };
    }
    return state;
  },
});
