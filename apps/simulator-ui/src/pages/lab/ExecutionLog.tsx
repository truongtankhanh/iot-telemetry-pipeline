import { LOG_FILTER_LABELS, LOG_FILTERS, type LabCommand, type LogFilter } from '../../lib/labLog';
import { LAB_LOG_SIZE } from '../../lib/labQuery';
import { isoTime, formatClockTime } from '../../lib/time';
import { Pager } from '../../ui/Pager';
import { Segmented } from '../../ui/Segmented';
import styles from './inspector.module.css';
import { useLabLog } from './useLabInspector';

export interface ExecutionLogProps {
  commands: readonly LabCommand[];
  filter: LogFilter;
  /** 1-based; a page past the end is the last one. */
  page: number;
  onFilter: (filter: LogFilter) => void;
  onPage: (page: number) => void;
}

/**
 * What happened to the faults and to the alerts they raised, newest first (frames 12 and 19): the alerts opened, their
 * delivery, the incidents, the runs, the faults added and removed, and what this page sent. Runs of alike rows fold
 * ("6 more alerts, #8 to #13 · Show"), and the rest is paged. A row's time is when Studio saw it, not when it happened.
 */
export function ExecutionLog({ commands, filter, page, onFilter, onPage }: ExecutionLogProps) {
  const { counts, shown, toggleRun } = useLabLog(commands, filter, page);

  return (
    <div className={styles.logBox}>
      <div className={styles.logTools}>
        <Segmented
          label="Show"
          value={filter}
          onChange={(value) => onFilter(value as LogFilter)}
          options={LOG_FILTERS.map((value) => ({
            value,
            label: `${LOG_FILTER_LABELS[value]} ${counts[value]}`,
          }))}
        />
        <span className={styles.faint}>Newest first</span>
      </div>

      {shown.total === 0 ? (
        <p className={styles.empty} role="status">
          Nothing has happened yet. Inject a fault, and what it does appears here.
        </p>
      ) : (
        <ol className={styles.log} aria-label="Execution log">
          {shown.items.map((item) =>
            item.type === 'run' ? (
              <li key={`run:${item.key}`} className={styles.run}>
                <button
                  type="button"
                  className={styles.runButton}
                  aria-expanded="false"
                  onClick={() => toggleRun(item.key)}
                >
                  {item.label} · Show
                </button>
              </li>
            ) : (
              <li key={item.row.key} className={styles.logRow} data-group={item.row.group}>
                <time className={styles.time} dateTime={isoTime(item.row.at)}>
                  {formatClockTime(item.row.at)}
                </time>
                <span>
                  {item.row.event === null
                    ? item.row.message
                    : item.row.event.parts.map((part, index) =>
                        part.strong ? (
                          <b key={index} className={styles.mono}>
                            {part.text}
                          </b>
                        ) : (
                          part.text
                        ),
                      )}
                </span>
              </li>
            ),
          )}
        </ol>
      )}

      {shown.pageCount > 1 ? (
        <div className={styles.paging}>
          <span className={styles.faint} role="status" aria-live="polite">
            Log {shown.from}–{shown.to} of {shown.total}
          </span>
          <Pager
            variant="compact"
            label="Log pages"
            page={shown.page}
            pageSize={LAB_LOG_SIZE}
            total={shown.total}
            sizes={[LAB_LOG_SIZE]}
            onPageChange={onPage}
            onPageSizeChange={() => {}}
          />
        </div>
      ) : null}
    </div>
  );
}
