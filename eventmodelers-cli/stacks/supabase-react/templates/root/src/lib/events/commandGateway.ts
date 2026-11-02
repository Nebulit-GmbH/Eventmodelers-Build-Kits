import type { EventStore } from './eventStore';
import { defineEvent, type AppEvent, type NewEvent } from './types';

/**
 * A command is a plain async function: input in, events out. The remote call (`postCommand`,
 * `queryReadModel`, ...) lives *inside* it, so the gateway needs no knowledge of any command.
 * `TEvent` is the slice's own event union (`EventOf<typeof A> | EventOf<typeof B>`): the function and
 * its `onError` can return nothing else, so a command is tied to the events its slice declares.
 *
 * Every outcome is an event: a command declares one for success (`<Command>Accepted`) and one per
 * named failure (`<Command>Rejected`). A read returns what the UI learned (`…Found` / `No…Found` /
 * `…Listed`) carrying the displayed fields, so a replay can render it with no remote call.
 */
export type CommandFn<TInput, TEvent extends NewEvent = NewEvent> = (
  input: TInput,
) => Promise<readonly TEvent[]> | readonly TEvent[];

export interface Command<TInput, TEvent extends NewEvent = NewEvent> extends CommandFn<TInput, TEvent> {
  readonly commandName: string;
  /** Slice-specific failure events for a thrown error (the gateway always adds `command.failed`). */
  readonly onError?: (error: unknown, input: TInput) => readonly TEvent[];
}

/**
 *   type ReserveBikeEvent = EventOf<typeof ReserveBikeAccepted> | EventOf<typeof ReserveBikeRejected>;
 *   defineCommand<ReserveBikeInput, ReserveBikeEvent>('ReserveBike', async (input) => { ... }, { onError })
 */
export function defineCommand<TInput, TEvent extends NewEvent = NewEvent>(
  name: string,
  fn: CommandFn<TInput, TEvent>,
  options: { onError?: Command<TInput, TEvent>['onError'] } = {},
): Command<TInput, TEvent> {
  return Object.assign((input: TInput) => fn(input), { commandName: name, onError: options.onError });
}

/** Lifecycle events the gateway itself writes — the UI's "submitting"/"failed" states derive from them. */
export const COMMAND_STARTED = 'command.started';
export const COMMAND_COMPLETED = 'command.completed';
export const COMMAND_FAILED = 'command.failed';

export interface CommandStartedData {
  name: string;
  commandId: string;
  input: unknown;
}
export interface CommandCompletedData {
  name: string;
  commandId: string;
}
export interface CommandFailedData {
  name: string;
  commandId: string;
  message: string;
  /** HTTP-ish status when the thrown error carries one (e.g. `ApiError`). */
  status?: number;
  body?: unknown;
}

// Typed definitions, so projections narrow with `.is()` instead of casting.
export const CommandStarted = defineEvent<typeof COMMAND_STARTED, CommandStartedData>(COMMAND_STARTED);
export const CommandCompleted = defineEvent<typeof COMMAND_COMPLETED, CommandCompletedData>(COMMAND_COMPLETED);
export const CommandFailed = defineEvent<typeof COMMAND_FAILED, CommandFailedData>(COMMAND_FAILED);

/** `true` for the gateway's `command.completed` of the command named `name` (the board's command title). */
export function isCommandCompleted(event: AppEvent, name: string): boolean {
  return CommandCompleted.is(event) && event.data.name === name;
}

export type CommandResult =
  | { status: 'completed'; events: readonly AppEvent[] }
  | { status: 'failed'; events: readonly AppEvent[]; error: unknown }
  /** Replay mode: nothing ran, nothing was appended. */
  | { status: 'skipped'; events: readonly AppEvent[] };

export interface CommandGateway {
  /** Run a command, append its events. Never throws — failures become events. */
  send<TInput, TEvent extends NewEvent>(command: Command<TInput, TEvent>, input: TInput): Promise<CommandResult>;
}

export function createCommandGateway(store: EventStore): CommandGateway {
  const toEvent = (event: NewEvent, commandId: string): AppEvent => ({
    id: crypto.randomUUID(),
    type: event.type,
    data: event.data,
    meta: { timestamp: new Date().toISOString(), causationId: commandId },
  });

  return {
    async send(command, input) {
      // Replay must never reach the network, even though components fire their loads on mount.
      if (store.getState().replaying) return { status: 'skipped', events: [] };

      const commandId = crypto.randomUUID();
      const name = command.commandName;
      const started: CommandStartedData = { name, commandId, input };
      store.append([toEvent({ type: COMMAND_STARTED, data: started }, commandId)]);

      try {
        const produced = await command(input);
        const events = [
          ...produced.map((e) => toEvent(e, commandId)),
          toEvent({ type: COMMAND_COMPLETED, data: { name, commandId } satisfies CommandCompletedData }, commandId),
        ];
        store.append(events);
        return { status: 'completed', events };
      } catch (error) {
        const failure: CommandFailedData = { name, commandId, ...describeError(error) };
        const events = [
          ...(command.onError?.(error, input) ?? []).map((e) => toEvent(e, commandId)),
          toEvent({ type: COMMAND_FAILED, data: failure }, commandId),
        ];
        store.append(events);
        return { status: 'failed', events, error };
      }
    },
  };
}

function describeError(error: unknown): Pick<CommandFailedData, 'message' | 'status' | 'body'> {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  if (typeof error === 'object' && error !== null) {
    const { status, body } = error as { status?: unknown; body?: unknown };
    return { message, status: typeof status === 'number' ? status : undefined, body };
  }
  return { message };
}
