import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../../api/fixtures/stateView';
import type { RuleInfo } from '../../api/types';
import { AnimationBudget } from '../../lib/animationBudget';
import { formatClockTime } from '../../lib/time';
import type { Sample } from '../../state/history';
import { axeViolations } from '../../test-axe';
import { AnimationBudgetProvider } from '../AnimationBudget';
import { LineChart, type LineChartProps } from './LineChart';
import { RangeBar } from './RangeBar';
import { Sparkline } from './Sparkline';

const NOW = Date.parse('2026-10-20T09:15:00.000Z');
const hot = fixture.rules.items.find((r) => r.id === 'server-room-hot') as RuleInfo;
const profile = fixture.profiles['dc-env-01']?.temperature_c ?? null;

/** Samples every 2 s ending `agoS` seconds before NOW. */
const series = (values: number[], agoS = 0): Sample[] =>
  values.map((v, i) => ({ t: NOW - (agoS + (values.length - 1 - i) * 2) * 1000, v }));

const props = (change: Partial<LineChartProps> = {}): LineChartProps => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  samples: series([22.2, 22.4, 29.3]),
  now: NOW,
  rule: hot,
  status: { kind: 'running', since: null },
  intervalMs: 2000,
  ...change,
});

const layers = (container: HTMLElement) =>
  [...container.querySelectorAll('path[data-layer]')].map((p) => p.getAttribute('data-layer'));

describe('LineChart', () => {
  it('is an image named by a sentence with the numbers in it', () => {
    render(<LineChart {...props()} />);
    const chart = screen.getByRole('img');
    const name = chart.getAttribute('aria-label') ?? '';
    expect(name).toMatch(/^temperature_c of dc-env-01, last 2 min: from 22\.2 °C to 29\.3 °C/);
    expect(name).toContain('2.3 °C above raise line (27)');
  });

  it('draws the raise and clear lines with their labels, and says the headroom in words', () => {
    render(<LineChart {...props()} />);
    expect(screen.getByText('raise 27')).toBeInTheDocument();
    expect(screen.getByText('clear 25.5')).toBeInTheDocument();
    expect(screen.getByText('2.3 °C above raise')).toBeInTheDocument();
  });

  it('says the headroom to the line while the value is under it, and draws the amber part anyway', () => {
    const { container } = render(<LineChart {...props({ samples: series([22.2, 22.4]) })} />);
    expect(screen.getByText('4.6 °C to raise')).toBeInTheDocument();
    expect(layers(container)).toContain('breach');
  });

  it('gives min, average and max beneath, as text', () => {
    render(<LineChart {...props({ samples: series([22, 23, 24]) })} />);
    const caption = screen.getByText(/^min/).closest('figcaption') as HTMLElement;
    expect(caption).toHaveTextContent('min 22.0');
    expect(caption).toHaveTextContent('avg 23.0');
    expect(caption).toHaveTextContent('max 24.0');
  });

  it('shows the last value as a tag', () => {
    render(<LineChart {...props()} />);
    expect(within(screen.getByRole('img')).getByText('29.3')).toBeInTheDocument();
  });

  it('draws no raise or clear line and no amber part when there is no rule', () => {
    const { container } = render(<LineChart {...props({ rule: null })} />);
    expect(screen.queryByText(/^raise/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^clear/)).not.toBeInTheDocument();
    expect(layers(container)).not.toContain('breach');
  });

  it('hatches the stretch after the last reading of a paused device and says why, in the picture and the name', () => {
    const since = NOW - 40_000;
    const { container } = render(
      <LineChart
        {...props({
          samples: series([22, 22.4], 40),
          status: { kind: 'paused', since },
        })}
      />,
    );
    const reason = `Paused at ${formatClockTime(since)}`;
    expect(
      within(container.querySelector('[data-gap]') as HTMLElement).getByText(reason),
    ).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(reason);
  });

  it('says there are no readings, with the reason, when the window is empty', () => {
    render(<LineChart {...props({ samples: [], status: { kind: 'stopped', since: null } })} />);
    expect(screen.getByText('No readings in the last 2 min')).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'temperature_c of dc-env-01, last 2 min: no readings (Stopped)',
    );
  });

  it('says how much history it has while it holds less than the window', () => {
    render(
      <LineChart
        {...props({
          samples: [
            { t: NOW - 40_000, v: 22 },
            { t: NOW - 2000, v: 22.2 },
          ],
        })}
      />,
    );
    expect(screen.getByText('collecting, 40 s of 2 min')).toBeInTheDocument();
  });

  it('glows only inside the animation budget', () => {
    const plain = render(<LineChart {...props()} />);
    expect(layers(plain.container)).not.toContain('halo');
    plain.unmount();

    const wrap = (children: ReactNode) => (
      <AnimationBudgetProvider budget={new AnimationBudget()}>{children}</AnimationBudgetProvider>
    );
    const lit = render(wrap(<LineChart {...props()} />));
    expect(layers(lit.container)).toContain('halo');
    lit.unmount();

    const capped = new AnimationBudget({ node: 12, line: 1 });
    const two = render(
      <AnimationBudgetProvider budget={capped}>
        <LineChart {...props()} />
        <LineChart {...props({ deviceId: 'dc-env-02' })} />
      </AnimationBudgetProvider>,
    );
    expect(layers(two.container).filter((l) => l === 'halo')).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<LineChart {...props()} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Sparkline', () => {
  it('draws the readings as a path, with a dot at the newest', () => {
    const { container } = render(<Sparkline samples={series([10, 20])} now={NOW} />);
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
    expect(container.querySelector('circle')).not.toBeNull();
  });

  it('is decoration without a label, and an image with one', () => {
    const plain = render(<Sparkline samples={series([10, 20])} now={NOW} />);
    expect(plain.container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    plain.unmount();
    render(<Sparkline samples={series([10, 20])} now={NOW} label="last 2 minutes: 10 to 20" />);
    expect(screen.getByRole('img', { name: 'last 2 minutes: 10 to 20' })).toBeInTheDocument();
  });

  it('draws a dashed line, not an empty box, when there are no readings', () => {
    const { container } = render(<Sparkline samples={[]} now={NOW} />);
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line[data-empty]')).not.toBeNull();
  });
});

describe('RangeBar', () => {
  it('is an image named by the zones, the baseline and the value in words', () => {
    render(<RangeBar metric="temperature_c" rule={hot} profile={profile} value={29.3} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Safe up to 25.5 °C; hysteresis band 25.5 °C to 27 °C; alarm above 27 °C; baseline 22.5 °C; now 29.3 °C',
    );
  });

  it('labels the lines, the baseline and the value in text beside the bar', () => {
    render(<RangeBar metric="temperature_c" rule={hot} profile={profile} value={29.3} />);
    for (const text of ['clear 25.5 °C', 'raise 27 °C', 'baseline 22.5 °C', 'now 29.3 °C']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('draws the three zones and the two pins', () => {
    const { container } = render(
      <RangeBar metric="temperature_c" rule={hot} profile={profile} value={29.3} />,
    );
    expect(
      [...container.querySelectorAll('[data-kind]')].map((z) => z.getAttribute('data-kind')),
    ).toEqual(['safe', 'hysteresis', 'alarm']);
    expect(container.querySelector('[data-pin="baseline"]')).not.toBeNull();
    expect(container.querySelector('[data-pin="value"]')).not.toBeNull();
  });

  it('has no pins and says so when there is no profile and no value', () => {
    const { container } = render(
      <RangeBar metric="temperature_c" rule={hot} profile={null} value={null} />,
    );
    expect(container.querySelector('[data-pin]')).toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('no current value');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <RangeBar metric="temperature_c" rule={hot} profile={profile} value={29.3} />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
