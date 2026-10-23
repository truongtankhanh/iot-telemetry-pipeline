import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { stateViewFixture } from '../api/fixtures/stateView';
import type { StateView } from '../api/types';
import { StudioProvider } from '../state/StudioProvider';
import { createStudioStore } from '../state/store';
import { axeViolations } from '../test-axe';
import { DependencyPills, EnginePill, FaultsPill } from './DependencyPills';

const NOW = Date.parse('2026-10-23T09:00:00.000Z');

function setup(change: (view: StateView) => void = () => {}) {
  const view = structuredClone(stateViewFixture);
  change(view);
  const store = createStudioStore();
  store.getState().setLink('live', NOW);
  store.getState().setView(view, NOW);
  const result = render(
    <StudioProvider store={store}>
      <MemoryRouter>
        <DependencyPills />
        <EnginePill />
        <FaultsPill />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { store, ...result };
}

const faultsOn = (view: StateView) => {
  view.engine.faults.drop = { percent: 5 };
  view.engine.faults.malformed = { percent: 3, kinds: ['range'] };
  view.engine.faults.activeCount = 2;
};

describe('the pills of the header', () => {
  it('keeps the dependencies to the three of the pipeline, with or without faults', () => {
    setup(faultsOn);
    const group = screen.getByRole('group', { name: 'Dependencies' });
    expect(within(group).getByText('Broker')).toBeInTheDocument();
    expect(within(group).getByText('Ingest')).toBeInTheDocument();
    expect(within(group).getByText('Command Center')).toBeInTheDocument();
    expect(within(group).queryByText('Faults on')).toBeNull();
    expect(within(group).queryByText(/Running/)).toBeNull();
  });
});

describe('FaultsPill', () => {
  it('draws nothing while no fault is on', () => {
    setup();
    expect(screen.queryByText('Faults on')).toBeNull();
    expect(screen.queryByRole('link', { name: /Faults on/ })).toBeNull();
  });

  it('is an amber link to the Faults page that says how many faults are on', () => {
    setup(faultsOn);
    const link = screen.getByRole('link', { name: /Faults on/ });
    expect(link).toHaveAttribute('href', '/lab/faults');
    expect(link).toHaveTextContent('2 active');
    const pill = link.querySelector('[data-tone]');
    expect(pill).toHaveAttribute('data-tone', 'warn');
    expect(pill).not.toHaveAttribute('data-stale');
  });

  it('appears and disappears with the engine’s state', () => {
    const { store } = setup();
    expect(screen.queryByText('Faults on')).toBeNull();
    const on = structuredClone(stateViewFixture);
    faultsOn(on);
    act(() => store.getState().setView(on, NOW + 1000));
    expect(screen.getByText('Faults on')).toBeInTheDocument();
    act(() => store.getState().setView(structuredClone(stateViewFixture), NOW + 2000));
    expect(screen.queryByText('Faults on')).toBeNull();
  });

  it('is dimmed, and dated, when the link to the simulator is lost', () => {
    const { store } = setup(faultsOn);
    act(() => store.getState().setLink('lost', NOW + 5000));
    const link = screen.getByRole('link', { name: /Faults on/ });
    expect(link.querySelector('[data-tone]')).toHaveAttribute('data-stale', 'true');
    expect(link.getAttribute('title')).toMatch(/Last known value/);
  });

  it('has no accessibility violations', async () => {
    const { container } = setup(faultsOn);
    expect(await axeViolations(container)).toEqual([]);
  });
});
