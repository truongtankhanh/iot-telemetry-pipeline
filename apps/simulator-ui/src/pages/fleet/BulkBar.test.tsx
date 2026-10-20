import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test-axe';
import { BulkBar, type BulkBarProps } from './BulkBar';
import { BulkStatus, type BulkStatusProps } from './BulkStatus';
import { address, deviceCalls, renderFleet } from './fleetTestSupport';
import type { BulkState } from './useBulkRun';

afterEach(() => {
  vi.unstubAllGlobals();
});

const barProps = (change: Partial<BulkBarProps> = {}): BulkBarProps => ({
  selectedCount: 2,
  onPageCount: 2,
  filteredTotal: 6,
  busy: false,
  onRun: vi.fn(),
  onHold: vi.fn(),
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  ...change,
});

describe('BulkBar', () => {
  it('is not there when nothing is selected', () => {
    const { container } = render(<BulkBar {...barProps({ selectedCount: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how many are selected, and how many of them are on this page', () => {
    const { rerender } = render(<BulkBar {...barProps()} />);
    const bar = screen.getByRole('region', { name: 'Actions for the selected devices' });
    expect(bar).toHaveTextContent('2 selected on this page');
    rerender(<BulkBar {...barProps({ selectedCount: 12, onPageCount: 5 })} />);
    expect(bar).toHaveTextContent('12 selected · 5 on this page');
  });

  it('names each action with the number it acts on', () => {
    render(<BulkBar {...barProps({ selectedCount: 1, onPageCount: 1 })} />);
    expect(screen.getByRole('button', { name: 'Pause 1 selected device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start 1 selected device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop 1 selected device' })).toBeInTheDocument();
  });

  it('asks for pause, start and stop, a hold, select all and clear', async () => {
    const user = userEvent.setup();
    const props = barProps();
    render(<BulkBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Pause 2 selected devices' }));
    await user.click(screen.getByRole('button', { name: 'Start 2 selected devices' }));
    await user.click(screen.getByRole('button', { name: 'Stop 2 selected devices' }));
    expect(props.onRun).toHaveBeenNthCalledWith(1, 'pause');
    expect(props.onRun).toHaveBeenNthCalledWith(2, 'start');
    expect(props.onRun).toHaveBeenNthCalledWith(3, 'stop');
    await user.click(screen.getByRole('button', { name: 'Hold value…' }));
    expect(props.onHold).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Select all 6' }));
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('does not offer "Select all" when everything is selected', () => {
    render(<BulkBar {...barProps({ selectedCount: 6, onPageCount: 6 })} />);
    expect(screen.queryByRole('button', { name: /^Select all/ })).not.toBeInTheDocument();
  });

  it('waits while a run is going: the actions are off, Clear is not', () => {
    render(<BulkBar {...barProps({ busy: true })} />);
    for (const name of [/^Pause/, /^Start/, /^Stop/, /^Hold value/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<BulkBar {...barProps()} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

const idle: BulkState = { label: null, done: 0, total: 0, running: false, results: [] };
const statusProps = (change: Partial<BulkStatusProps> = {}): BulkStatusProps => ({
  pending: null,
  onConfirm: vi.fn(),
  onCancelConfirm: vi.fn(),
  state: idle,
  onCancelRun: vi.fn(),
  onDismiss: vi.fn(),
  ...change,
});

describe('BulkStatus', () => {
  it('says nothing when there is nothing to say', () => {
    const { container } = render(<BulkStatus {...statusProps()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks before a run on many devices, with the answer in focus, and reports the choice', async () => {
    const user = userEvent.setup();
    const props = statusProps({ pending: { action: 'stop', ids: ['a', 'b', 'c'] } });
    render(<BulkStatus {...props} />);
    const group = screen.getByRole('group', { name: 'Confirm' });
    expect(group).toHaveTextContent('Stop 3 devices?');
    expect(within(group).getByRole('button', { name: 'Stop 3' })).toHaveFocus();
    await user.click(within(group).getByRole('button', { name: 'Stop 3' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    await user.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows progress while it runs, and a way to stop the run', async () => {
    const user = userEvent.setup();
    const props = statusProps({
      state: { label: 'Pausing', done: 3, total: 12, running: true, results: [] },
    });
    render(<BulkStatus {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pausing… 3 of 12');
    const bar = screen.getByRole('progressbar', { name: 'Pausing, 3 of 12' });
    expect((bar as HTMLProgressElement).value).toBe(3);
    expect((bar as HTMLProgressElement).max).toBe(12);
    await user.click(screen.getByRole('button', { name: 'Stop here' }));
    expect(props.onCancelRun).toHaveBeenCalledTimes(1);
  });

  it('reports a run that went well, and can be dismissed', async () => {
    const user = userEvent.setup();
    const props = statusProps({
      state: {
        label: 'Starting',
        done: 2,
        total: 2,
        running: false,
        results: [
          { id: 'a', ok: true },
          { id: 'b', ok: true },
        ],
      },
    });
    render(<BulkStatus {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Starting: 2 of 2 done.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lists the devices that failed and why', () => {
    render(
      <BulkStatus
        {...statusProps({
          state: {
            label: 'Stopping',
            done: 3,
            total: 3,
            running: false,
            results: [
              { id: 'a', ok: true },
              { id: 'b', ok: false, error: 'Unknown device "b"' },
              { id: 'c', ok: false, error: 'Cannot reach the simulator' },
            ],
          },
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Stopping: 1 of 3 done, 2 failed.');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('b: Unknown device "b"');
    expect(items[1]).toHaveTextContent('c: Cannot reach the simulator');
  });

  it('says when it was stopped before the end', () => {
    render(
      <BulkStatus
        {...statusProps({
          state: {
            label: 'Pausing',
            done: 2,
            total: 5,
            running: false,
            results: [
              { id: 'a', ok: true },
              { id: 'b', ok: true },
            ],
          },
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Pausing: 2 of 5 done, stopped after 2.');
  });
});

describe('selecting devices in the Fleet table', () => {
  const rowOf = (id: string) => screen.getByText(id).closest('tr') as HTMLElement;
  const tick = (user: ReturnType<typeof userEvent.setup>, id: string) =>
    user.click(screen.getByRole('checkbox', { name: `Select ${id}` }));

  it('shows the bar once something is selected, and takes it away on Clear', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table' });
    expect(
      screen.queryByRole('region', { name: 'Actions for the selected devices' }),
    ).not.toBeInTheDocument();
    await tick(user, 'dc-env-01');
    await tick(user, 'dc-env-02');
    expect(
      screen.getByRole('region', { name: 'Actions for the selected devices' }),
    ).toHaveTextContent('2 selected');
    expect(rowOf('dc-env-01')).toHaveAttribute('data-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(
      screen.queryByRole('region', { name: 'Actions for the selected devices' }),
    ).not.toBeInTheDocument();
  });

  it('pauses exactly the selected devices', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet({ path: '/fleet?view=table' });
    await tick(user, 'dc-env-01');
    await tick(user, 'lib-air-01');
    await user.click(screen.getByRole('button', { name: 'Pause 2 selected devices' }));
    await screen.findByText(
      (_, el) => el?.tagName === 'P' && el.textContent === 'Pausing: 2 of 2 done.',
    );
    expect(deviceCalls(simulator, 'POST', 'pause').map((c) => c.url)).toEqual([
      '/api/devices/dc-env-01/pause',
      '/api/devices/lib-air-01/pause',
    ]);
  });

  it('selects the whole page from the header box, and the whole filtered list with "Select all"', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table&zone=BLD-DC' });
    await user.click(screen.getByRole('checkbox', { name: 'Select this page' }));
    expect(
      screen.getByRole('region', { name: 'Actions for the selected devices' }),
    ).toHaveTextContent('2 selected');
    expect(screen.queryByRole('button', { name: /^Select all/ })).not.toBeInTheDocument();
  });

  it('offers "Select all" for the filtered list when the page holds only part of it', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table&size=10' });
    await tick(user, 'dc-env-01');
    await user.click(screen.getByRole('button', { name: 'Select all 6' }));
    expect(
      screen.getByRole('region', { name: 'Actions for the selected devices' }),
    ).toHaveTextContent('6 selected');
  });

  it('keeps the selection across a page and drops a device that a filter hides', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table' });
    await tick(user, 'dc-env-01');
    await tick(user, 'lib-air-01');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Zone' }), 'BLD-LIB');
    expect(
      screen.getByRole('region', { name: 'Actions for the selected devices' }),
    ).toHaveTextContent('1 selected');
    expect(address()).toBe('/fleet?zone=BLD-LIB&view=table');
  });

  it('does not offer the bar in the cards view', () => {
    renderFleet();
    expect(
      screen.queryByRole('region', { name: 'Actions for the selected devices' }),
    ).not.toBeInTheDocument();
  });

  it('has no accessibility violations with a selection and a run result', async () => {
    const user = userEvent.setup();
    const { container } = renderFleet({ path: '/fleet?view=table' });
    await tick(user, 'dc-env-01');
    await user.click(screen.getByRole('button', { name: 'Pause 1 selected device' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument(),
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
