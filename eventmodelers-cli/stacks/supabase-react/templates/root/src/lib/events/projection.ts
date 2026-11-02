import type { AppEvent } from './types';

/**
 * A projection folds events into UI state. It is pure: same events in, same state out — which is
 * exactly what makes a recorded log replayable into the right UI without any remote call.
 * Each slice defines its own; a projection may react to other slices' events by type string.
 */
export interface Projection<TState> {
  readonly initial: TState;
  /** Return `state` itself (same reference) for events that don't concern this projection. */
  readonly evolve: (state: TState, event: AppEvent) => TState;
}

export function defineProjection<TState>(projection: Projection<TState>): Projection<TState> {
  return projection;
}

/** Fold a whole log. Used by tests and by `useProjection` after a replay. */
export function project<TState>(projection: Projection<TState>, events: readonly AppEvent[]): TState {
  return events.reduce(projection.evolve, projection.initial);
}
