import type { TwinDeviceRow } from '../../lib/twinPins';
import { formatAgo } from '../../lib/time';
import { type Column, DataTable } from '../../ui/DataTable';
import styles from './twin.module.css';

export interface TwinDevicesProps {
  rows: readonly TwinDeviceRow[];
  /** The selected device, marked in the list. */
  selectedId: string | null;
  /** The page's clock, for "last heard". */
  now: number;
  onSelect: (deviceId: string) => void;
}

const readings = (row: TwinDeviceRow) =>
  row.readings.length === 0
    ? '—'
    : row.readings.map((reading) => `${reading.label} ${reading.text}`).join(', ');

const COLUMNS: (now: number) => Column<TwinDeviceRow>[] = (now) => [
  {
    id: 'device',
    header: 'Device',
    cell: (row) => (row.name === row.id ? row.name : `${row.name} (${row.id})`),
  },
  { id: 'building', header: 'Building', cell: (row) => `${row.zoneName} (${row.zone})` },
  {
    id: 'state',
    header: 'State',
    cell: (row) => {
      const state = row.reason === null ? row.stateWord : `${row.stateWord}: ${row.reason}`;
      return row.alert === null ? state : `${state} · ${row.alert}`;
    },
  },
  { id: 'values', header: 'Latest values', cell: readings },
  {
    id: 'heard',
    header: 'Last heard',
    cell: (row) => (row.lastSeen === null ? '—' : formatAgo(row.lastSeen, now)),
  },
  {
    id: 'position',
    header: 'Position in the twin',
    cell: (row) =>
      row.placement === null ? `Not drawn: ${row.notPlacedReason ?? 'no position'}` : row.placement,
  },
];

/**
 * The text twin: every device Fleet lists, with the same name and state word, its latest values and whether the scene
 * draws it, so that with the scene hidden (or never seen) every value and state on the page is still text. It is the part
 * of the page a screen reader reads in place of the picture, and, because a row can be chosen with Enter or Space, the
 * keyboard route to a selection that the pins cannot give. It is visually hidden until focus is inside it, and then shown,
 * so a sighted keyboard user never has focus on something they cannot see.
 */
export function TwinDevices({ rows, selectedId, now, onSelect }: TwinDevicesProps) {
  return (
    <section className={styles.devices} aria-label="Devices in the twin, as text">
      <DataTable
        caption="Devices in the twin, as text: name, building, state, latest values, last heard and position"
        columns={COLUMNS(now)}
        rows={[...rows]}
        rowKey={(row) => row.id}
        selectedKey={selectedId}
        onRowClick={(row) => onSelect(row.id)}
        empty="The simulator plays no device."
      />
    </section>
  );
}
