import { useCallback, useMemo, useState } from 'react';
import type { DeviceInfo, RulesView, ScenarioItem } from '../../api/types';
import { paginate } from '../../lib/fleetQuery';
import { SCENARIO_SIZES, type ScenarioSortKey } from '../../lib/scenarioQuery';
import { applyScenarioQuery, pageOfScenario } from '../../lib/scenarioRows';
import { formatClockTime } from '../../lib/time';
import { LabSwitcher } from '../../shell/LabSwitcher';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Pager } from '../../ui/Pager';
import { tabId } from '../../ui/tabId';
import { DeleteDialog } from './DeleteDialog';
import { NewScenarioCard } from './NewScenarioCard';
import { ReplaceDialog } from './ReplaceDialog';
import { ScenarioCard } from './ScenarioCard';
import styles from './scenarios.module.css';
import { PANEL_ID, ScenariosToolbar, TABS_PREFIX } from './ScenariosToolbar';
import { useScenarioCommands } from './useScenarioCommands';
import { useScenarioLibrary } from './useScenarioLibrary';
import { useScenariosParams } from './useScenariosParams';

const NO_ITEMS: readonly ScenarioItem[] = [];
const NO_DEVICES: readonly DeviceInfo[] = [];
const RULES_UNKNOWN: RulesView = {
  available: false,
  reason: 'The simulator has not sent its rules yet',
  items: [],
};

/** What the cards are ordered by, said after the pager's range ("Scenarios 1–6 of 38, recently run first"). */
const SORT_NOTES: Record<ScenarioSortKey, string> = {
  recent: 'recently run first',
  name: 'by name',
  duration: 'longest first',
};

/**
 * The Scenarios (frame 03), the Lab's library: every scenario the simulator can play as a card that says what it does
 * to the rules before it is run, with Run and Stop. The simulator sends the whole library and this page searches,
 * sorts and pages it; what is searched, which tab, how it is sorted, the page and its size, and the scenario a link
 * points at are in the address. It reads the store for the state and the library read for the cards, and keeps
 * no copy of either.
 *
 * Running a scenario over something that is already playing on its devices is asked about first (the simulator says what
 * is in the way). Importing is a file picker; a scenario the simulator refuses is told with its reason. Each card also leads
 * to the editor (Edit, Duplicate), exports its JSON and, for a custom scenario that is not playing, deletes it after asking; the
 * dashed card that ends the list starts a new scenario.
 */
export function Scenarios() {
  const hasView = useStudio((state) => state.view !== null);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const rules = useStudio((state) => state.view?.rules) ?? RULES_UNKNOWN;
  const devices = useStudio((state) => state.view?.devices) ?? NO_DEVICES;

  const [query, update] = useScenariosParams();
  const library = useScenarioLibrary();
  const onImported = useCallback(
    (name: string) => update({ scenario: name, tab: 'all', q: '' }),
    [update],
  );
  const commands = useScenarioCommands({ onChanged: library.refresh, onImported });
  // The custom scenario the person asked to delete, until they confirm or cancel.
  const [deleting, setDeleting] = useState<string | null>(null);

  const items = library.library?.scenarios ?? NO_ITEMS;
  const result = useMemo(() => applyScenarioQuery(items, query), [items, query]);

  // A link that points at a scenario shows the page it is on, whatever page the address says.
  const pointed = query.scenario;
  const pointedPage = pointed === null ? null : pageOfScenario(result.rows, pointed, query.size);
  const page = paginate(result.rows, pointedPage ?? query.page, query.size);
  const loaded = library.library !== null;
  // What a link points at is judged against a library that is up to date: after an import the new scenario is on its
  // way, and "no such scenario" must not flash while it is.
  const settled = loaded && library.status === 'ready';
  const pointedInLibrary = pointed !== null && items.some((item) => item.name === pointed);

  const status =
    link === 'lost' ? (
      <Chip tone="bad">
        {lostSince === null ? 'Lost' : `Lost at ${formatClockTime(lostSince)}`}
      </Chip>
    ) : link === 'live' ? (
      <Chip tone="ok">Connected</Chip>
    ) : (
      <Chip>Connecting</Chip>
    );

  const header = (
    <>
      <LabSwitcher />
      <PageHeader
        title="Scenarios"
        description="A scenario is a script of anomalies. Studio reads the rules and tells you which alerts it should raise, and when, before you run it. Times count in seconds from the start of the scenario."
      >
        {status}
      </PageHeader>
    </>
  );

  if (!hasView) {
    return (
      <div className={styles.page}>
        {header}
        <Card title="Scenarios">
          <p role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </div>
    );
  }

  const rejected = library.library?.rejected ?? [];
  const notice = commands.notice;

  return (
    <div className={styles.page} data-stale={link === 'lost' ? 'true' : undefined}>
      {header}

      {notice === null ? null : (
        <div
          className={styles.status}
          data-tone={notice.tone}
          role={notice.tone === 'bad' ? 'alert' : 'status'}
        >
          <Icon glyph={notice.tone === 'bad' ? toneIcons.bad : toneIcons.ok} size="sm" />
          <span className={styles.statusText}>{notice.text}</span>
          <Button size="sm" variant="ghost" onClick={commands.dismissNotice}>
            Dismiss
          </Button>
        </div>
      )}

      {library.status === 'error' ? (
        <div className={styles.error} role="alert">
          <span className={styles.statusText}>
            <b>The scenarios could not be read.</b> {library.error}
          </span>
          <Button size="sm" variant="outline" onClick={library.refresh}>
            Try again
          </Button>
        </div>
      ) : null}

      {rejected.length === 0 ? null : (
        <details className={styles.rejected}>
          <summary>
            {rejected.length} {rejected.length === 1 ? 'scenario file was' : 'scenario files were'}{' '}
            not used
          </summary>
          <ul>
            {rejected.map((entry) => (
              <li key={`${entry.file}:${entry.reason}`}>
                <code className={styles.mono}>{entry.file}</code>: {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ScenariosToolbar
        query={query}
        counts={result.counts}
        onChange={update}
        importing={commands.importing}
        onImportFile={(file) => void commands.importFile(file)}
      />

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={tabId(TABS_PREFIX, query.tab)}
        className={styles.content}
      >
        {settled && pointed !== null && !pointedInLibrary ? (
          <div className={styles.notice} role="status">
            <span className={styles.statusText}>
              No scenario is named <code className={styles.mono}>{pointed}</code>.
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => update({ scenario: null, page: query.page })}
            >
              Dismiss
            </Button>
          </div>
        ) : null}

        {settled && pointed !== null && pointedInLibrary && pointedPage === null ? (
          <div className={styles.notice} role="status">
            <span className={styles.statusText}>
              <code className={styles.mono}>{pointed}</code> is not in this list.
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => update({ scenario: pointed, tab: 'all', q: '' })}
            >
              Show it
            </Button>
          </div>
        ) : null}

        {!loaded ? (
          library.status === 'error' ? null : (
            <p role="status">Loading scenarios…</p>
          )
        ) : items.length === 0 ? (
          <div className={styles.empty} role="status">
            The library is empty: no scenario could be read.
            <NewScenarioCard />
          </div>
        ) : result.rows.length === 0 ? (
          <div className={styles.empty} role="status">
            <span>No scenario matches.</span>
            <Button size="sm" variant="outline" onClick={() => update({ q: '', tab: 'all' })}>
              Clear the search and the tab
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.grid} aria-busy={library.status === 'loading' || undefined}>
              {page.items.map((item) => (
                <ScenarioCard
                  key={item.name}
                  item={item}
                  rules={rules}
                  devices={devices}
                  selected={item.name === pointed}
                  commands={commands}
                  onDelete={setDeleting}
                />
              ))}
              {page.page >= page.pageCount ? <NewScenarioCard /> : null}
            </div>
            <Pager
              page={page.page}
              pageSize={query.size}
              total={result.rows.length}
              sizes={SCENARIO_SIZES}
              noun="Scenarios"
              sizeLabel="Cards per page"
              rangeNote={SORT_NOTES[query.sort]}
              announce
              onPageChange={(next) => update({ page: next })}
              onPageSizeChange={(size) => update({ size })}
            />
          </>
        )}
      </div>

      {commands.pending === null ? null : (
        <ReplaceDialog
          pending={commands.pending}
          busy={commands.isBusy(commands.pending.name, 'run')}
          onConfirm={() => void commands.confirmReplace()}
          onCancel={commands.cancelReplace}
        />
      )}

      {deleting === null ? null : (
        <DeleteDialog
          name={deleting}
          busy={commands.isBusy(deleting, 'delete')}
          returnLabel={`Delete ${deleting}`}
          onConfirm={() => void commands.remove(deleting).then(() => setDeleting(null))}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
