import { STATUS_TONES } from '../../lib/deviceStatus';
import { paginate } from '../../lib/fleetQuery';
import {
  ZONE_TAB_LABELS,
  ZONE_TABS,
  type ZoneTab,
  type ZoneTable as Table,
  type ZoneTableRow,
} from '../../lib/labZones';
import { LAB_TABLE_SIZE } from '../../lib/labQuery';
import { primaryReading } from '../../lib/topologyDetail';
import { type Column, DataTable } from '../../ui/DataTable';
import { DeviceBadge } from '../../ui/DeviceBadge';
import { Chip } from '../../ui/Chip';
import { stageGlyphs } from '../../ui/icons';
import { Pager } from '../../ui/Pager';
import { Pill } from '../../ui/Pill';
import { Segmented } from '../../ui/Segmented';
import styles from './zoneList.module.css';

export interface ZoneTableProps {
  zone: string;
  table: Table;
  tab: ZoneTab;
  /** 1-based; a page past the end is the last one. */
  page: number;
  onTab: (tab: ZoneTab) => void;
  onPage: (page: number) => void;
}

/**
 * The devices of the zone chosen in the list (frame 19): the device, its state, its reading, the fault on it, when that
 * starts and its alert, with the tabs _All / Targets / Problems_ and a pager. It is the Fleet's table component (`DataTable`
 * and `Pager`), so rows, hover and keyboard behave as they do there.
 */
export function ZoneTable({ zone, table, tab, page, onTab, onPage }: ZoneTableProps) {
  const paged = paginate(table.rows, page, LAB_TABLE_SIZE);

  const columns: Column<ZoneTableRow>[] = [
    {
      id: 'device',
      header: 'Device',
      cell: ({ row, targeted }) => (
        <span className={styles.device}>
          <DeviceBadge kind={row.device.kind} code={row.code} state={row.status.node} />
          <b className={styles.mono}>{row.device.id}</b>
          {targeted ? <Chip tone="accent">Target</Chip> : null}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      cell: ({ row }) => (
        <Pill label={row.status.word} tone={STATUS_TONES[row.status.kind]} detail={null} />
      ),
    },
    {
      id: 'reading',
      header: 'Reading',
      cell: ({ row }) => primaryReading(row)?.text ?? '—',
    },
    { id: 'fault', header: 'Fault', cell: ({ fault }) => fault ?? '—' },
    { id: 'started', header: 'Started', cell: ({ started }) => started ?? '—' },
    {
      id: 'alert',
      header: 'Alert',
      cell: ({ alert }) =>
        alert === null ? (
          '—'
        ) : (
          <Chip tone="warn" icon={stageGlyphs.alert}>
            Alert #{alert.id}
          </Chip>
        ),
    },
  ];

  return (
    <section className={styles.tableCard} aria-label={`Devices of ${zone}`}>
      <div className={styles.tableHead}>
        <h3 className={styles.tableTitle}>{zone}</h3>
        <span className={styles.faint}>
          {table.counts.all} devices · the zone selected in the list
        </span>
        <span className={styles.spacer} />
        <Segmented
          label="Show"
          value={tab}
          onChange={(value) => onTab(value as ZoneTab)}
          options={ZONE_TABS.map((value) => ({
            value,
            label: `${ZONE_TAB_LABELS[value]} ${table.counts[value]}`,
          }))}
        />
      </div>
      <DataTable
        caption={`Devices of ${zone}`}
        columns={columns}
        rows={paged.items}
        rowKey={({ row }) => row.device.id}
        empty={<p className={styles.faint}>No device on this tab.</p>}
      />
      {paged.pageCount > 1 || table.rows.length > 0 ? (
        <Pager
          page={paged.page}
          pageSize={LAB_TABLE_SIZE}
          total={table.rows.length}
          sizes={[LAB_TABLE_SIZE]}
          noun="Devices"
          label="Zone pages"
          onPageChange={onPage}
          onPageSizeChange={() => {}}
        />
      ) : null}
    </section>
  );
}
