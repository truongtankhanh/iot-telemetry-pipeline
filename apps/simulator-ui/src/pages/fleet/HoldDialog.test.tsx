import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { FleetRow } from '../../lib/fleetQuery';
import { buildFleetRows } from '../../lib/fleetRows';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { deviceCalls, renderFleet } from './fleetTestSupport';
import { HoldDialog } from './HoldDialog';

afterEach(() => {
  vi.unstubAllGlobals();
});

const allRows = buildFleetRows({
  view: stateViewFixture,
  now: Date.now(),
  seriesOf: () => [],
  lastSeenOf: () => null,
});
const rowsOf = (...ids: string[]): FleetRow[] =>
  ids.map((id) => allRows.find((r) => r.device.id === id) as FleetRow);

function setup(rows: FleetRow[]) {
  const store = createStudioStore();
  const onHold = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <StudioProvider store={store}>
      <button type="button">opener</button>
      <HoldDialog rows={rows} onHold={onHold} onClose={onClose} />
    </StudioProvider>,
  );
  return { store, onHold, onClose, ...view };
}

const field = () => screen.getByLabelText(/^Hold .* at$/);
const holdButton = () => screen.getByRole('button', { name: /^Hold on / });

describe('HoldDialog', () => {
  it('is a modal dialog with a title, a metric, a value field and two buttons', () => {
    const { store } = setup(rowsOf('dc-env-01', 'lib-air-01'));
    const dialog = screen.getByRole('dialog', { name: 'Hold a value' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole('combobox', { name: 'Metric' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(store.getState().modalCount).toBe(1);
  });

  it('lists every metric any selected device reports, the most common first', () => {
    setup(rowsOf('dc-env-01', 'lib-air-01'));
    const options = within(screen.getByRole('combobox', { name: 'Metric' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['temperature_c', 'humidity_pct', 'co2_ppm']);
  });

  it('says how many devices it reaches, and which it skips and why, before anything is sent', async () => {
    const user = userEvent.setup();
    setup(rowsOf('dc-env-01', 'lib-air-01', 'hub-power-01'));
    const reach = screen.getByRole('status');
    expect(reach).toHaveTextContent(
      '2 devices, 1 skipped because it does not report temperature_c: hub-power-01',
    );
    expect(holdButton()).toHaveTextContent('Hold on 2 devices');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Metric' }), 'power_kw');
    expect(reach).toHaveTextContent(
      '1 device, 2 skipped because they do not report power_kw: dc-env-01, lib-air-01',
    );
    expect(holdButton()).toHaveTextContent('Hold on 1 device');
  });

  it('keeps Hold off until the value is usable', async () => {
    const user = userEvent.setup();
    setup(rowsOf('dc-env-01', 'lib-air-01'));
    expect(holdButton()).toBeDisabled();
    await user.type(field(), 'hot');
    expect(holdButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('“hot” is not a number');
    await user.clear(field());
    await user.type(field(), '31.5');
    expect(holdButton()).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a value outside the contract range and says the range', async () => {
    const user = userEvent.setup();
    const { onHold } = setup(rowsOf('dc-env-01'));
    await user.type(field(), '120');
    expect(screen.getByRole('alert')).toHaveTextContent('temperature_c accepts -40 to 85 °C');
    expect(holdButton()).toBeDisabled();
    await user.type(field(), '{Enter}');
    expect(onHold).not.toHaveBeenCalled();
  });

  it('hands the metric, the value and the reached devices to the page, and closes', async () => {
    const user = userEvent.setup();
    const { onHold, onClose } = setup(rowsOf('dc-env-01', 'lib-air-01', 'hub-power-01'));
    await user.type(field(), '31.5');
    await user.click(holdButton());
    expect(onHold).toHaveBeenCalledWith('temperature_c', 31.5, ['dc-env-01', 'lib-air-01']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('holds on Enter', async () => {
    const user = userEvent.setup();
    const { onHold } = setup(rowsOf('dc-env-01'));
    await user.type(field(), '30{Enter}');
    expect(onHold).toHaveBeenCalledWith('temperature_c', 30, ['dc-env-01']);
  });

  it('clears the value when another metric is chosen, and names the field for it', async () => {
    const user = userEvent.setup();
    setup(rowsOf('dc-env-01', 'lib-air-01'));
    await user.type(field(), '30');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Metric' }), 'humidity_pct');
    expect(screen.getByLabelText('Hold humidity_pct at')).toHaveValue('');
  });

  it('says there is no metric, and cannot hold, when the selection is empty', () => {
    setup([]);
    expect(screen.getByText('The selected devices report no metric.')).toBeInTheDocument();
    expect(holdButton()).toBeDisabled();
  });

  it('closes on Cancel, on Esc and on a click on the dim part, and does not hold', async () => {
    const user = userEvent.setup();
    const a = setup(rowsOf('dc-env-01'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(a.onClose).toHaveBeenCalledTimes(1);
    a.unmount();

    const b = setup(rowsOf('dc-env-01'));
    await user.keyboard('{Escape}');
    expect(b.onClose).toHaveBeenCalledTimes(1);
    b.unmount();

    const c = setup(rowsOf('dc-env-01'));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(c.onClose).toHaveBeenCalledTimes(1);
    expect(c.onHold).not.toHaveBeenCalled();
  });

  it('does not close on a click inside the dialog', () => {
    const { onClose } = setup(rowsOf('dc-env-01'));
    fireEvent.mouseDown(screen.getByText('Hold a value'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab and Shift Tab inside, and gives the page back when it leaves', async () => {
    const user = userEvent.setup();
    const { store, unmount } = setup(rowsOf('dc-env-01', 'lib-air-01'));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 20; i++) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 20; i++) await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(store.getState().modalCount).toBe(0);
  });

  it('has no accessibility violations', async () => {
    setup(rowsOf('dc-env-01', 'lib-air-01', 'hub-power-01'));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Hold a value on the selected devices, from the Fleet', () => {
  it('holds the value on each selected device that reports the metric, and says what happened', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet({ path: '/fleet?view=table' });
    await user.click(screen.getByRole('checkbox', { name: 'Select dc-env-01' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select lib-air-01' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select hub-power-01' }));
    await user.click(screen.getByRole('button', { name: 'Hold value…' }));
    await user.type(field(), '31.5');
    await user.click(holdButton());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await screen.findByText(
      (_, el) =>
        el?.tagName === 'P' && el.textContent === 'Holding temperature_c at 31.5: 2 of 2 done.',
    );
    const puts = deviceCalls(simulator, 'PUT', 'temperature_c');
    expect(puts.map((c) => c.url)).toEqual([
      '/api/devices/dc-env-01/holds/temperature_c',
      '/api/devices/lib-air-01/holds/temperature_c',
    ]);
    expect(puts.every((c) => (c.body as { value: number }).value === 31.5)).toBe(true);
  });

  it('gives the focus back to the Hold value button', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table' });
    await user.click(screen.getByRole('checkbox', { name: 'Select dc-env-01' }));
    const opener = screen.getByRole('button', { name: 'Hold value…' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
