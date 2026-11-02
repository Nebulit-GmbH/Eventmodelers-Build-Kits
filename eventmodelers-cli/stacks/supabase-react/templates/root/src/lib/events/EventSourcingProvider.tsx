import { useEffect, useState, type ReactNode } from 'react';
import { createCommandGateway } from './commandGateway';
import { EventSourcingContext, type EventSourcingContextValue } from './context';
import { createEventStore, type EventStore } from './eventStore';
import type { AppEvent } from './types';

/**
 * Mounts the in-memory event store and the command gateway once, app-wide (see `src/main.tsx`).
 * Pass `store` to start from a prepared log (tests, a replayed session).
 *
 * In dev, `window.__events` lets you record and replay from the console:
 *   copy(JSON.stringify(__events.dump()))   // record
 *   __events.replay(JSON.parse(json))       // UI re-derives from events only, no remote calls
 *   __events.goLive()                       // back to normal
 */
export function EventSourcingProvider({ children, store: injected }: { children: ReactNode; store?: EventStore }) {
  const [value] = useState<EventSourcingContextValue>(() => {
    const store = injected ?? createEventStore();
    return { store, gateway: createCommandGateway(store) };
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const { store } = value;
    (window as unknown as { __events?: unknown }).__events = {
      dump: () => store.getState().events,
      replay: (events: AppEvent[]) => store.replay(events),
      goLive: () => store.goLive(),
    };
  }, [value]);

  return <EventSourcingContext.Provider value={value}>{children}</EventSourcingContext.Provider>;
}
