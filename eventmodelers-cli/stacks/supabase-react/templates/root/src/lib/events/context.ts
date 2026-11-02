import { createContext } from 'react';
import type { CommandGateway } from './commandGateway';
import type { EventStore } from './eventStore';

export interface EventSourcingContextValue {
  store: EventStore;
  gateway: CommandGateway;
}

export const EventSourcingContext = createContext<EventSourcingContextValue | null>(null);
