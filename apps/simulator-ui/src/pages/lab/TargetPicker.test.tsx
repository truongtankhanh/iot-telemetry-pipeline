import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { StateView } from '../../api/types';
import { buildFleetRows } from '../../lib/fleetRows';
import type { TargetScope } from '../../lib/labTargets';
import { axeViolations } from '../../test-axe';
import { labFleet } from './labTestSupport';
import { TargetPicker } from './TargetPicker';

const NOW = Date.parse('2026-10-21T09:15:00.000Z');

const rowsOf = (view: StateView) =>
  buildFleetRows({ view, now: NOW, seriesOf: () => [], lastSeenOf: () => null });

/** The picker with a choice of its own, as the configuration panel holds one. */
function Harness({ view, initial = [] }: { view: StateView; initial?: string[] }) {
  const [scope, setScope] = useState<TargetScope>('device');
  const [targets, setTargets] = useState<string[]>(initial);
  return (
    <TargetPicker
      rows={rowsOf(view)}
      scope={scope}
      targets={targets}
      onScope={(next) => {
        setScope(next);
        setTargets([]);
      }}
      onChange={setTargets}
    />
  );
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: /Choose targets…|Add…/ }));
  return screen.getByRole('group', { name: 'Choose targets' });
};

describe('TargetPicker', () => {
  it('says no target is chosen, and offers to choose', () => {
    render(<Harness view={labFleet(6)} />);
    expect(screen.getByText('No target chosen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose targets…' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens a popover with the search focused, the tabs and their counts, and the devices under their zone', async () => {
    render(<Harness view={labFleet(10, 2)} />);
    const panel = await open();

    expect(screen.getByRole('button', { name: /Choose targets…/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(panel).getByRole('searchbox', { name: /Search devices/ })).toHaveFocus();
    expect(within(panel).getByRole('radio', { name: 'All 10' })).toBeChecked();
    expect(within(panel).getByRole('radio', { name: 'Playing 10' })).toBeInTheDocument();
    expect(within(panel).getByRole('radio', { name: 'Problems 0' })).toBeInTheDocument();
    expect(within(panel).getByRole('checkbox', { name: 'Select zone Z01' })).toBeInTheDocument();
    expect(within(panel).getByRole('checkbox', { name: 'Select d001' })).toBeInTheDocument();
    expect(
      within(panel).getByText(
        'Catalogue assets cannot be a target until the simulator plays them.',
      ),
    ).toBeInTheDocument();
  });

  it('chooses a device: a chip, and the sentence of how many devices the fault reaches', async () => {
    render(<Harness view={labFleet(30, 2)} />);
    const panel = await open();
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Select d001' }));

    const chips = screen.getByRole('list', { name: 'Chosen targets' });
    expect(within(chips).getByText('d001')).toBeInTheDocument();
    expect(screen.getByText('Applies to 1 of 30 devices in Z01')).toBeInTheDocument();
    expect(within(panel).getByText('1 of 15')).toBeInTheDocument();
  });

  it('makes the box of a zone half-ticked for part of it, and ticks the whole zone from it', async () => {
    render(<Harness view={labFleet(30, 2)} />);
    const panel = await open();
    const zone = within(panel).getByRole('checkbox', { name: 'Select zone Z01' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Select d001' }));
    expect(zone).toHaveProperty('indeterminate', true);

    await userEvent.click(zone);
    expect(zone).toBeChecked();
    expect(zone).toHaveProperty('indeterminate', false);
    expect(screen.getByText(/^Applies to 15 of 30 devices in Z01/)).toBeInTheDocument();

    await userEvent.click(zone);
    expect(screen.getByText('No target chosen')).toBeInTheDocument();
  });

  it('shows a few devices of a big zone and the rest when asked', async () => {
    render(<Harness view={labFleet(30, 2)} />);
    const panel = await open();
    expect(within(panel).queryByRole('checkbox', { name: 'Select d013' })).not.toBeInTheDocument();

    await userEvent.click(
      within(panel).getAllByRole('button', { name: 'Show 9 more in this zone' })[0]!,
    );
    expect(within(panel).getByRole('checkbox', { name: 'Select d013' })).toBeInTheDocument();
  });

  it('narrows the list by the search and by the tab', async () => {
    const view = labFleet(10, 2);
    view.engine.devices[1]!.state = 'paused';
    render(<Harness view={view} />);
    const panel = await open();

    await userEvent.click(within(panel).getByRole('radio', { name: 'Problems 1' }));
    expect(within(panel).getByRole('checkbox', { name: 'Select d002' })).toBeInTheDocument();
    expect(within(panel).queryByRole('checkbox', { name: 'Select d001' })).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('radio', { name: 'All 10' }));
    await userEvent.type(within(panel).getByRole('searchbox'), 'd005');
    expect(within(panel).getAllByRole('checkbox', { name: /^Select d/ })).toHaveLength(1);
    expect(within(panel).getByRole('radio', { name: 'All 1' })).toBeInTheDocument();

    await userEvent.clear(within(panel).getByRole('searchbox'));
    await userEvent.type(within(panel).getByRole('searchbox'), 'nothing like it');
    expect(within(panel).getByRole('status')).toHaveTextContent('No device matches.');
  });

  it('takes a chip out with its own button', async () => {
    render(<Harness view={labFleet(6)} initial={['d001', 'd002']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove d001' }));
    const chips = screen.getByRole('list', { name: 'Chosen targets' });
    expect(within(chips).queryByText('d001')).not.toBeInTheDocument();
    expect(within(chips).getByText('d002')).toBeInTheDocument();
  });

  it('chooses whole zones in zone scope, with the number of devices on the chip', async () => {
    render(<Harness view={labFleet(30, 2)} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Zone' }));
    const panel = await open();
    expect(within(panel).queryByRole('radio', { name: /^All/ })).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Select Z02' }));
    const chips = screen.getByRole('list', { name: 'Chosen targets' });
    expect(within(chips).getByText('Z02')).toBeInTheDocument();
    expect(within(chips).getByText(/· 15/)).toBeInTheDocument();
    expect(screen.getByText('Applies to 15 of 30 devices in Z02')).toBeInTheDocument();
  });

  it('chooses a class in class scope, written for a person', async () => {
    render(<Harness view={labFleet(30, 2)} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Class' }));
    const panel = await open();
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Select Server room' }));
    expect(
      within(screen.getByRole('list', { name: 'Chosen targets' })).getByText('Server room'),
    ).toBeInTheDocument();
  });

  it('starts a new choice when the scope changes', async () => {
    render(<Harness view={labFleet(6)} initial={['d001']} />);
    expect(screen.getByRole('button', { name: 'Remove d001' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Zone' }));
    expect(screen.queryByRole('button', { name: 'Remove d001' })).not.toBeInTheDocument();
    expect(screen.getByText('No target chosen')).toBeInTheDocument();
  });

  it('closes with Escape and puts focus back on the button, and closes on Done and on a click elsewhere', async () => {
    render(
      <>
        <Harness view={labFleet(6)} />
        <button type="button">Elsewhere</button>
      </>,
    );
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Choose targets' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose targets…' })).toHaveFocus();

    const panel = await open();
    await userEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: 'Choose targets' })).not.toBeInTheDocument();

    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('group', { name: 'Choose targets' })).not.toBeInTheDocument();
  });

  it('has no accessibility violation, closed and open', async () => {
    const { container } = render(<Harness view={labFleet(30, 2)} initial={['d001']} />);
    expect(await axeViolations(container)).toEqual([]);
    await open();
    expect(await axeViolations(container)).toEqual([]);
  });
});
