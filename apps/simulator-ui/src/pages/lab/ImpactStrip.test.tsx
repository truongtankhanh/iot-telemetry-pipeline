import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExpectationPreview, ExpectedAlert } from '../../api/types';
import { axeViolations } from '../../test-axe';
import { ImpactStrip } from './ImpactStrip';
import type { ExpectedImpact } from './useExpectedImpact';

const alert = (change: Partial<ExpectedAlert> = {}): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  opensAtS: 24,
  opensMargin: false,
  clearsAtS: 80,
  clearsUncertain: false,
  ...change,
});

const preview = (alerts: ExpectedAlert[] = [alert()]): ExpectationPreview => ({
  expected: { available: true, intervalS: 2, horizonS: 80, alerts, quiet: [], series: [] },
  needsStart: [],
  intervalMs: 2000,
});

const ready = (p: ExpectationPreview = preview()): ExpectedImpact => ({
  status: 'ready',
  preview: p,
  fresh: true,
  error: null,
});

const strip = (impact: ExpectedImpact, sink: string | null = 'ops-command-center') =>
  render(<ImpactStrip impact={impact} sink={sink} />);

describe('ImpactStrip', () => {
  it('asks for a target while nothing is chosen', () => {
    strip({ status: 'idle', preview: null, fresh: true, error: null });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Choose a target and a fault to see what the rules should do.',
    );
  });

  it('says it is working it out, and tells assistive technology it is busy', () => {
    strip({ status: 'loading', preview: null, fresh: false, error: null });
    expect(screen.getByRole('region', { name: 'Expected impact' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Working out what the rules should do…');
  });

  it('shows the rule, the alert and about when, the incident and the clear', () => {
    strip(ready());
    const region = screen.getByRole('region', { name: 'Expected impact' });
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(within(region).getByText('server-room-hot')).toBeInTheDocument();
    expect(within(region).getByText('Alert, high · about 24 s')).toBeInTheDocument();
    expect(within(region).getByText('Incident in OCC')).toBeInTheDocument();
    expect(within(region).getByText('Clears about 80 s')).toBeInTheDocument();
    expect(within(region).getByText(/not observed/)).toBeInTheDocument();
  });

  it('says up to n alerts for a fault on many devices', () => {
    const alerts = Array.from({ length: 12 }, (_, i) =>
      alert({ deviceId: `d${i}`, opensAtS: 24 + 2 * i, clearsAtS: 80 + 2 * i }),
    );
    strip(ready(preview(alerts)));
    expect(screen.getByText('Up to 12 alerts · 24 to 46 s')).toBeInTheDocument();
    expect(screen.getByText('All clear about 102 s')).toBeInTheDocument();
  });

  it('does not promise an incident when no command center is configured', () => {
    strip(ready(), 'none');
    expect(screen.queryByText('Incident in OCC')).not.toBeInTheDocument();
    expect(screen.getByText('No command center: no incident')).toBeInTheDocument();
  });

  it('dims the last answer while the next is being asked for', () => {
    strip({ status: 'loading', preview: preview(), fresh: false, error: null });
    expect(screen.getByRole('region', { name: 'Expected impact' })).toHaveAttribute(
      'data-stale',
      'true',
    );
    expect(screen.getByText('Alert, high · about 24 s')).toBeInTheDocument();
  });

  it('says what the simulator refused, as an alert', () => {
    strip({
      status: 'error',
      preview: null,
      fresh: false,
      error: 'anomalies[1] overlaps anomalies[0] on d1 temperature_c',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('anomalies[1] overlaps anomalies[0]');
  });

  it('says the rules are not available, with the reason', () => {
    strip(
      ready({
        expected: { available: false, reason: 'cannot read rules.json (ENOENT)' },
        needsStart: [],
        intervalMs: 2000,
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Expected alerts are not available: cannot read rules.json (ENOENT)',
    );
  });

  it('says a stopped device will not publish', () => {
    strip(ready({ ...preview(), needsStart: [{ deviceId: 'dc-env-01', state: 'stopped' }] }));
    expect(
      screen.getByText(/dc-env-01 is not running\. Injecting does not start it/),
    ).toBeInTheDocument();
  });

  it('has no accessibility violation, with chips and with a message', async () => {
    const { container, rerender } = strip(ready());
    expect(await axeViolations(container)).toEqual([]);
    rerender(
      <ImpactStrip
        impact={{ status: 'idle', preview: null, fresh: true, error: null }}
        sink={null}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
