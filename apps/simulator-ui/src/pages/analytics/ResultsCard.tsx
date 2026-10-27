import { downloadDocument, downloadName, resultRow } from '../../lib/benchmarkRows';
import { type DownloadHost, downloadText } from '../../lib/eventExport';
import type { BenchmarkRunDetail } from '../../api/types';
import { formatClockTime } from '../../lib/time';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { toneIcons, uiIcons } from '../../ui/icons';
import styles from './analytics.module.css';

export interface ResultsCardProps {
  /** The finished runs of the session, newest first (the last ten the simulator keeps). */
  runs: readonly BenchmarkRunDetail[];
  /** `host:port/name` of the database the runs counted in, for the download; never credentials. */
  database: string | null;
  /** The run whose numbers and charts are on show, or `null` for the run going / the session. */
  shownId: number | null;
  /** Looks at a run; `null` goes back to the run going (or the session). */
  onShow(id: number | null): void;
  /** What a download needs of the browser, so a test can pass its own. */
  host?: DownloadHost;
}

/**
 * The results of the session (frame 09, "results live for the session and can be downloaded"): the last ten runs, newest first, each with its
 * outcome in a word and an icon, its size, the command line's own rates and whether it is a result to compare. **Show** puts the run's
 * numbers and charts on the page; **Download** gives the run as one JSON file (its summary, the `result` exactly as `bench --json` prints
 * it, and the series). A run that was stopped, timed out or failed is listed and downloadable but says it is not comparable.
 */
export function ResultsCard({ runs, database, shownId, onShow, host }: ResultsCardProps) {
  return (
    <Card
      title="Results of this session"
      aside={<Chip>last {runs.length === 0 ? 10 : runs.length}</Chip>}
    >
      {runs.length === 0 ? (
        <p className={styles.empty}>
          No run has finished in this session yet. Results are kept until the simulator is
          restarted.
        </p>
      ) : (
        <ul className={styles.results} aria-label="Finished runs">
          {runs.map((run) => {
            const row = resultRow(run);
            const shown = shownId === run.id;
            return (
              <li key={run.id} className={styles.result} data-shown={shown ? 'true' : undefined}>
                <div className={styles.resultMain}>
                  <strong>{row.title}</strong>
                  <Chip tone={row.outcome.tone} icon={toneIcons[row.outcome.tone]}>
                    {row.outcome.word}
                  </Chip>
                  <Chip tone={row.comparable ? 'ok' : 'neutral'}>{row.comparableWord}</Chip>
                  <span className={styles.resultMeta}>
                    {row.size} · {row.duration} · started{' '}
                    {formatClockTime(Date.parse(row.startedAt))}
                  </span>
                </div>
                {row.rates === null ? null : <div className={styles.resultRates}>{row.rates}</div>}
                {row.reason === null ? null : (
                  <div className={styles.resultReason}>{row.reason}</div>
                )}
                <div className={styles.resultActions}>
                  <Button
                    size="sm"
                    variant={shown ? 'primary' : 'outline'}
                    aria-pressed={shown}
                    aria-label={`Show ${row.title}`}
                    onClick={() => onShow(shown ? null : run.id)}
                  >
                    {shown ? 'Showing' : 'Show'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={uiIcons.download}
                    aria-label={`Download ${row.title} as JSON`}
                    onClick={() =>
                      downloadText(
                        downloadName(run),
                        downloadDocument(run, database),
                        'application/json',
                        host,
                      )
                    }
                  >
                    Download
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
