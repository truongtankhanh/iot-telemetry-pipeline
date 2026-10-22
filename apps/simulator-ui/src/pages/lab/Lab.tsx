import { useMemo, useRef, useState } from 'react';
import {
  addToDraft,
  type Draft,
  draftAnomalies,
  draftLength,
  draftOverlap,
  draftSummary,
  EMPTY_DRAFT,
} from '../../lib/labDraft';
import { looseAnomalies } from '../../lib/labFault';
import { sanitizeLabQuery } from '../../lib/labQuery';
import { resolveTargets } from '../../lib/labTargets';
import { barProgress, CUSTOM_PICK } from '../../lib/labTimeline';
import { seconds } from '../../lib/scenarioExpectation';
import { formatClockTime } from '../../lib/time';
import { LabSwitcher } from '../../shell/LabSwitcher';
import { useNow } from '../../state/useNow';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import { useFleetRows } from '../fleet/useFleetRows';
import { useSimulationControls } from '../overview/useSimulationControls';
import type { CommandNotice } from '../scenarios/useScenarioCommands';
import { ActiveFaults } from './ActiveFaults';
import { ConfigurationPanel } from './ConfigurationPanel';
import { ImpactStrip } from './ImpactStrip';
import { Inspector } from './Inspector';
import { LabBar } from './LabBar';
import { LabCanvas } from './LabCanvas';
import styles from './lab.module.css';
import { TimelineDock } from './TimelineDock';
import { useExpectedImpact } from './useExpectedImpact';
import { useInjection } from './useInjection';
import { useLabFault } from './useLabFault';
import { useLabParams } from './useLabParams';

/**
 * The Simulation lab (frames 12 and 19): configure a fault on the left, watch the pipeline in the middle, follow what it
 * did on the right, with the timeline under all three. The workspace is bounded to the viewport: a zone that has more
 * than fits scrolls inside itself, so scrolling a long list of zones never moves the pipeline or the dock. The
 * Lab's other pages (Scenarios, Timeline, Faults) are reached from the switch above it.
 *
 * This component holds the page's state and hands each zone what it draws: the address (targets, scope), the form's
 * fault (`useLabFault`), the draft of the timeline (page state, decision D4), what is being sent (`useInjection`) and
 * what the simulator says the rules will do (`useExpectedImpact`). The zones are components of their own.
 */
export function Lab() {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const now = useNow();
  const rows = useFleetRows(view, now);

  const [rawQuery, update] = useLabParams();
  const devices = useMemo(() => rows.map((row) => row.device), [rows]);
  const query = useMemo(() => sanitizeLabQuery(rawQuery, devices), [rawQuery, devices]);
  const reached = useMemo(
    () => resolveTargets(devices, query.scope, query.targets),
    [devices, query.scope, query.targets],
  );
  const targetIds = useMemo(() => new Set(reached.map((device) => device.id)), [reached]);

  const fault = useLabFault(reached);
  // The inspector follows the devices the fault reaches; before there is a metric it follows every one chosen.
  const inspectIds = useMemo(
    () =>
      fault.plan.deviceIds.length > 0 ? fault.plan.deviceIds : reached.map((device) => device.id),
    [fault.plan.deviceIds, reached],
  );
  const injection = useInjection();
  const impact = useExpectedImpact(fault.plan.anomalies);
  const controls = useSimulationControls();

  // What the bar and the dock follow: the page's own timeline ("Custom fault") or a scenario of the library.
  const [pick, setPick] = useState(CUSTOM_PICK);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftNotice, setDraftNotice] = useState<CommandNotice | null>(null);
  const draftKeys = useRef(0);

  const addToTimeline = () => {
    const result = addToDraft(draft, fault.plan.anomalies, () => `entry-${++draftKeys.current}`);
    if (result.ok) {
      setDraft(result.draft);
      const n = fault.plan.anomalies.length;
      setDraftNotice({
        tone: 'ok',
        text: `Added ${n} ${n === 1 ? 'fault' : 'faults'} to the timeline (${draftAnomalies(result.draft).length} in all).`,
      });
    } else {
      setDraftNotice({ tone: 'bad', text: result.reason });
    }
  };

  const scenarioItem =
    pick === CUSTOM_PICK
      ? undefined
      : controls.library.library?.scenarios.find((candidate) => candidate.name === pick);
  const custom = scenarioItem === undefined;
  const timeline = useMemo(() => draftAnomalies(draft), [draft]);
  // The fault being configured is drawn on the timeline as an outline, unless it would play over one already on it.
  const pending = useMemo(
    () => (draftOverlap(timeline, fault.plan.anomalies) === null ? fault.plan.anomalies : []),
    [timeline, fault.plan.anomalies],
  );
  const dockQuestion = useMemo(
    () => (custom ? [...timeline, ...pending] : []),
    [custom, timeline, pending],
  );
  const dockImpact = useExpectedImpact(dockQuestion);

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

  if (view === null) {
    return (
      <div className={styles.lab}>
        <LabSwitcher />
        <div className={styles.bar}>
          <h1 className={styles.title}>Simulation lab</h1>
          {status}
        </div>
        <Card title="Simulation lab">
          <p className={styles.waiting} role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </div>
    );
  }

  if (view.devices.length === 0) {
    return (
      <div className={styles.lab}>
        <LabSwitcher />
        <div className={styles.bar}>
          <h1 className={styles.title}>Simulation lab</h1>
          {status}
        </div>
        <Card title="No devices">
          <p className={styles.waiting}>
            The simulator plays no device, so there is nothing to inject a fault into.
          </p>
        </Card>
      </div>
    );
  }

  const notice = injection.notice ?? draftNotice;
  const loose = looseAnomalies(view.engine, view.runs);
  const playing =
    view.runs.length > 0 ||
    loose.some(({ anomaly }) => anomaly.startAt + anomaly.duration > view.engine.elapsedS);
  const barModel = barProgress({
    pick: custom ? CUSTOM_PICK : pick,
    item: scenarioItem,
    runs: view.runs,
    engine: view.engine,
    now,
    draftS: draftLength(draft),
    injectedBaseS: injection.injectedBaseS,
  });
  const dockExpected = custom
    ? (dockImpact.preview?.expected ?? null)
    : (scenarioItem?.expected ?? null);
  const { progress } = injection;
  const expectedAlerts =
    impact.preview?.expected.available === true ? impact.preview.expected.alerts : null;

  return (
    <div className={styles.lab} data-stale={link === 'lost' ? 'true' : undefined}>
      <LabSwitcher />
      <LabBar
        controls={controls}
        pick={custom ? CUSTOM_PICK : pick}
        onPick={setPick}
        progress={barModel}
        playing={playing}
        status={status}
        intervalMs={view.config.intervalMs}
      />

      {progress.running ? (
        <div className={styles.notice} role="status">
          <span className={styles.noticeText}>
            {progress.label} {progress.done} of {progress.total}…
          </span>
          <Button size="sm" variant="ghost" onClick={injection.cancel}>
            Stop sending
          </Button>
        </div>
      ) : notice === null ? null : (
        <div
          className={styles.notice}
          data-tone={notice.tone}
          role={notice.tone === 'bad' ? 'alert' : 'status'}
        >
          <Icon glyph={notice.tone === 'bad' ? toneIcons.bad : toneIcons.ok} size="sm" />
          <span className={styles.noticeText}>{notice.text}</span>
          {injection.partial === null ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void injection.remove(injection.partial?.ids ?? [])}
            >
              Remove these {injection.partial.ok}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              injection.dismissNotice();
              setDraftNotice(null);
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className={styles.workspace}>
        <aside className={`${styles.zone} ${styles.left}`} aria-label="Scenario configuration">
          <ConfigurationPanel
            rows={rows}
            scope={query.scope}
            targets={query.targets}
            reached={reached}
            onScope={(scope) => update({ scope, targets: [], zone: null })}
            onTargets={(targets) => update({ targets })}
            draft={fault.draft}
            plan={fault.plan}
            onDraft={fault.patch}
            expectedAlerts={expectedAlerts}
            busy={progress.running}
            onAdd={addToTimeline}
            onInject={() => void injection.injectNow(fault.plan.anomalies)}
          />
        </aside>
        <div className={`${styles.zone} ${styles.center}`}>
          <LabCanvas
            now={now}
            targets={targetIds}
            zone={query.zone}
            tab={query.tab}
            page={query.page}
            onZone={(zone) => update({ zone, tab: 'all', page: 1 })}
            onTab={(tab) => update({ tab, page: 1 })}
            onPage={(page) => update({ page })}
          />
          <ImpactStrip impact={impact} sink={view.ingest.alertSink} />
          <ActiveFaults
            faults={loose}
            elapsedS={view.engine.elapsedS}
            busy={progress.running}
            onRemove={(ids) => void injection.remove(ids)}
          />
        </div>
        <aside className={`${styles.zone} ${styles.right}`} aria-label="Execution inspector">
          <Inspector
            commands={injection.commands}
            logFilter={query.log}
            logPage={query.logPage}
            onLogFilter={(log) => update({ log, logPage: 1 })}
            onLogPage={(logPage) => update({ logPage })}
            targetIds={inspectIds}
          />
        </aside>
      </div>

      <TimelineDock
        anomalies={custom ? timeline : (scenarioItem?.anomalies ?? [])}
        pending={custom ? pending : []}
        expected={dockExpected}
        devices={devices}
        rules={view.rules}
        grouped={devices.length > 60}
        elapsedS={barModel.aligned ? barModel.elapsedS : null}
        summary={
          custom
            ? draftSummary(draft)
            : `${scenarioItem?.anomalies.length ?? 0} anomalies · ${seconds(scenarioItem?.lengthS ?? 0)}`
        }
        scenario={custom ? null : pick}
        busy={progress.running}
        onInject={() => void injection.injectTimeline(timeline)}
        onClear={() => setDraft(EMPTY_DRAFT)}
      />
    </div>
  );
}
