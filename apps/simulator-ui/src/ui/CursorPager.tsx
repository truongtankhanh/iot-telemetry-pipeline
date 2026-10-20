import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { uiIcons } from './icons';
import { SelectField } from './SelectField';
import styles from './table.module.css';

export interface CursorPagerProps {
  size: number;
  sizes: readonly number[];
  onSizeChange: (size: number) => void;
  /** What the page on show is, in words, read out politely when it changes ("Showing 5 alerts · newest first"). */
  position: string;
  canNewer: boolean;
  canOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
  /** What the rows are ("Alert"): the bar is the "Alert pages" navigation. */
  noun?: string;
  /** The name of the page-size field ("Alerts per page"). */
  sizeLabel?: string;
  /** A sentence about the kind of paging, shown under the bar. */
  note?: string;
}

type Step = 'newer' | 'older';

/**
 * Paging for an API that gives a cursor and nothing else: _Newer_ and _Older_, the page size, and a line that says
 * where the page is, with no page numbers and no total. Page size and the cursor are the owner's state; this only
 * reports clicks. A step that has just become impossible (the newest page was reached) would strand the keyboard on a
 * disabled button, so focus moves to the other step.
 */
export function CursorPager({
  size,
  sizes,
  onSizeChange,
  position,
  canNewer,
  canOlder,
  onNewer,
  onOlder,
  noun = 'Alert',
  sizeLabel = 'Alerts per page',
  note,
}: CursorPagerProps) {
  const newerRef = useRef<HTMLButtonElement>(null);
  const olderRef = useRef<HTMLButtonElement>(null);
  const focused = useRef<Step | null>(null);

  useEffect(() => {
    if (focused.current === 'newer' && !canNewer) olderRef.current?.focus();
    else if (focused.current === 'older' && !canOlder) newerRef.current?.focus();
  }, [canNewer, canOlder]);

  return (
    <nav className={styles.pager} aria-label={`${noun} pages`}>
      <SelectField
        label={sizeLabel}
        value={String(size)}
        options={sizes.map((option) => ({ value: String(option), label: String(option) }))}
        onChange={(value) => onSizeChange(Number(value))}
      />
      <span className={styles.range} role="status" aria-live="polite">
        {position}
      </span>
      <span className={styles.pages}>
        <button
          ref={newerRef}
          type="button"
          className={`${styles.page} ${styles.step}`}
          disabled={!canNewer}
          onFocus={() => {
            focused.current = 'newer';
          }}
          onBlur={() => {
            focused.current = null;
          }}
          onClick={onNewer}
        >
          <Icon glyph={uiIcons.previous} size="sm" />
          Newer
        </button>
        <button
          ref={olderRef}
          type="button"
          className={`${styles.page} ${styles.step}`}
          disabled={!canOlder}
          onFocus={() => {
            focused.current = 'older';
          }}
          onBlur={() => {
            focused.current = null;
          }}
          onClick={onOlder}
        >
          Older
          <Icon glyph={uiIcons.next} size="sm" />
        </button>
      </span>
      {note ? <p className={styles.pageNote}>{note}</p> : null}
    </nav>
  );
}
