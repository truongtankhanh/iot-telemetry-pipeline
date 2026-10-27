import { useMemo } from 'react';
import type { FaultKind } from '../../api/types';
import { faultEffect } from '../../lib/faultEffect';
import {
  activeSentence,
  checkDraft,
  DEFAULT_DRAFTS,
  type FaultDrafts,
  hasErrors,
  isFaultOn,
} from '../../lib/faultSettings';
import { formatClockTime } from '../../lib/time';
import { LabSwitcher } from '../../shell/LabSwitcher';
import { useBenchmarkLock } from '../../state/useBenchmarkLock';
import { useNow } from '../../state/useNow';
import { useStudio } from '../../state/studioContext';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { PageHeader } from '../../ui/PageHeader';
import { uiIcons } from '../../ui/icons';
import { useFleetRows } from '../fleet/useFleetRows';
import { EffectPanel } from './EffectPanel';
import { FaultList } from './FaultList';
import { ScopeRow } from './ScopeRow';
import styles from './faults.module.css';
import { useFaultCommands } from './useFaultCommands';
import { useFaultDrafts } from './useFaultDrafts';

const PAGE_DESCRIPTION =
  'Make the transport misbehave and watch the pipeline count it. Loss is bounded and measured, not hidden (ADR-0002).';

/**
 * The Faults page (frame 07), the Lab's page for making the transport misbehave and watching the pipeline count it. It holds
 * no fault of its own: the engine does (`engine.faults` of the state), so the page is right after a reload and in a second
 * tab, and a switch is on when the engine says so. What it holds is the drafts of the values being edited.
 *
 * This component holds the page's hooks and hands each part what it draws: the drafts (`useFaultDrafts`), the commands
 * (`useFaultCommands`) and the effect of the faults on ingest's counters (`faultEffect`). The parts are components of their own.
 */
export function Faults() {
  const view = useStudio((state) => state.view);
  // A benchmark is running: the simulator refuses Clear all faults, which also releases held messages (Reset counters stays open).
  const lock = useBenchmarkLock();
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const now = useNow();
  const rows = useFleetRows(view, now);
  const faults = view?.engine.faults ?? null;
  const effect = view?.faultEffect ?? null;
  const metrics = view?.metrics ?? null;

  const { drafts, setDraft, reset } = useFaultDrafts(faults);
  const commands = useFaultCommands(faults);
  const model = useMemo(
    () => (faults === null || metrics === null ? null : faultEffect({ faults, effect, metrics })),
    [faults, effect, metrics],
  );

  const stale = link === 'lost';
  const status = stale ? (
    <Chip tone="bad">{lostSince === null ? 'Lost' : `Lost at ${formatClockTime(lostSince)}`}</Chip>
  ) : link === 'live' ? (
    <Chip tone="ok">Connected</Chip>
  ) : (
    <Chip>Connecting</Chip>
  );

  if (view === null || faults === null || model === null) {
    return (
      <div className={styles.page}>
        <LabSwitcher />
        <PageHeader title="Faults" description={PAGE_DESCRIPTION}>
          {status}
        </PageHeader>
        <Card title="Faults">
          <p className={styles.faint} role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </div>
    );
  }

  // A fault is switched on with the values in its controls, or the defaults when those would be refused (an emptied field).
  const onSwitch = async (kind: FaultKind, on: boolean) => {
    if (!on) {
      await commands.turnOff(kind);
      return;
    }
    const draft = hasErrors(checkDraft(kind, drafts[kind])) ? DEFAULT_DRAFTS[kind] : drafts[kind];
    setDraft(kind, draft);
    if (!(await commands.apply(kind, draft))) reset(kind);
  };

  // A value that is done is sent when the fault is on and the value is one the simulator takes; if it refuses, the control goes back.
  const onCommit = async <K extends FaultKind>(kind: K, draft: FaultDrafts[K]) => {
    setDraft(kind, draft);
    if (!isFaultOn(kind, faults) || hasErrors(checkDraft(kind, draft))) return;
    if (!(await commands.apply(kind, draft))) reset(kind);
  };

  const { notice, errors, busy } = commands;

  return (
    <div className={styles.page} data-stale={stale ? 'true' : undefined}>
      <LabSwitcher />
      <PageHeader title="Faults" description={PAGE_DESCRIPTION}>
        <div className={styles.actions}>
          {status}
          <Button
            variant="ghost"
            icon={uiIcons.reset}
            disabled={stale || busy.has('effect')}
            onClick={() => void commands.resetEffect()}
          >
            Reset counters
          </Button>
          <Button
            variant="danger"
            disabled={stale || busy.has('clear') || lock.locked}
            onClick={() => void commands.clearAll()}
          >
            Clear all faults
          </Button>
        </div>
      </PageHeader>

      {stale ? (
        <Banner tone="warn">
          The link to the simulator is lost. Nothing can be changed until it is back; what is shown
          is the last known state.
        </Banner>
      ) : null}
      {faults.activeCount > 0 ? (
        <Banner tone="warn">
          <strong>{activeSentence(faults)}.</strong> Readings in the database and alerts may differ
          from what the devices intended until you clear them.
        </Banner>
      ) : null}
      {notice ? (
        <Banner tone={notice.tone === 'ok' ? 'info' : 'warn'}>
          {notice.text}{' '}
          <Button variant="ghost" size="sm" onClick={commands.dismissNotice}>
            Dismiss
          </Button>
        </Banner>
      ) : null}
      {errors.clear ? (
        <p className={styles.error} role="alert">
          Clear all faults: {errors.clear}
        </p>
      ) : null}
      {errors.effect ? (
        <p className={styles.error} role="alert">
          Reset counters: {errors.effect}
        </p>
      ) : null}

      <ScopeRow
        faults={faults}
        rows={rows}
        busy={busy.has('scope')}
        error={errors.scope}
        disabled={stale}
        onScope={(scope) => void commands.setScope(scope)}
      />

      <div className={styles.cols}>
        <FaultList
          faults={faults}
          drafts={drafts}
          busy={busy}
          errors={errors}
          disabled={stale}
          onSwitch={(kind, on) => void onSwitch(kind, on)}
          onDraft={setDraft}
          onCommit={(kind, draft) => void onCommit(kind, draft)}
          onBurst={() => void commands.burst()}
        />
        <EffectPanel model={model} now={now} />
      </div>
    </div>
  );
}
