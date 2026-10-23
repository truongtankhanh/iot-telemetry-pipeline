import type { ReactNode } from 'react';
import { MESSAGE_SIZES } from '../../lib/messageQuery';
import type { MessageRow, RowTag } from '../../lib/messageRows';
import { isoTime } from '../../lib/time';
import { MESSAGE_CAPACITY } from '../../state/messageLog';
import { Chip } from '../../ui/Chip';
import { type Column, DataTable } from '../../ui/DataTable';
import { toneIcons } from '../../ui/icons';
import { Pager } from '../../ui/Pager';
import styles from './events.module.css';

export interface MessageTableProps {
  /** The rows of the page shown. */
  rows: readonly MessageRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  page: number;
  size: number;
  /** Rows that pass the filters, over every page. */
  total: number;
  /** A filter is on: the range says "matching" instead of "the last 200 are kept". */
  filtered: boolean;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
  /** What the table says when it has no rows. */
  empty: ReactNode;
}

const TAGS: Record<RowTag, { label: string; tone: 'neutral' | 'accent' | 'warn' | 'bad' }> = {
  duplicate: { label: 'Duplicate', tone: 'warn' },
  burst: { label: 'Burst', tone: 'accent' },
  republish: { label: 'Republished', tone: 'accent' },
  malformed: { label: 'Malformed', tone: 'bad' },
};

const COLUMNS: Column<MessageRow>[] = [
  {
    id: 'time',
    header: 'Time',
    cell: (row) =>
      row.atMs === null ? (
        <span className={styles.time}>{row.time}</span>
      ) : (
        <time className={styles.time} dateTime={isoTime(row.atMs)}>
          {row.time}
        </time>
      ),
  },
  {
    id: 'device',
    header: 'Device',
    cell: (row) => <span className={styles.mono}>{row.deviceId}</span>,
  },
  {
    id: 'seq',
    header: 'Seq',
    align: 'end',
    cell: (row) => <span className={styles.num}>{row.seq.toLocaleString('en-US')}</span>,
  },
  {
    id: 'metrics',
    header: 'Metrics',
    cell: (row) => (
      <span className={styles.metrics}>
        <span
          className={`${styles.metricsText} ${row.readable ? '' : styles.unreadable}`}
          title={row.summary}
        >
          {row.summary}
        </span>
        {row.tag === null ? null : (
          <Chip tone={TAGS[row.tag].tone}>
            <span title={row.fault ?? undefined}>{TAGS[row.tag].label}</span>
          </Chip>
        )}
      </span>
    ),
  },
  {
    id: 'size',
    header: 'Size',
    align: 'end',
    cell: (row) => <span className={styles.num}>{row.sizeBytes.toLocaleString('en-US')} B</span>,
  },
  {
    id: 'puback',
    header: 'PUBACK',
    cell: (row) =>
      row.ackMs === null ? (
        <span className={styles.num}>—</span>
      ) : (
        <Chip tone="ok" icon={toneIcons.ok}>
          <span className={styles.num}>{row.ackMs} ms</span>
        </Chip>
      ),
  },
];

/**
 * The tail as a table, newest first, and its numbered pager. A row opens its detail from the pointer or from Enter and Space.
 * Page and size belong in the address; this only reports a change. Page 1 follows the stream and leaving it holds the list, which
 * the line under the pager says.
 */
export function MessageTable({
  rows,
  selectedId,
  onSelect,
  page,
  size,
  total,
  filtered,
  onPageChange,
  onSizeChange,
  empty,
}: MessageTableProps) {
  return (
    <>
      <DataTable
        caption="Published messages, newest first"
        columns={COLUMNS}
        rows={[...rows]}
        rowKey={(row) => String(row.id)}
        selectedKey={selectedId === null ? null : String(selectedId)}
        onRowClick={(row) => onSelect(row.id)}
        empty={empty}
      />
      <Pager
        page={page}
        pageSize={size}
        total={total}
        sizes={MESSAGE_SIZES}
        noun="Rows"
        sizeLabel="Rows per page"
        rangeNote={
          filtered ? 'matching the filters' : `the last ${MESSAGE_CAPACITY} are kept in memory`
        }
        label="Message pages"
        onPageChange={onPageChange}
        onPageSizeChange={onSizeChange}
      />
      <p className={styles.hint}>Page 1 follows live; leaving it pauses the tail.</p>
    </>
  );
}
