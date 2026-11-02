import { useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { type Command } from './commandGateway';
import { commandStatusProjection } from './commandStatus';
import { EventSourcingContext, type EventSourcingContextValue } from './context';
import type { EventStore } from './eventStore';
import { project, type Projection } from './projection';
import type { AppEvent } from './types';

function useEventSourcing(): EventSourcingContextValue {
  const ctx = useContext(EventSourcingContext);
  if (!ctx) throw new Error('Event-sourcing hooks must be used within EventSourcingProvider (see src/main.tsx)');
  return ctx;
}

export const useEventStore = (): EventStore => useEventSourcing().store;
export const useCommandGateway = () => useEventSourcing().gateway;

/** `true` while a recorded log is being replayed (e.g. to show a banner). */
export function useReplaying(): boolean {
  const store = useEventStore();
  return useSyncExternalStore(store.subscribe, () => store.getState().replaying);
}

/**
 * The state a projection derives from the event log. Folds only the newly appended events when the
 * log merely grew; re-folds from scratch when it was replaced (replay). Define the projection at
 * module level so its identity is stable.
 */
export function useProjection<TState>(projection: Projection<TState>): TState {
  const store = useEventStore();
  const cache = useRef<{ projection: Projection<TState>; events: readonly AppEvent[]; state: TState } | null>(null);

  const getSnapshot = (): TState => {
    const { events } = store.getState();
    const prev = cache.current;
    if (prev && prev.projection === projection && prev.events === events) return prev.state;

    const grew =
      prev !== null &&
      prev.projection === projection &&
      events.length >= prev.events.length &&
      (prev.events.length === 0 || events[prev.events.length - 1] === prev.events[prev.events.length - 1]);

    const state = grew
      ? events.slice(prev.events.length).reduce(projection.evolve, prev.state)
      : project(projection, events);
    cache.current = { projection, events, state };
    return state;
  };

  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/**
 * Handle for one command: a stable `send`, and `pending`/`error` derived from the gateway's
 * lifecycle events (so they are part of the replayable log, not component state).
 */
export function useCommand<TInput>(command: Command<TInput>) {
  const gateway = useCommandGateway();
  const status = useProjection(commandStatusProjection)[command.commandName];
  const send = useCallback((input: TInput) => gateway.send(command, input), [gateway, command]);
  return { send, pending: (status?.pending ?? 0) > 0, error: status?.error };
}
