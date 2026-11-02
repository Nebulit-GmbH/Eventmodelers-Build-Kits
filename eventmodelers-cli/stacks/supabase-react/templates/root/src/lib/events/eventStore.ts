import type { AppEvent } from './types';

export interface EventStoreState {
  readonly events: readonly AppEvent[];
  /** `true` while a recorded log is being replayed: the gateway refuses to run command functions. */
  readonly replaying: boolean;
}

/** In-memory, append-only event log. Nothing is persisted; a reload starts with an empty log. */
export interface EventStore {
  /** Immutable snapshot, replaced (never mutated) on every change — safe for `useSyncExternalStore`. */
  getState(): EventStoreState;
  subscribe(listener: () => void): () => void;
  append(events: readonly AppEvent[]): void;
  /**
   * Replace the log with a recorded one and enter replay mode: every projection (and so the UI)
   * re-derives from these events alone, and no command function runs until `goLive()`.
   */
  replay(events: readonly AppEvent[]): void;
  /** Leave replay mode, keeping the events. New commands run (and append) again. */
  goLive(): void;
}

export function createEventStore(initialEvents: readonly AppEvent[] = []): EventStore {
  let state: EventStoreState = { events: initialEvents, replaying: false };
  const listeners = new Set<() => void>();

  const set = (next: EventStoreState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    append(events) {
      if (events.length === 0) return;
      set({ ...state, events: [...state.events, ...events] });
    },
    replay(events) {
      set({ events: [...events], replaying: true });
    },
    goLive() {
      if (state.replaying) set({ ...state, replaying: false });
    },
  };
}
