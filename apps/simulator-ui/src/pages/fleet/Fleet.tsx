import { useState } from 'react';
import { holdValue, pauseDevice, startDevice, stopDevice } from '../../api/client';
import type { StateView } from '../../api/types';
import { BULK_CONFIRM_ABOVE, BULK_WORDS, type BulkAction } from '../../lib/bulk';
import {
  applyFleetQuery,
  cardsAllowed,
  effectiveView,
  facets,
  FLEET_TABS,
  type FleetQuery,
  paginate,
  pruneSelection,
} from '../../lib/fleetQuery';
import { formatClockTime } from '../../lib/time';
import { useStudio } from '../../state/studioContext';
import { useNow } from '../../state/useNow';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { PageHeader } from '../../ui/PageHeader';
import { tabId } from '../../ui/tabId';
import { Tabs } from '../../ui/Tabs';
import { uiIcons } from '../../ui/icons';
import { BulkBar } from './BulkBar';
import { BulkStatus, type PendingBulk } from './BulkStatus';
import { DeviceCards } from './DeviceCards';
import { FleetKpis } from './FleetKpis';
import { FleetTable } from './FleetTable';
import { FleetToolbar } from './FleetToolbar';
import { HoldDialog } from './HoldDialog';
import { Inspector } from './Inspector';
import styles from './fleet.module.css';
import { useBulkRun } from './useBulkRun';
import { useDeviceCommands } from './useDeviceCommands';
import { useFleetParams } from './useFleetParams';
import { useFleetRows } from './useFleetRows';

const TAB_LABELS: Record<(typeof FLEET_TABS)[number], string> = {
  all: 'All',
  running: 'Running',
  anomaly: 'Anomaly',
  paused: 'Paused',
  stopped: 'Stopped',
  silent: 'Silent',
};

const ACTIONS: Record<BulkAction, (id: string) => Promise<StateView>> = {
  pause: (id) => pauseDevice(id),
  start: (id) => startDevice(id),
  stop: (id) => stopDevice(id),
};

const TABS_PREFIX = 'fleet-state';
const PANEL_ID = 'fleet-panel';

/**
 * The Fleet (frames 01, 02 and 18): every device, its live values and its controls. Up to 12 devices it is cards;
 * above, or on request, a table. What is filtered, sorted and paged, and which device is open, is in the address.
 * The cards and the table share the state tabs, the toolbar and the KPIs above them; the inspector and the hold
 * dialog are sheets over the page. It reads the store and the history; it keeps no copy of either.
 */
export function Fleet() {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const publishRate = useStudio((state) => state.publishRate);
  const now = useNow();
  const [query, update] = useFleetParams();
  const rows = useFleetRows(view, now);
  const commands = useDeviceCommands();
  const bulk = useBulkRun();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);

  const devices = view?.devices ?? [];
  const result = applyFleetQuery(rows, query);
  const shown = effectiveView(query, devices.length);
  const filteredIds = result.rows.map((row) => row.device.id);
  // A device that left the filter cannot stay selected: a bulk command would act on what nobody can see.
  const selection = pruneSelection(selected, filteredIds);
  const pageIds = paginate(result.rows, query.page, query.size).items.map((row) => row.device.id);
  const openRow =
    query.device === null ? undefined : rows.find((row) => row.device.id === query.device);
  const { zones, kinds } = facets(devices);

  const openDevice = (deviceId: string) =>
    update({ device: deviceId }, { replace: false, keepPage: true });
  const closeInspector = () => update({ device: null }, { keepPage: true });
  const clearFilters = () => update({ q: '', zone: null, kind: null, tab: 'all' });
  const changeQuery = (patch: Partial<FleetQuery>) => update(patch);

  const startBulk = (action: BulkAction, ids: string[]) => {
    setPending(null);
    void bulk.run(ids, BULK_WORDS[action].doing, ACTIONS[action]);
  };
  const requestBulk = (action: BulkAction, ids: string[]) => {
    if (ids.length === 0 || bulk.state.running) return;
    if (ids.length > BULK_CONFIRM_ABOVE) setPending({ action, ids });
    else startBulk(action, ids);
  };
  const holdOnSelected = (metric: string, value: number, ids: string[]) => {
    void bulk.run(ids, `Holding ${metric} at ${value}`, (id) => holdValue(id, metric, value));
  };

  const allIds = devices.map((device) => device.id);
  const description =
    view === null
      ? 'Every device the simulator plays, its live values and per-device control.'
      : `${devices.length} ${devices.length === 1 ? 'device' : 'devices'} from the registry, each publishing every ${view.config.intervalMs / 1000} s on its own topic.`;

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
      <>
        <PageHeader title="Device fleet" description={description}>
          {status}
        </PageHeader>
        <Card title="Devices">
          <p role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </>
    );
  }

  return (
    <div className={styles.page} data-stale={link === 'lost' ? 'true' : undefined}>
      <PageHeader title="Device fleet" description={description}>
        {status}
      </PageHeader>

      <div className={styles.statebar}>
        <Tabs
          label="State"
          idPrefix={TABS_PREFIX}
          panelId={PANEL_ID}
          value={query.tab}
          onChange={(tab) => update({ tab: tab as FleetQuery['tab'] })}
          tabs={FLEET_TABS.map((id) => ({ id, label: TAB_LABELS[id], count: result.counts[id] }))}
        />
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.pause}
            disabled={bulk.state.running || allIds.length === 0}
            onClick={() => requestBulk('pause', allIds)}
          >
            Pause all
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.play}
            disabled={bulk.state.running || allIds.length === 0}
            onClick={() => requestBulk('start', allIds)}
          >
            Start all
          </Button>
        </div>
      </div>

      <FleetKpis view={view} publishRate={publishRate} now={now} />

      <FleetToolbar
        query={query}
        zones={zones}
        kinds={kinds}
        view={shown}
        cardsAllowed={cardsAllowed(devices.length)}
        onChange={changeQuery}
      />

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={tabId(TABS_PREFIX, query.tab)}
        className={styles.content}
      >
        {query.device !== null && !openRow ? (
          <div className={styles.notice} role="status">
            <span>
              No device is named <code>{query.device}</code>.
            </span>
            <Button size="sm" variant="ghost" onClick={closeInspector}>
              Dismiss
            </Button>
          </div>
        ) : null}

        {shown === 'table' ? (
          <BulkBar
            selectedCount={selection.size}
            onPageCount={pageIds.filter((id) => selection.has(id)).length}
            filteredTotal={filteredIds.length}
            busy={bulk.state.running}
            onRun={(action) => requestBulk(action, [...selection])}
            onHold={() => setHoldOpen(true)}
            onSelectAll={() => setSelected(new Set(filteredIds))}
            onClear={() => setSelected(new Set())}
          />
        ) : null}

        <BulkStatus
          pending={pending}
          onConfirm={() => pending && startBulk(pending.action, pending.ids)}
          onCancelConfirm={() => setPending(null)}
          state={bulk.state}
          onCancelRun={bulk.cancel}
          onDismiss={bulk.dismiss}
        />

        {devices.length === 0 ? (
          <div className={styles.empty}>
            The registry has no devices, so there is nothing to play.
          </div>
        ) : result.rows.length === 0 ? (
          <div className={styles.empty}>
            <span>No device matches the search and filters.</span>
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear the filters
            </Button>
          </div>
        ) : shown === 'cards' ? (
          <DeviceCards
            rows={result.rows}
            page={query.page}
            onPageChange={(page) => update({ page })}
            group={query.group}
            view={view}
            now={now}
            openId={query.device}
            commands={commands}
            onOpen={openDevice}
          />
        ) : (
          <FleetTable
            result={result}
            query={query}
            now={now}
            selected={selection}
            openId={query.device}
            onQueryChange={changeQuery}
            onSelectedChange={setSelected}
            onOpen={openDevice}
          />
        )}
      </div>

      {openRow ? (
        <Inspector
          key={openRow.device.id}
          row={openRow}
          engineDevice={view.engine.devices.find((d) => d.id === openRow.device.id)}
          view={view}
          now={now}
          commands={commands}
          onClose={closeInspector}
        />
      ) : null}

      {holdOpen ? (
        <HoldDialog
          rows={result.rows.filter((row) => selection.has(row.device.id))}
          onHold={holdOnSelected}
          onClose={() => setHoldOpen(false)}
        />
      ) : null}
    </div>
  );
}
