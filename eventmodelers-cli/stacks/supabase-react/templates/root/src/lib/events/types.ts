/**
 * Event-sourced UI — core types. Nothing in `src/lib/events` knows about any slice: slices define
 * their own events, command functions and projections and plug them into this machinery.
 *
 * These are FRONTEND events: facts about what happened in the UI session (a command was accepted or
 * rejected, a snapshot was loaded). They are not the backend's domain events and must not mirror or
 * be named after them — the backend owns those, the UI only observes outcomes.
 */

export interface EventMeta {
  /** ISO timestamp, set by the gateway when the event is appended. */
  timestamp: string;
  /** Id of the command (one `gateway.send`) that caused this event. */
  causationId?: string;
}

/** An event as stored in the log. The log is the single source of truth for what the UI shows. */
export interface AppEvent<TType extends string = string, TData = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly data: TData;
  readonly meta: EventMeta;
}

/** What a command function returns: the gateway turns it into an `AppEvent` (id + meta). */
export interface NewEvent<TType extends string = string, TData = unknown> {
  readonly type: TType;
  readonly data: TData;
}

/** The `NewEvent` a definition produces: `EventOf<typeof ReserveBikeRejected>`. Union them per slice. */
export type EventOf<TDef extends (data: never) => NewEvent> = ReturnType<TDef>;

export interface EventDefinition<TType extends string, TData> {
  /** Build the event a command function returns. */
  (data: TData): NewEvent<TType, TData>;
  readonly type: TType;
  /** Type guard for projections: `if (BikeReserved.is(event)) event.data.bikeId`. */
  is(event: AppEvent): event is AppEvent<TType, TData>;
}

/**
 * Declare an event a slice owns (or, for an event another slice emits, re-declare it locally with
 * only the fields this slice reads — the type string is the contract, never import another slice).
 *
 *   export const BikeReserved = defineEvent<'BikeReserved', { bikeId: string }>('BikeReserved');
 */
export function defineEvent<TType extends string, TData>(
  type: TType,
): EventDefinition<TType, TData> {
  const factory = (data: TData): NewEvent<TType, TData> => ({ type, data });
  return Object.assign(factory, {
    type,
    is: (event: AppEvent): event is AppEvent<TType, TData> => event.type === type,
  });
}
