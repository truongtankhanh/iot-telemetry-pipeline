import { clampPage, PAGE_SIZES, pageCount, pageWindow, rowRange } from '../lib/paging';
import { Icon } from './Icon';
import { uiIcons } from './icons';
import styles from './table.module.css';

export interface PagerProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  sizes?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** What the rows are ("Rows", "Scenarios"): the range reads "Rows 26–50 of 312". */
  noun?: string;
  /** The name of the page-size field ("Rows per page", "Cards per page"). */
  sizeLabel?: string;
  /** Said after the range ("recently run first"): "Scenarios 1–6 of 38, recently run first". */
  rangeNote?: string;
  /**
   * Announces the range politely when it changes (a `status` region). A page change moves nothing on the screen a
   * reader is on, so a page that pages cards rather than a table asks for it; the Fleet's table does not.
   */
  announce?: boolean;
}

/**
 * Numbered paging under a table: the range, the rows per page, and the page buttons (the first, the last
 * and the ones around the current page). The current page is lit and marked with `aria-current`, a
 * disabled end has no light. Page and size belong in the URL; this component only reports changes.
 */
export function Pager({
  page,
  pageSize,
  total,
  sizes = PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  noun = 'Rows',
  sizeLabel = 'Rows per page',
  rangeNote,
  announce = false,
}: PagerProps) {
  const count = pageCount(total, pageSize);
  const current = clampPage(page, count);
  const { from, to } = rowRange(current, pageSize, total);

  return (
    <nav className={styles.pager} aria-label={`${noun} pages`}>
      <span
        className={styles.range}
        {...(announce ? ({ role: 'status', 'aria-live': 'polite' } as const) : {})}
      >
        {noun}{' '}
        <b>
          {from}–{to}
        </b>{' '}
        of <b>{total}</b>
        {rangeNote === undefined ? null : `, ${rangeNote}`}
      </span>
      <label className={styles.sizes}>
        <span>{sizeLabel}</span>
        <select
          className={styles.select}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.pages}>
        <button
          type="button"
          className={styles.page}
          disabled={current <= 1}
          aria-label="Previous page"
          onClick={() => onPageChange(current - 1)}
        >
          <Icon glyph={uiIcons.previous} size="sm" />
        </button>
        {pageWindow(current, count).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={styles.page}
              aria-current={item === current ? 'page' : undefined}
              aria-label={`Page ${item}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={styles.page}
          disabled={current >= count}
          aria-label="Next page"
          onClick={() => onPageChange(current + 1)}
        >
          <Icon glyph={uiIcons.next} size="sm" />
        </button>
      </span>
    </nav>
  );
}
