import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { StateView } from '../../api/types';
import { buildFleetRows } from '../../lib/fleetRows';
import { type ZoneTab, zoneRows, zoneTable } from '../../lib/labZones';
import type { StageNode } from '../../lib/pipeline';
import { axeViolations } from '../../test-axe';
import { labFleet } from './labTestSupport';
import { PipelineStrip, ZoneList } from './ZoneList';
import { ZoneTable } from './ZoneTable';

const NOW = Date.parse('2026-10-21T09:15:00.000Z');

/** 100 devices in 20 zones of 5 (device n is in zone n mod 20); d001 is in an anomaly, d007 and d008 are paused. */
function hundred(): StateView {
  const view = labFleet(100, 20);
  view.engine.devices[6]!.state = 'paused';
  view.engine.devices[7]!.state = 'paused';
  view.engine.anomalies = [
    {
      id: 'a1',
      anomaly: { deviceId: 'd001', metric: 'temperature_c', value: 29.2, startAt: 5, duration: 60 },
    },
  ];
  return view;
}

const rowsOf = (view: StateView) =>
  buildFleetRows({
    view,
    now: NOW,
    seriesOf: (id, metric) =>
      id === 'd001' && metric === 'temperature_c' ? [{ t: NOW - 1000, v: 29.3 }] : [],
    lastSeenOf: () => null,
  });

function List({ targets = new Set<string>() }: { targets?: ReadonlySet<string> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = rowsOf(hundred());
  const zones = zoneRows(rows, targets);
  return (
    <ZoneList
      zones={zones}
      totals={{ zones: zones.length, devices: rows.length }}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

describe('ZoneList: 100 devices in 20 zones', () => {
  it('says how many zones and devices, and lists every zone', () => {
    render(<List />);
    expect(screen.getByText('20 zones · 100 devices')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Zones, worst first' })).getAllByRole('listitem'),
    ).toHaveLength(20);
  });

  it('puts the zone with an anomaly first, then the one with devices paused, each named with its state', () => {
    render(<List />);
    const buttons = within(screen.getByRole('list', { name: 'Zones, worst first' })).getAllByRole(
      'button',
    );
    expect(buttons[0]).toHaveAccessibleName('Z01, 5 devices, anomaly');
    expect(buttons[1]).toHaveAccessibleName('Z07, 5 devices, paused or silent');
    expect(buttons[2]).toHaveAccessibleName('Z08, 5 devices, paused or silent');
    expect(buttons[3]).toHaveAccessibleName('Z02, 5 devices, healthy');
  });

  it('says how many devices of a zone the fault is aimed at, and outlines the zone', () => {
    render(<List targets={new Set(['d001', 'd021', 'd022'])} />);
    const z01 = screen.getByRole('button', { name: /^Z01,/ });
    expect(z01).toHaveAccessibleName('Z01, 5 devices · 2 targeted, anomaly');
    expect(z01).toHaveAttribute('data-targeted', 'true');
    expect(screen.getByRole('button', { name: /^Z02,/ })).toHaveAccessibleName(
      'Z02, 5 devices · 1 targeted, healthy',
    );
    expect(screen.getByRole('button', { name: /^Z10,/ })).not.toHaveAttribute('data-targeted');
  });

  it('draws the states of a zone as a bar, and chooses a zone rather than opening it', async () => {
    const { container } = render(<List />);
    const z07 = screen.getByRole('button', { name: /^Z07,/ });
    expect(z07).toHaveAttribute('aria-pressed', 'false');
    expect(z07.querySelectorAll('i')).toHaveLength(2); // healthy and paused
    await userEvent.click(z07);
    expect(z07).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });

  it('says when no zone matches', () => {
    render(
      <ZoneList
        zones={[]}
        totals={{ zones: 20, devices: 100 }}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No zone matches.');
  });
});

describe('PipelineStrip', () => {
  const stage = (
    id: StageNode['id'],
    label: string,
    state: StageNode['state'],
    word: string,
  ): StageNode => ({
    id,
    label,
    state,
    word,
    headline: id === 'ingest' ? 'lag 0.06 s' : null,
    detail: null,
    asOf: null,
    dimmed: false,
  });

  it('draws each stage once, with its state as a word and its figure', () => {
    render(
      <PipelineStrip
        stages={[
          stage('broker', 'Broker', 'healthy', 'Running'),
          stage('ingest', 'Ingest', 'healthy', 'Running'),
          stage('alert', 'Alert', 'anomaly', '9 open'),
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Pipeline' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('lag 0.06 s')).toBeInTheDocument();
    expect(within(list).getByText('9 open')).toBeInTheDocument();
  });
});

function Table({
  zone,
  tab = 'all',
  page = 1,
  targets = new Set<string>(),
}: {
  zone: string;
  tab?: ZoneTab;
  page?: number;
  targets?: ReadonlySet<string>;
}) {
  const view = hundred();
  const table = zoneTable({
    rows: rowsOf(view),
    zone,
    tab,
    targets,
    engine: view.engine,
    alerts: [],
  });
  return (
    <MemoryRouter>
      <ZoneTable
        zone={zone}
        table={table}
        tab={tab}
        page={page}
        onTab={() => {}}
        onPage={() => {}}
      />
    </MemoryRouter>
  );
}

describe('ZoneTable', () => {
  it('lists the devices of the zone with their state, reading, fault and start', () => {
    render(<Table zone="Z01" targets={new Set(['d001', 'd021'])} />);
    const table = screen.getByRole('table', { name: 'Devices of Z01' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6); // header + 5
    const first = within(rows[1]!);
    expect(first.getByText('d001')).toBeInTheDocument();
    expect(first.getByText('Breach · step')).toBeInTheDocument();
    expect(first.getByText('Anomaly')).toBeInTheDocument();
    expect(first.getByText('Target')).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('names the zone, the number of devices and the tabs with their counts', () => {
    render(<Table zone="Z07" targets={new Set(['d007'])} />);
    expect(screen.getByRole('heading', { name: 'Z07' })).toBeInTheDocument();
    expect(screen.getByText('5 devices · the zone selected in the list')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All 5' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Targets 1' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Problems 1' })).toBeInTheDocument();
  });

  it('shows only the devices of the tab, and says when there are none', () => {
    const { unmount } = render(<Table zone="Z07" tab="problems" />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    unmount();
    render(<Table zone="Z07" tab="targets" />);
    expect(screen.getByText('No device on this tab.')).toBeInTheDocument();
  });

  it('has no accessibility violation', async () => {
    const { container } = render(<Table zone="Z01" targets={new Set(['d001'])} />);
    expect(await axeViolations(container)).toEqual([]);
    const list = render(<List targets={new Set(['d001'])} />);
    expect(await axeViolations(list.container)).toEqual([]);
  });
});
