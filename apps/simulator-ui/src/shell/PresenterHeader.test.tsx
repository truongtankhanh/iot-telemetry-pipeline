import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../api/fixtures/stateView';
import { INITIAL_SESSION } from '../lib/demoSession';
import { DemoSessionStore } from '../state/demoSessionStore';
import { StudioProvider } from '../state/StudioProvider';
import { createStudioStore } from '../state/store';
import { axeViolations } from '../test-axe';
import { PresenterHeader } from './PresenterHeader';

const START = Date.parse('2026-10-23T09:00:00.000Z');

function setup(session = new DemoSessionStore(), onExit = vi.fn()) {
  const store = createStudioStore();
  store.getState().setLink('live', START);
  store.getState().setView(structuredClone(stateViewFixture), START);
  const result = render(
    <StudioProvider store={store} demo={session}>
      <MemoryRouter>
        <PresenterHeader onExit={onExit} />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { session, onExit, ...result };
}

const started = (now: number, steps = 6) => {
  const session = new DemoSessionStore();
  session.dispatch({ type: 'start', scriptId: 'overheat-to-incident', stepCount: steps, now });
  return session;
};

describe('PresenterHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it('names the demo and the script that is being presented', () => {
    setup(started(START));
    expect(screen.getByRole('heading', { level: 1, name: 'Guided demo' })).toBeInTheDocument();
    expect(screen.getByText('Overheat to incident')).toBeInTheDocument();
  });

  it('says where the demo is and how long it has run, as the frame does', () => {
    const session = started(START - 168_000);
    session.dispatch({ type: 'next', now: START - 100_000 });
    session.dispatch({ type: 'next', now: START - 50_000 });
    setup(session);
    expect(screen.getByText('Step 3 of 6 · 02:48 in')).toBeInTheDocument();
  });

  it('keeps the clock going each second', () => {
    setup(started(START));
    expect(screen.getByText('Step 1 of 6 · 00:00 in')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText('Step 1 of 6 · 00:05 in')).toBeInTheDocument();
  });

  it('is not a live region, so a clock that changes every second is not read out', () => {
    const { container } = setup(started(START));
    expect(container.querySelector('[aria-live], [role="status"], [role="timer"]')).toBeNull();
  });

  it('keeps the three dependencies of the pipeline in view', () => {
    setup(started(START));
    const group = screen.getByRole('group', { name: 'Dependencies' });
    expect(within(group).getByText('Broker')).toBeInTheDocument();
    expect(within(group).getByText('Ingest')).toBeInTheDocument();
    expect(within(group).getByText('Command Center')).toBeInTheDocument();
  });

  it('has an Exit presenter button that shows and announces its key, and calls onExit', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const { onExit } = setup(started(Date.now()));
    const exit = screen.getByRole('button', { name: /Exit presenter/ });
    expect(exit).toHaveTextContent('Esc');
    expect(exit).toHaveAttribute('aria-keyshortcuts', 'Escape');
    await user.click(exit);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not break before a demo has started', () => {
    setup(new DemoSessionStore(INITIAL_SESSION));
    expect(screen.getByText('No script')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 0 · 00:00 in')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    vi.useRealTimers();
    const { container } = setup(started(Date.now()));
    expect(await axeViolations(container)).toEqual([]);
  });
});
