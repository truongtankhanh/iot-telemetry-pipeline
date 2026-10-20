import type { KeyboardEvent, ReactNode } from 'react';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';
import { uiIcons } from './icons';
import styles from './table.module.css';

export interface Column<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
  /** The header becomes a button that asks for this column to be sorted (needs `onSortChange`). */
  sortable?: boolean;
}

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

/** A column of checkboxes at the start, and the box in the header for the rows on show. */
export interface RowSelection<Row> {
  selected: ReadonlySet<string>;
  /** The state of the header box: none, some or all of the rows on show are selected. */
  pageState: 'none' | 'some' | 'all';
  onToggle: (key: string) => void;
  /** Selects, or unselects, every row on show. */
  onTogglePage: (on: boolean) => void;
  /** The name of a row's box for a screen reader; default "Select <key>". */
  label?: (row: Row) => string;
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
  /** Which column the rows are sorted by, for `aria-sort` and the arrow. */
  sort?: SortState | null;
  /** The user asked to sort by this column; the caller decides the direction. */
  onSortChange?: (columnId: string) => void;
  selection?: RowSelection<Row>;
  /** Keeps the header in view while the page scrolls (the Fleet toolbar sits above it). */
  stickyHeader?: boolean;
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
  sort = null,
  onSortChange,
  selection,
  stickyHeader = false,
}: DataTableProps<Row>) {
  const open = (row: Row) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return; // a key pressed in an action belongs to the action
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  };

  return (
    <div className={styles.wrap} data-sticky={stickyHeader ? 'true' : undefined}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className={styles.selectCell}>
                <Checkbox
                  label="Select this page"
                  checked={selection.pageState === 'all'}
                  indeterminate={selection.pageState === 'some'}
                  onChange={(on) => selection.onTogglePage(on)}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const sorted = sort?.columnId === column.id ? sort.direction : null;
              return (
                <th
                  key={column.id}
                  scope="col"
                  data-align={column.align === 'end' ? 'end' : undefined}
                  aria-sort={
                    column.sortable && onSortChange
                      ? sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      data-sorted={sorted ?? undefined}
                      onClick={() => onSortChange(column.id)}
                    >
                      {column.header}
                      {sorted ? (
                        <Icon glyph={sorted === 'asc' ? uiIcons.up : uiIcons.down} size="sm" />
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
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
                data-selected={selection?.selected.has(key) ? 'true' : undefined}
                aria-current={key === selectedKey ? 'true' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? open(row) : undefined}
              >
                {selection ? (
                  // A box is not the row: ticking it must not also open the row.
                  <td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      label={selection.label?.(row) ?? `Select ${key}`}
                      checked={selection.selected.has(key)}
                      onChange={() => selection.onToggle(key)}
                    />
                  </td>
                ) : null}
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
