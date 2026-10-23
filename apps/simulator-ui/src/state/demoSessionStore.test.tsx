import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_SESSION } from '../lib/demoSession';
import { DemoSessionStore } from './demoSessionStore';
import { useDemoSession } from './demoSessionContext';
import { StudioProvider } from './StudioProvider';
import { createStudioStore } from './store';

describe('DemoSessionStore', () => {
  it('starts idle and gives back the same object until an action changes it', () => {
    const store = new DemoSessionStore();
    expect(store.get()).toBe(INITIAL_SESSION);
    expect(store.get()).toBe(store.get());
    store.dispatch({ type: 'start', scriptId: 's', stepCount: 3, now: 1 });
    expect(store.get().status).toBe('presenting');
    expect(store.get()).toBe(store.get());
  });

  it('tells its listeners once for an action that changed something, and not for one that did not', () => {
    const store = new DemoSessionStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.dispatch({ type: 'start', scriptId: 's', stepCount: 3, now: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'back', now: 2 }); // already on the first step
    store.dispatch({ type: 'release-holds' }); // nothing is held
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'next', now: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.dispatch({ type: 'next', now: 4 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('can start from a given state', () => {
    const store = new DemoSessionStore({ ...INITIAL_SESSION, scriptId: 'kept' });
    expect(store.get().scriptId).toBe('kept');
  });
});

describe('the provider and useDemoSession', () => {
  function Probe() {
    const session = useDemoSession();
    return (
      <p role="status">
        {session.status} {session.stepIndex}
      </p>
    );
  }

  it('gives a window its own session when none is passed in, and a test its own when it passes one', () => {
    const passed = new DemoSessionStore();
    render(
      <StudioProvider store={createStudioStore()} demo={passed}>
        <Probe />
      </StudioProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('idle 0');
    act(() => passed.dispatch({ type: 'start', scriptId: 's', stepCount: 3, now: 1 }));
    act(() => passed.dispatch({ type: 'next', now: 2 }));
    expect(screen.getByRole('status')).toHaveTextContent('presenting 1');
  });

  it('creates one when the provider is not given any', () => {
    render(
      <StudioProvider store={createStudioStore()}>
        <Probe />
      </StudioProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('idle 0');
  });

  it('refuses to be read without a provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/needs a StudioProvider/);
    error.mockRestore();
  });
});
