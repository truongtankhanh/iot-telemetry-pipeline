import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { twinLayoutFixture } from '../../api/fixtures/twinLayout';
import type { TwinLayoutView } from '../../api/types';
import { axeViolations } from '../../test-axe';
import type { TwinSceneProps } from '../../twin/TwinScene';
import { Twin } from './Twin';

// The scene needs WebGL, which jsdom does not have, and is the one module that imports three.js: it is replaced by a
// stand-in that counts how many times its module was loaded. A module is loaded once and then cached, so the cases that
// must NOT request the scene come first in this file, and the one that does comes after them.
const { probe, sceneLoaded } = vi.hoisted(() => ({ probe: vi.fn(), sceneLoaded: vi.fn() }));
vi.mock('../../lib/webgl', () => ({ webgl2Available: probe }));
vi.mock('../../twin/TwinScene', () => {
  sceneLoaded();
  return {
    TwinScene: ({ layout, onContextLost }: TwinSceneProps) => (
      <div data-testid="scene" data-zones={layout.zones.length}>
        <button type="button" onClick={onContextLost}>
          Lose the context
        </button>
      </div>
    ),
  };
});

const UNAVAILABLE: TwinLayoutView = {
  available: false,
  reason: 'cannot read /x/twin-layout.json (ENOENT)',
  layout: null,
  placement: {
    placed: [],
    unplaced: [{ id: 'dc-env-01', reason: 'the twin layout is not available' }],
    orphans: [],
  },
};

const answer = (body: unknown) => new Response(JSON.stringify(body));
const refusal = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, error: 'Error', message }), { status });

function stubFetch(...answers: (() => Response | Promise<Response>)[]) {
  let next = 0;
  const fetchFn = vi.fn(async () => {
    const make = answers[Math.min(next, answers.length - 1)];
    next += 1;
    if (make === undefined) throw new Error('fetch was not expected');
    return make();
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

const renderTwin = () =>
  render(
    <MemoryRouter initialEntries={['/twin']}>
      <Twin />
    </MemoryRouter>,
  );

beforeEach(() => probe.mockReturnValue(true));
afterEach(() => {
  vi.unstubAllGlobals();
  probe.mockReset();
});

describe('the Twin page, where the scene is not requested', () => {
  it('says the 3D view is not available without WebGL 2, links to the Topology, and asks for nothing', async () => {
    probe.mockReturnValue(false);
    const fetchFn = stubFetch();
    renderTwin();
    expect(screen.getByRole('heading', { level: 1, name: 'Digital twin' })).toBeInTheDocument();
    expect(screen.getByText('Spike')).toBeInTheDocument();
    expect(screen.getByText(/3D view isn't available on this device/)).toBeInTheDocument();
    expect(
      screen.getByText(/WebGL 2 is off, so Studio shows the topology instead/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open topology' })).toHaveAttribute(
      'href',
      '/topology',
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('says it is reading the layout while the simulator has not answered', () => {
    stubFetch(() => new Promise<Response>(() => {}));
    renderTwin();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the campus layout…');
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('gives the reason and the link to the Topology when the layout is not available', async () => {
    stubFetch(() => answer(UNAVAILABLE));
    renderTwin();
    expect(await screen.findByText(/The twin layout is not available/)).toBeInTheDocument();
    expect(screen.getByText(/cannot read \/x\/twin-layout.json \(ENOENT\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open topology' })).toHaveAttribute(
      'href',
      '/topology',
    );
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('says a simulator without the route is too old, and reads again when asked', async () => {
    const fetchFn = stubFetch(
      () => refusal(404, 'No such route'),
      () => answer(UNAVAILABLE),
    );
    renderTwin();
    expect(await screen.findByText(/The twin layout could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/too old for the twin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/The twin layout is not available/)).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sceneLoaded).not.toHaveBeenCalled();
  });
});

describe('the Twin page, where the scene is requested', () => {
  it('loads the scene with the layout, and states what it draws, where it came from and who is not placed', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    const scene = await screen.findByTestId('scene');
    expect(scene).toHaveAttribute('data-zones', '3');
    expect(sceneLoaded).toHaveBeenCalledTimes(1);

    expect(
      screen.getByText(
        '3 zones, 2 buildings, 1 catalogue asset (not simulated) · 2 of 3 devices placed (2 illustrative)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a copy of ops-command-center at 4b4fe02, compared on 2026-10-26/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Not drawn: the layout has no position for these devices/),
    ).toBeInTheDocument();
    expect(screen.getByText('hub-power-01: no position in the layout')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open topology' })).toBeNull();
  });

  it('has no accessibility violations once the scene is up', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    const { container } = renderTwin();
    await screen.findByTestId('scene');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('swaps the scene for the Topology link when it says its graphics context was lost for good', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await userEvent.click(await screen.findByRole('button', { name: 'Lose the context' }));
    await waitFor(() => expect(screen.queryByTestId('scene')).toBeNull());
    expect(screen.getByText(/The 3D view lost its graphics context/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open topology' })).toHaveAttribute(
      'href',
      '/topology',
    );
  });
});
