import type { KeyboardEvent, ReactNode } from 'react';
import styles from './table.module.css';

export interface Column<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
}

export interface DataTableProps<Row> {
  /** Read by a screen reader as the name of the table; not drawn. */
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** The row to mark as selected (indigo), by key. */
  selectedKey?: string | null;
  /** Makes rows open something: they get a pointer, a tab stop and Enter or Space. */
  onRowClick?: (row: Row) => void;
  /** A quiet action at the end of a row, shown on hover and on keyboard focus. */
  rowAction?: (row: Row) => ReactNode;
  /** What to show when there are no rows. */
  empty?: ReactNode;
}

/**
 * A table whose rows light up under the pointer (a cyan wash and a bar), and, when they open something,
 * can be reached and opened from the keyboard. Selected keeps its indigo bar and does not change on hover.
 * It does not page: a table longer than 25 rows is paged by a `Pager` beside it (page and size in the URL).
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  selectedKey = null,
  onRowClick,
  rowAction,
  empty = 'Nothing to show',
}: DataTableProps<Row>) {
  const open = (row: Row) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return; // a key pressed in an action belongs to the action
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  };

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                data-align={column.align === 'end' ? 'end' : undefined}
              >
                {column.header}
              </th>
            ))}
            {rowAction ? (
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={styles.row}
                data-clickable={onRowClick ? 'true' : undefined}
                aria-current={key === selectedKey ? 'true' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? open(row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.id} data-align={column.align === 'end' ? 'end' : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
                {rowAction ? (
                  // An action is not the row: using it must not also open the row.
                  <td onClick={(event) => event.stopPropagation()}>
                    <span className={styles.rowAction}>{rowAction(row)}</span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? <div className={styles.empty}>{empty}</div> : null}
    </div>
  );
}
