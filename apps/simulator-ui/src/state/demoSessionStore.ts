import {
  type DemoSessionAction,
  demoSessionReducer,
  type DemoSessionState,
  INITIAL_SESSION,
} from '../lib/demoSession';

/**
 * The guided demo's session, kept for the life of the window outside React (decision Q2). `Esc` leaves presenter mode without stopping
 * anything, and the page that shows the demo is a route: coming back to it must find the step where it was, as the timeline editor's
 * working copies (`EditorDrafts`) find theirs. A reload loses it, and the start screen says so.
 *
 * An external store in the shape React's `useSyncExternalStore` wants: `subscribe`, and `get()` which returns the same object until
 * an action changes the state. The state is `lib/demoSession.ts`'s, a pure reducer; this class only holds it and tells listeners.
 */
export class DemoSessionStore {
  private state: DemoSessionState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: DemoSessionState = INITIAL_SESSION) {
    this.state = initial;
  }

  /** The same object until an action changes the state, as `useSyncExternalStore` needs. */
  get = (): DemoSessionState => this.state;

  /** Applies an action. An action that changes nothing (the reducer gave the same object back) tells nobody. */
  dispatch(action: DemoSessionAction): void {
    const next = demoSessionReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
