import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { axeViolations } from '../../test-axe';
import { AnomalyInspector } from './AnomalyInspector';
import { type PartContext, renderEditorPart } from './timelineTestSupport';

afterEach(() => vi.unstubAllGlobals());

const saved = { path: '/lab/timeline?scenario=bad-afternoon' };

function inspector(options = saved) {
  let context!: PartContext;
  const harness = renderEditorPart((c) => {
    context = c;
    return (
      <AnomalyInspector
        editor={c.editor}
        impact={c.impact}
        rules={stateViewFixture.rules}
        profiles={stateViewFixture.profiles}
        devices={stateViewFixture.devices}
      />
    );
  }, options);
  return { ...harness, context: () => context };
}

/** Opens the inspector on the second anomaly of `bad-afternoon` (dc-env-01, temperature_c, 29.2 from 30 s for 60 s). */
async function onHot() {
  const harness = inspector();
  await waitFor(() => expect(harness.context().editor.status).toBe('ready'));
  await waitFor(() => expect(harness.context().editor.doc.entries).toHaveLength(3));
  act(() => harness.context().editor.select('a2'));
  await screen.findByRole('heading', { name: 'Anomaly 2' });
  return harness;
}

const entry = (h: ReturnType<typeof inspector>) => h.context().editor.doc.entries[1]!.anomaly;

describe('AnomalyInspector', () => {
  it('asks for a selection when there is none', async () => {
    inspector();
    expect(
      await screen.findByText('Select an anomaly on the timeline to edit it.'),
    ).toBeInTheDocument();
  });

  it('shows every field of the selected anomaly, the range of its value and what the rules should do', async () => {
    await onHot();
    expect(screen.getByLabelText('Device')).toHaveValue('dc-env-01');
    expect(screen.getByLabelText('Metric')).toHaveValue('temperature_c');
    expect(screen.getByRole('radio', { name: 'Step' })).toBeChecked();
    expect(screen.getByLabelText('Value')).toHaveValue('29.2');
    expect(screen.getByText('From -40 to 85 °C')).toBeInTheDocument();
    expect(screen.getByLabelText('Start')).toHaveValue('30');
    expect(screen.getByLabelText('Duration')).toHaveValue('60');
    expect(
      await screen.findByText(
        'Raises Server room temperature high (high) about 34 s; clears about 90 s.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('raise 27 · clear 25.5 · opens after 3 readings in a row'),
    ).toBeInTheDocument();
    expect(screen.getByText('Starts 30 s · ends 90 s')).toBeInTheDocument();
  });

  it('sets the shape of the anomaly', async () => {
    const user = userEvent.setup();
    const h = await onHot();
    await user.click(screen.getByRole('radio', { name: 'Ramp' }));
    expect(entry(h).shape).toBe('ramp');
    expect(screen.getByRole('radio', { name: 'Ramp' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Step' }));
    expect('shape' in entry(h)).toBe(false);
  });

  it('changes the value, the start and the duration as they are typed', async () => {
    const user = userEvent.setup();
    const h = await onHot();
    const value = screen.getByLabelText('Value');
    await user.clear(value);
    await user.type(value, '31.5');
    expect(entry(h).value).toBe(31.5);

    const start = screen.getByLabelText('Start');
    await user.clear(start);
    await user.type(start, '40');
    expect(entry(h).startAt).toBe(40);

    const duration = screen.getByLabelText('Duration');
    await user.clear(duration);
    await user.type(duration, '20');
    expect(entry(h).duration).toBe(20);
  });

  it('keeps a value outside the range of the contract and marks it', async () => {
    const user = userEvent.setup();
    const h = await onHot();
    const value = screen.getByLabelText('Value');
    await user.clear(value);
    await user.type(value, '900');
    expect(entry(h).value).toBe(900);
    expect(await screen.findByText('Enter a value from -40 to 85 °C')).toBeInTheDocument();
    expect(value).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not apply a start that would play over another anomaly, and says why next to the field', async () => {
    const h = await onHot();
    act(() => {
      h.context().editor.add({
        deviceId: 'dc-env-01',
        metric: 'temperature_c',
        value: 29.2,
        startAt: 100,
        duration: 20,
      });
    });
    await screen.findByRole('heading', { name: 'Anomaly 4' });

    // One change of 100 to 40 (not typed key by key, which would pass through 4 s, where there is room).
    const start = screen.getByLabelText('Start');
    fireEvent.change(start, { target: { value: '40' } });

    expect(
      await screen.findByText(
        'dc-env-01 already has a fault on temperature_c in the scenario from 30 s to 90 s',
      ),
    ).toBeInTheDocument();
    expect(h.context().editor.doc.entries[3]?.anomaly.startAt).toBe(100);
    fireEvent.blur(start);
    expect(screen.getByLabelText('Start')).toHaveValue('100');
  });

  it('moves to the first metric a device reports, at a value that makes sense, when the device cannot take the metric', async () => {
    const user = userEvent.setup();
    const h = await onHot();
    // hub-power-01 already has a power_kw fault from 10 s to 65 s: move it out of the way of 30 s to 90 s.
    act(() => {
      h.context().editor.edit('a1', { startAt: 200 });
    });
    await user.selectOptions(screen.getByLabelText('Device'), 'hub-power-01');
    expect(entry(h)).toMatchObject({ deviceId: 'hub-power-01', metric: 'power_kw' });
    expect(entry(h).value).toBeGreaterThan(0);
    expect(entry(h).value).toBeLessThanOrEqual(10_000);
    expect(screen.getByLabelText('Metric')).toHaveValue('power_kw');
  });

  it('starts a new metric at a value that makes sense for it', async () => {
    const user = userEvent.setup();
    const h = await onHot();
    await user.selectOptions(screen.getByLabelText('Metric'), 'humidity_pct');
    expect(entry(h).metric).toBe('humidity_pct');
    expect(entry(h).value).not.toBe(29.2);
    expect(entry(h).value).toBeLessThanOrEqual(100);
  });

  it('removes the anomaly, and then asks for a selection', async () => {
    const user = userEvent.setup();
    const h = await onHot();
    await user.click(screen.getByRole('button', { name: 'Remove anomaly 2' }));
    expect(h.context().editor.doc.entries).toHaveLength(2);
    expect(
      await screen.findByText('Select an anomaly on the timeline to edit it.'),
    ).toBeInTheDocument();
  });

  it('has no accessibility violation', async () => {
    const { container } = await onHot();
    await screen.findByText(/^Raises Server room temperature high/);
    expect(await axeViolations(container)).toEqual([]);
  });
});
