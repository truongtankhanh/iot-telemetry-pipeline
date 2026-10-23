import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoPipeline, type DemoPipelineInput } from '../../lib/demoPipeline';
import { axeViolations } from '../../test-axe';
import { PipelineStrip } from './PipelineStrip';

const input = (overrides: Partial<DemoPipelineInput> = {}): DemoPipelineInput => ({
  deviceId: 'dc-env-01',
  reading: { value: '29.3', unit: '°C' },
  ingestStatus: 'ready',
  lagSeconds: 0.04,
  rule: { counted: 2, of: 3 },
  ruleRaised: false,
  alert: 'none',
  incident: false,
  alertSink: 'ops-command-center',
  linkLost: false,
  ...overrides,
});

describe('PipelineStrip', () => {
  it('draws the five stages in order, in a labelled list', () => {
    render(<PipelineStrip stages={demoPipeline(input())} />);
    const strip = screen.getByRole('region', { name: 'Pipeline so far' });
    const stages = within(strip)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-hidden') !== 'true');
    expect(stages.map((li) => li.querySelector('span')?.textContent)).toEqual([
      'Device',
      'Ingest',
      'Rule',
      'Alert',
      'Command Center',
    ]);
  });

  it('says every stage in words, as the frame does at step 3', () => {
    render(<PipelineStrip stages={demoPipeline(input())} />);
    expect(screen.getByText('dc-env-01')).toBeInTheDocument();
    expect(screen.getByText('storing readings')).toBeInTheDocument();
    expect(screen.getByText('counting')).toBeInTheDocument();
    expect(screen.getAllByText('not yet')).toHaveLength(2);
    expect(screen.getByText('29.3')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    expect(screen.getByText('s lag')).toBeInTheDocument();
    expect(screen.getByText('of 3')).toBeInTheDocument();
  });

  it('carries each stage’s state, so the styling agrees with the words', () => {
    const { container } = render(
      <PipelineStrip stages={demoPipeline(input({ alert: 'open', incident: true }))} />,
    );
    const states = [...container.querySelectorAll('li[data-state]')].map((li) =>
      li.getAttribute('data-state'),
    );
    expect(states).toEqual(['live', 'live', 'fired', 'fired', 'done']);
  });

  it('marks a dimmed stage, and says why in its caption', () => {
    const { container } = render(
      <PipelineStrip stages={demoPipeline(input({ ingestStatus: 'unreachable' }))} />,
    );
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    const dimmed = [...container.querySelectorAll('li[data-dimmed="true"]')];
    expect(dimmed.length).toBeGreaterThan(0);
  });

  it('hides the joints between the stages from a screen reader', () => {
    const { container } = render(<PipelineStrip stages={demoPipeline(input())} />);
    expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(4);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <PipelineStrip stages={demoPipeline(input({ alert: 'cleared', incident: true }))} />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
