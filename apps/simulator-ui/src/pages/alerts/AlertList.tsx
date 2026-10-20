import type { ReactNode } from 'react';
import type { PagedAlert } from '../../api/types';
import { formatOpened, severityOf } from '../../lib/alertRows';
import { type Column, DataTable } from '../../ui/DataTable';
import { Chip } from '../../ui/Chip';
import { DeliveryChip } from '../../ui/DeliveryChip';
import { toneIcons } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import styles from './alerts.module.css';

export interface AlertListProps {
  rows: readonly PagedAlert[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A moment the times are told against: an alert of another day shows its date (ms; the page's fetch time). */
  reference: number;
  /** What the table says when it has no rows: no alert at all, or none that passes the filter. */
  empty: ReactNode;
}

function columnsFor(reference: number): Column<PagedAlert>[] {
  return [
    {
      id: 'id',
      header: '#',
      cell: (alert) => <span className={styles.mono}>{alert.id}</span>,
    },
    {
      id: 'severity',
      header: 'Severity',
      cell: (alert) => <SeverityBadge severity={severityOf(alert.severity)} />,
    },
    { id: 'title', header: 'Alert', cell: (alert) => alert.title },
    {
      id: 'device',
      header: 'Device',
      cell: (alert) => <span className={styles.mono}>{alert.deviceId}</span>,
    },
    {
      id: 'opened',
      header: 'Opened',
      cell: (alert) => {
        const opened = Date.parse(alert.openedAt);
        return (
          <time className={styles.time} dateTime={alert.openedAt}>
            {Number.isFinite(opened) ? formatOpened(opened, reference) : alert.openedAt}
          </time>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: (alert) =>
        alert.status === 'open' ? (
          <Chip tone="warn" icon={toneIcons.warn}>
            Open
          </Chip>
        ) : (
          <Chip tone="ok" icon={toneIcons.ok}>
            Cleared
          </Chip>
        ),
    },
    { id: 'delivery', header: 'Delivery', cell: (alert) => <DeliveryChip alert={alert} /> },
  ];
}

/**
 * The alerts of the page on show, newest first, as the API orders them: no sorting, since a column sorted here would
 * only reorder one page. A row opens its detail from the pointer or from Enter and Space. The line under the table
 * says what the delivery column means, including the caveat for a cleared alert (it is the clearing's status).
 */
export function AlertList({ rows, selectedId, onSelect, reference, empty }: AlertListProps) {
  return (
    <>
      <DataTable
        caption="Alerts, newest first"
        columns={columnsFor(reference)}
        rows={[...rows]}
        rowKey={(alert) => alert.id}
        selectedKey={selectedId}
        onRowClick={(alert) => onSelect(alert.id)}
        empty={empty}
      />
      <p className={styles.note}>
        Delivery: <b>Delivered</b>, <b>Pending</b>, <b>Failed</b>, or <b>Skipped</b> when no alert
        sink was configured at the time (<span className={styles.mono}>OCC_API_URL</span> unset on
        ingest). It is the state of the alert&rsquo;s latest outbox event, which for a cleared alert
        is the clearing.
      </p>
    </>
  );
}
