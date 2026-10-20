import type { StateView } from '../../api/types';
import { CARDS_PER_PAGE, type FleetRow, groupByZone, paginate } from '../../lib/fleetQuery';
import { Pager } from '../../ui/Pager';
import { DeviceCard } from './DeviceCard';
import styles from './deviceCard.module.css';
import type { DeviceCommands } from './useDeviceCommands';

export interface DeviceCardsProps {
  /** Every device that passes the filters, sorted; this component takes the page. */
  rows: readonly FleetRow[];
  page: number;
  onPageChange: (page: number) => void;
  group: boolean;
  view: StateView;
  now: number;
  openId: string | null;
  commands: DeviceCommands;
  onOpen: (deviceId: string) => void;
}

/** The cards, 12 to a page, optionally under a heading per zone. */
export function DeviceCards({
  rows,
  page,
  onPageChange,
  group,
  view,
  now,
  openId,
  commands,
  onOpen,
}: DeviceCardsProps) {
  const current = paginate(rows, page, CARDS_PER_PAGE);
  const engineById = new Map(view.engine.devices.map((d) => [d.id, d]));

  const card = (row: FleetRow, headingLevel: 3 | 4) => (
    <li key={row.device.id}>
      <DeviceCard
        row={row}
        engineDevice={engineById.get(row.device.id)}
        rules={view.rules}
        now={now}
        selected={openId === row.device.id}
        commands={commands}
        onOpen={onOpen}
        headingLevel={headingLevel}
      />
    </li>
  );

  return (
    <section aria-labelledby="fleet-devices-heading">
      <h2 id="fleet-devices-heading" className="visually-hidden">
        Devices
      </h2>
      {group ? (
        groupByZone(current.items).map(({ zone, rows: inZone }) => (
          <section key={zone} className={styles.zone} aria-label={`Zone ${zone}`}>
            <h3 className={styles.zoneName}>
              {zone} <span className={styles.zoneCount}>{inZone.length}</span>
            </h3>
            <ul className={styles.grid}>{inZone.map((row) => card(row, 4))}</ul>
          </section>
        ))
      ) : (
        <ul className={styles.grid}>{current.items.map((row) => card(row, 3))}</ul>
      )}
      <Pager
        page={current.page}
        pageSize={CARDS_PER_PAGE}
        total={rows.length}
        sizes={[CARDS_PER_PAGE]}
        noun="Devices"
        sizeLabel="Cards per page"
        onPageChange={onPageChange}
        onPageSizeChange={() => {}}
      />
    </section>
  );
}
