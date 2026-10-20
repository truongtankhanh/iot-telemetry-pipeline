import { useState } from 'react';
import { metricLabel, metricUnit } from '../../lib/deviceIdentity';
import { STATUS_TONES } from '../../lib/deviceStatus';
import {
  type FleetQuery,
  type FleetResult,
  type FleetRow,
  kindLabel,
  pageSelection,
  paginate,
  setPageSelected,
  TABLE_SIZES,
  toggleSelected,
} from '../../lib/fleetQuery';
import { formatValue } from '../../lib/rules';
import { formatAgo, formatClockTime } from '../../lib/time';
import { useSeries } from '../../state/historyContext';
import { Button } from '../../ui/Button';
import { Sparkline } from '../../ui/charts/Sparkline';
import { ColumnChooser } from '../../ui/ColumnChooser';
import { type Column, DataTable, type SortState } from '../../ui/DataTable';
import { DeviceBadge } from '../../ui/DeviceBadge';
import { uiIcons } from '../../ui/icons';
import { Pager } from '../../ui/Pager';
import { Pill } from '../../ui/Pill';
import styles from './fleetTable.module.css';

/** The columns the chooser lists; the device column names the row and cannot be hidden. */
const CHOOSER_COLUMNS = [
  { id: 'device', label: 'Device', locked: true },
  { id: 'class', label: 'Class' },
  { id: 'zone', label: 'Zone' },
  { id: 'state', label: 'State' },
  { id: 'reading1', label: 'Reading 1' },
  { id: 'reading2', label: 'Reading 2' },
  { id: 'trend', label: 'Last 2 min' },
  { id: 'seen', label: 'Last seen' },
];

const SORTABLE = ['device', 'class', 'zone', 'state', 'seen'] as const;

function Reading({ row, index }: { row: FleetRow; index: number }) {
  const reading = row.readings[index];
  if (!reading) return <span className={styles.none}>—</span>;
  const unit = metricUnit(reading.metric);
  return (
    <span className={styles.reading}>
      <span className={styles.value}>
        {reading.value === null ? '—' : formatValue(reading.metric, reading.value)}
        {unit && reading.value !== null ? <span className={styles.unit}> {unit}</span> : null}
      </span>
      <span className={styles.metric}>{reading.metric}</span>
    </span>
  );
}

function Trend({ row, now }: { row: FleetRow; now: number }) {
  const metric = row.readings[0]?.metric ?? '';
  const series = useSeries(row.device.id, metric);
  const first = series[0];
  const last = series.at(-1);
  const label =
    first && last
      ? `${metricLabel(metric)} of ${row.device.id}, last 2 minutes: from ${formatValue(metric, first.v)} to ${formatValue(metric, last.v)}`
      : `${metricLabel(metric)} of ${row.device.id}: no readings in the last 2 minutes`;
  return <Sparkline samples={series} now={now} label={label} />;
}

export interface FleetTableProps {
  result: FleetResult;
  query: FleetQuery;
  now: number;
  selected: ReadonlySet<string>;
  openId: string | null;
  onQueryChange: (patch: Partial<FleetQuery>) => void;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (deviceId: string) => void;
}

/**
 * The Fleet above 12 devices (frame 18), or whenever the Table choice is made: a column of checkboxes, sortable
 * columns, a sparkline, a column chooser and a pager. (The state tabs above it are the page's: cards use them too.)
 * Sort, page and size are the address's, not this component's; it reports changes and draws what it is given.
 */
export function FleetTable({
  result,
  query,
  now,
  selected,
  openId,
  onQueryChange,
  onSelectedChange,
  onOpen,
}: FleetTableProps) {
  const [shown, setShown] = useState<ReadonlySet<string>>(
    () => new Set(CHOOSER_COLUMNS.map((c) => c.id)),
  );
  const page = paginate(result.rows, query.page, query.size);
  const pageIds = page.items.map((row) => row.device.id);

  const sort: SortState | null = (SORTABLE as readonly string[]).includes(query.sort)
    ? { columnId: query.sort, direction: query.dir }
    : null;

  const all: Column<FleetRow>[] = [
    {
      id: 'device',
      header: 'Device',
      sortable: true,
      cell: (row) => (
        <span className={styles.device}>
          <DeviceBadge kind={row.device.kind} code={row.code} state={row.status.node} />
          <span>
            <span className={styles.id}>{row.device.id}</span>
            <span className={styles.name}>{row.name}</span>
          </span>
        </span>
      ),
    },
    { id: 'class', header: 'Class', sortable: true, cell: (row) => kindLabel(row.device.kind) },
    { id: 'zone', header: 'Zone', sortable: true, cell: (row) => row.device.zoneCode },
    {
      id: 'state',
      header: 'State',
      sortable: true,
      cell: (row) => (
        <Pill label={row.status.word} tone={STATUS_TONES[row.status.kind]} detail={null} />
      ),
    },
    { id: 'reading1', header: 'Reading 1', cell: (row) => <Reading row={row} index={0} /> },
    { id: 'reading2', header: 'Reading 2', cell: (row) => <Reading row={row} index={1} /> },
    { id: 'trend', header: 'Last 2 min', cell: (row) => <Trend row={row} now={now} /> },
    {
      id: 'seen',
      header: 'Last seen',
      sortable: true,
      align: 'end',
      cell: (row) =>
        row.lastSeen === null ? (
          '—'
        ) : (
          <time
            dateTime={new Date(row.lastSeen).toISOString()}
            title={formatClockTime(row.lastSeen)}
          >
            {formatAgo(row.lastSeen, now)}
          </time>
        ),
    },
  ];
  const columns = all.filter((column) => shown.has(column.id) || column.id === 'device');

  return (
    <section className={styles.table} aria-labelledby="fleet-table-heading">
      <h2 id="fleet-table-heading" className="visually-hidden">
        Devices
      </h2>
      <div className={styles.bar}>
        <ColumnChooser columns={CHOOSER_COLUMNS} visible={shown} onChange={setShown} />
      </div>
      <div>
        <DataTable
          caption="Devices with their state, readings and last seen"
          columns={columns}
          rows={page.items}
          rowKey={(row) => row.device.id}
          selectedKey={openId}
          onRowClick={(row) => onOpen(row.device.id)}
          rowAction={(row) => (
            <Button
              size="sm"
              variant="ghost"
              icon={uiIcons.inspect}
              aria-label={`Details of ${row.device.id}`}
              aria-haspopup="dialog"
              onClick={() => onOpen(row.device.id)}
            />
          )}
          sort={sort}
          onSortChange={(columnId) =>
            onQueryChange({
              sort: columnId as FleetQuery['sort'],
              dir: query.sort === columnId && query.dir === 'asc' ? 'desc' : 'asc',
            })
          }
          selection={{
            selected,
            pageState: pageSelection(selected, pageIds),
            onToggle: (id) => onSelectedChange(toggleSelected(selected, id)),
            onTogglePage: (on) => onSelectedChange(setPageSelected(selected, pageIds, on)),
            label: (row) => `Select ${row.device.id}`,
          }}
          stickyHeader
          empty="No device matches"
        />
        <Pager
          page={page.page}
          pageSize={query.size}
          total={page.total}
          sizes={TABLE_SIZES}
          noun="Devices"
          onPageChange={(next) => onQueryChange({ page: next })}
          onPageSizeChange={(size) => onQueryChange({ size })}
        />
      </div>
    </section>
  );
}
