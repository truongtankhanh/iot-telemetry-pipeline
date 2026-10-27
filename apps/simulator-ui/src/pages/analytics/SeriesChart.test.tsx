import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChartLine } from '../../lib/analyticsChart';
import { axeViolations } from '../../test-axe';
import { SeriesChart, type SeriesChartProps } from './SeriesChart';

const count = (n: number) => Math.round(n).toLocaleString('en-US');
const seconds = (n: number) => `${n}`;

const published: ChartLine = {
  id: 'published',
  label: 'published, as readings',
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 4000 },
    { x: 2, y: 8000 },
    { x: 3, y: 8200 },
  ],
};
const stored: ChartLine = {
  id: 'stored',
  label: 'stored in PostgreSQL',
  secondary: true,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 3000 },
    { x: 2, y: 7600 },
    { x: 3, y: 8100 },
  ],
};

const props = (change: Partial<SeriesChartProps> = {}): SeriesChartProps => ({
  title: 'Throughput',
  yUnit: 'readings/s',
  window: 'the last 3 seconds of the run',
  lines: [published, stored],
  formatY: count,
  formatX: seconds,
  ...change,
});

describe('SeriesChart', () => {
  it('is a picture whose name is a sentence with the numbers in it, and writes the window under it', () => {
    render(<SeriesChart {...props()} />);
    const picture = screen.getByRole('img');
    expect(picture).toHaveAccessibleName(
      /Throughput, the last 3 seconds of the run, in readings\/s\./,
    );
    expect(picture).toHaveAccessibleName(/published, as readings 8,200 readings\/s at the end/);
    expect(picture).toHaveAccessibleName(/stored in PostgreSQL 8,100 readings\/s at the end/);
    expect(screen.getByText('The last 3 seconds of the run.')).toBeInTheDocument();
  });

  it('names its two lines in a legend, and draws the second dashed so colour is not the only signal', () => {
    const { container } = render(<SeriesChart {...props()} />);
    const legend = screen.getByRole('list', { name: 'Lines of the chart' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['published, as readings', 'stored in PostgreSQL']);
    expect(container.querySelector('[data-line="stored"] polyline')).toHaveAttribute(
      'data-secondary',
      'true',
    );
    expect(container.querySelector('[data-line="published"] polyline')).not.toHaveAttribute(
      'data-secondary',
    );
  });

  it('has no legend for one line', () => {
    render(<SeriesChart {...props({ lines: [published] })} />);
    expect(screen.queryByRole('list', { name: 'Lines of the chart' })).toBeNull();
  });

  it('tags the last value of each line, and draws the unit and the time axis', () => {
    const { container } = render(<SeriesChart {...props()} />);
    const tags = [...container.querySelectorAll('[data-tag] text')].map((text) => text.textContent);
    expect(tags).toEqual(expect.arrayContaining(['8,200', '8,100']));
    expect(container.textContent).toContain('readings/s');
    expect(container.textContent).toContain('0');
  });

  it('breaks a line where a value is unknown instead of drawing it to zero', () => {
    const gap: ChartLine = {
      ...published,
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 200 },
        { x: 2, y: null },
        { x: 3, y: 300 },
        { x: 4, y: 400 },
      ],
    };
    const { container } = render(<SeriesChart {...props({ lines: [gap] })} />);
    expect(container.querySelectorAll('[data-line="published"] polyline')).toHaveLength(2);
  });

  it('says so when no line has a value', () => {
    render(<SeriesChart {...props({ lines: [{ ...published, points: [] }] })} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/has no value yet/);
  });

  it('draws the phases, the mark and the average of a finished run, and names the average in the sentence', () => {
    render(
      <SeriesChart
        {...props({
          xDomain: [0, 20],
          lines: [
            {
              ...published,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 8000 },
              ],
            },
          ],
          bands: [
            { from: 0, to: 5, label: 'ramp-up' },
            { from: 5, to: 18, label: 'steady state' },
          ],
          marks: [{ x: 18, label: 'publishing ended' }],
          average: { value: 5700, label: 'average 5,700' },
        })}
      />,
    );
    expect(screen.getByText('ramp-up')).toBeInTheDocument();
    expect(screen.getByText('steady state')).toBeInTheDocument();
    expect(screen.getByText('average 5,700')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/average 5,700\./);
  });

  it('shows what the caller adds under the picture', () => {
    render(
      <SeriesChart
        {...props({ caption: <span>The gap between the lines is 100 readings in flight.</span> })}
      />,
    );
    expect(
      screen.getByText('The gap between the lines is 100 readings in flight.'),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<SeriesChart {...props()} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
