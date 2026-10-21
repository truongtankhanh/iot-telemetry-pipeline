import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import scenariosFixture from '../../api/fixtures/scenarios.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { Anomaly, ScenarioItem, ScenarioLibraryView } from '../../api/types';
import { chartDescription } from '../../lib/scenarioExpectation';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { ScenarioChart } from './ScenarioChart';

const [overheat, , afternoon] = (scenariosFixture as unknown as ScenarioLibraryView).scenarios as [
  ScenarioItem,
  ScenarioItem,
  ScenarioItem,
];

afterEach(() => vi.unstubAllGlobals());

/** A `ResizeObserver` that reports one width as soon as it is asked to observe: the picture is drawn at that width. */
function stubWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: (entries: { contentRect: { width: number } }[]) => void;
      constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
        this.callback = callback;
      }
      observe() {
        this.callback([{ contentRect: { width } }]);
      }
      disconnect() {}
    },
  );
}

interface Options {
  width?: number;
  /** The scenario is playing (the prop), and whether the state has a run of it. */
  running?: boolean;
  inState?: boolean;
  elapsedS?: number;
}

function renderChart(item: ScenarioItem, options: Options = {}) {
  stubWidth(options.width ?? 480);
  const view = structuredClone(stateViewFixture);
  if (options.inState ?? options.running) {
    view.runs = [
      {
        id: 'r1',
        scenario: item.name,
        startedAt: '2026-10-21T08:00:00.000Z',
        offsetS: 0,
        endsAtS: item.lengthS,
        anomalyIds: ['a1'],
        startedDevices: [],
      },
    ];
    view.engine.elapsedS = options.elapsedS ?? 41;
  }
  const store = createStudioStore();
  store.getState().setView(view, 1);
  return render(
    <StudioProvider store={store}>
      <ScenarioChart
        item={item}
        rules={view.rules}
        devices={view.devices}
        running={options.running ?? false}
      />
    </StudioProvider>,
  );
}

describe('ScenarioChart: one signal', () => {
  it('is a picture named by a sentence with the numbers in it', () => {
    renderChart(overheat);
    const picture = screen.getByRole('img');
    expect(picture).toHaveAccessibleName(chartDescription(overheat, null));
    expect(picture).toHaveAccessibleName(
      /held at 29\.2 from 20 s for 60 s; alert expected at 24 s, clears at 80 s/,
    );
    expect(picture).toHaveAttribute('data-kind', 'value');
    expect(picture).toHaveAttribute('width', '480');
  });

  it('draws the rule lines, the extreme value and the time axis in seconds', () => {
    renderChart(overheat);
    const picture = screen.getByRole('img');
    for (const text of ['raise 27', 'clear 25.5', '29.2 °C', '0', '30', '60', '90', '120 s']) {
      expect(within(picture).getByText(text)).toBeInTheDocument();
    }
  });

  it('draws the alert and the clear as flags, with their words when there is room', () => {
    const { container } = renderChart(overheat);
    const alert = container.querySelector('[data-kind="alert"]');
    const clear = container.querySelector('[data-kind="clear"]');
    expect(alert).toHaveAttribute('data-severity', 'high');
    expect(clear).not.toBeNull();
    // The words twice: beside the dot and in its tooltip.
    expect(screen.getAllByText('alert ≈ 24 s')).toHaveLength(2);
    expect(screen.getAllByText('clears ≈ 80 s')).toHaveLength(2);
  });

  it('leaves the words of a flag off when they would not fit, and keeps them in its tooltip', () => {
    renderChart(overheat, { width: 200 });
    expect(screen.getAllByText('alert ≈ 24 s')).toHaveLength(2);
    expect(screen.getAllByText('clears ≈ 80 s')).toHaveLength(1);
  });

  it('draws no playhead while the scenario does not run', () => {
    const { container } = renderChart(overheat);
    expect(container.querySelector('[data-part="playhead"]')).toBeNull();
  });

  it('draws the playhead at the second the run has got to, with the played part tinted', () => {
    const { container } = renderChart(overheat, { running: true, elapsedS: 41 });
    const head = container.querySelector('[data-part="playhead"]');
    expect(head).not.toBeNull();
    expect(within(head as HTMLElement).getByText('41 s')).toBeInTheDocument();
    expect(head?.querySelector('rect')).toHaveAttribute('width', '155.8');
  });

  it('draws no playhead when the state has no run of the scenario any more', () => {
    const { container } = renderChart(overheat, { running: true, inState: false });
    expect(container.querySelector('[data-part="playhead"]')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderChart(overheat, { running: true });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('ScenarioChart: several signals', () => {
  it('draws one lane for each device, with its code and the value in its block', () => {
    const { container } = renderChart(afternoon);
    const picture = screen.getByRole('img');
    expect(picture).toHaveAttribute('data-kind', 'lanes');
    expect(picture).toHaveAccessibleName(/hub-power-01 power_kw held at 190 from 10 s for 55 s/);
    expect(container.querySelectorAll('[data-part="lane"]')).toHaveLength(3);
    // A lane's code is written beside it and is also its tooltip, so it is found twice.
    for (const code of ['HUB', 'DC·1', 'LHA']) {
      expect(within(picture).getAllByText(code)).toHaveLength(2);
    }
    for (const text of ['190 kW', '29.2 °C', '30 °C']) {
      expect(within(picture).getByText(text)).toBeInTheDocument();
    }
  });

  it('draws the alert on the lane that raises it, coloured by its severity word', () => {
    const { container } = renderChart(afternoon);
    const runs = [...container.querySelectorAll('[data-severity]')];
    expect(runs.map((run) => run.getAttribute('data-severity'))).toEqual(['low', 'high']);
  });

  it('draws four lanes at most and says what it left out', () => {
    const [first] = afternoon.anomalies as [Anomaly];
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...first,
      deviceId: `extra-${i}`,
      startAt: i * 10,
    }));
    const { container } = renderChart({ ...afternoon, anomalies: many });
    expect(container.querySelectorAll('[data-part="lane"]')).toHaveLength(4);
    expect(screen.getByText('+ 2 more devices, 2 anomalies')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderChart(afternoon, { running: true });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('ScenarioChart: nothing honest to draw', () => {
  it('draws no picture when the simulator could not work out the expected alerts', () => {
    const unavailable = { ...overheat, expected: { available: false as const, reason: 'x' } };
    const { container } = renderChart(unavailable);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
