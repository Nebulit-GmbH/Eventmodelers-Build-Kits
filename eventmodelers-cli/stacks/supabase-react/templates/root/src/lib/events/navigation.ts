import { defineCommand } from './commandGateway';
import { defineProjection, type Projection } from './projection';
import { defineEvent, type AppEvent, type EventOf } from './types';

/**
 * Event-driven navigation — router-free. The app's location is a projection of the event log, so a
 * replayed log lands on the same page. Nothing calls `navigate()` after an `await`: a slice declares
 * `NavigationRule`s over its own events (`src/slices/.../navigation.ts`) and the router bridge
 * (scaffold: `src/app/EventRouter.tsx`) folds them, together with the user's own navigation.
 */

/** `push`/`replace` = a navigation the app made; `history` = the browser already moved (back, forward, typed URL). */
export type NavigationMode = 'push' | 'replace' | 'history';

export const Navigated = defineEvent<'Navigated', { to: string; mode: NavigationMode }>('Navigated');

/** Local command (no remote call): every link click and `navigate(...)` goes through the gateway as this. */
export const navigate = defineCommand<{ to: string; mode?: NavigationMode }, EventOf<typeof Navigated>>(
  'Navigate',
  ({ to, mode }) => [Navigated({ to, mode: mode ?? 'push' })],
);

/**
 * A slice's navigation rule: given an event, the route to show next (or `undefined` = no change). Pure.
 *   export const navigation: NavigationRule[] = [(e) => (RegisterBikeAccepted.is(e) ? '/bike-registered' : undefined)];
 */
export type NavigationRule = (event: AppEvent) => string | { to: string; mode?: 'push' | 'replace' } | undefined;

export interface LocationState {
  /** `pathname + search + hash`. */
  location: string;
  mode: NavigationMode;
}

export function createLocationProjection(
  rules: readonly NavigationRule[],
  initial: string,
): Projection<LocationState> {
  return defineProjection<LocationState>({
    initial: { location: initial, mode: 'history' },
    evolve(state, event) {
      if (Navigated.is(event)) return { location: event.data.to, mode: event.data.mode };
      for (const rule of rules) {
        const next = rule(event);
        if (next !== undefined) {
          const { to, mode } = typeof next === 'string' ? { to: next, mode: 'push' as const } : { mode: 'push' as const, ...next };
          return { location: to, mode };
        }
      }
      return state;
    },
  });
}
