import { telemetryTopic } from '@itp/telemetry-contract';
import type { StateView } from '../api/types';
import type { AppRoute } from './routes';

export type PaletteGroup =
  'pages' | 'devices' | 'zones' | 'alerts' | 'scenarios' | 'topics' | 'actions';

/** The order of the groups in the palette (frame 17). */
export const GROUP_ORDER: PaletteGroup[] = [
  'pages',
  'devices',
  'zones',
  'alerts',
  'scenarios',
  'topics',
  'actions',
];

export const GROUP_LABELS: Record<PaletteGroup, string> = {
  pages: 'Pages',
  devices: 'Devices',
  zones: 'Zones',
  alerts: 'Alerts',
  scenarios: 'Scenarios',
  topics: 'Topics',
  actions: 'Actions',
};

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** The small text after the label. */
  detail: string | null;
  /** Words that also match and are not shown. */
  keywords: string[];
  /** Where choosing the item goes (a path with the item in the query); `null` for an action. */
  target: string | null;
  /** Alerts only: their severity and whether they are open order the results. */
  severity: string | null;
  open: boolean;
  /** Why the item cannot be chosen, or `null`. */
  disabled: string | null;
}

/**
 * What an action says about itself. The palette never runs a command (a command is given where its effect is in
 * view): choosing an action opens the Overview, with the scenario picked or the control focused, and the person
 * presses the button there.
 */
const ACTION_DETAIL = 'Opens the Overview';

const item = (
  group: PaletteGroup,
  id: string,
  label: string,
  rest: Partial<Omit<PaletteItem, 'group' | 'id' | 'label'>> = {},
): PaletteItem => ({
  group,
  id: `${group}:${id}`,
  label,
  detail: rest.detail ?? null,
  keywords: rest.keywords ?? [],
  target: rest.target ?? null,
  severity: rest.severity ?? null,
  open: rest.open ?? false,
  disabled: rest.disabled ?? null,
});

const query = (path: string, key: string, value: string) =>
  `${path}?${key}=${encodeURIComponent(value)}`;

/**
 * Everything the palette can find, from the lists Studio already holds: it costs no request. The pages
 * not built yet are in it (they open the placeholder), the zones are the zone codes of the devices (the
 * registry has no zone names), the topics are the ones the contract builds for each device, and the actions
 * are listed with where to run them: they do not run from here yet.
 */
export function buildPaletteItems({
  view,
  routes,
}: {
  view: StateView | null;
  routes: AppRoute[];
}): PaletteItem[] {
  const items: PaletteItem[] = routes.map((route) => {
    const parent = route.parent === null ? undefined : routes.find((r) => r.path === route.parent);
    return item('pages', route.path, parent ? `${parent.label} · ${route.label}` : route.label, {
      detail: route.built ? route.description : `Not built yet · ${route.ticket}`,
      keywords: [route.label, route.path],
      target: route.path,
    });
  });
  if (view === null) return items;

  const states = new Map(view.engine.devices.map((device) => [device.id, device.state]));
  const withAnomaly = new Set(view.engine.anomalies.map(({ anomaly }) => anomaly.deviceId));
  for (const device of view.devices) {
    const status = withAnomaly.has(device.id) ? 'anomaly' : (states.get(device.id) ?? 'unknown');
    items.push(
      item('devices', device.id, device.id, {
        detail: [device.name, device.zoneCode, status].filter(Boolean).join(' · '),
        keywords: [device.id, device.name ?? '', device.zoneCode, device.kind],
        target: query('/fleet', 'device', device.id),
      }),
    );
  }

  const zones = new Map<string, number>();
  for (const device of view.devices)
    zones.set(device.zoneCode, (zones.get(device.zoneCode) ?? 0) + 1);
  for (const [code, count] of zones) {
    items.push(
      item('zones', code, code, {
        detail: `${count} ${count === 1 ? 'device' : 'devices'}`,
        keywords: [code],
        target: query('/topology', 'zone', code),
      }),
    );
  }

  for (const alert of view.alerts.alerts) {
    items.push(
      item('alerts', alert.id, `#${alert.id} ${alert.title}`, {
        detail: `${alert.deviceId} · ${alert.severity} · ${alert.status}`,
        keywords: [alert.id, alert.title, alert.deviceId, alert.ruleId, alert.metric],
        target: query('/alerts', 'alert', alert.id),
        severity: alert.severity,
        open: alert.status === 'open',
      }),
    );
  }

  for (const name of view.scenarios) {
    items.push(
      item('scenarios', name, name, {
        keywords: [name, 'scenario'],
        target: query('/lab/scenarios', 'scenario', name),
      }),
    );
  }

  for (const device of view.devices) {
    const topic = telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id });
    items.push(
      item('topics', topic, topic, {
        detail: device.id,
        keywords: [topic, device.id],
        target: query('/events', 'topic', topic),
      }),
    );
  }

  const action = (verb: string, label: string, target: string) =>
    item('actions', verb, label, { detail: ACTION_DETAIL, keywords: [verb], target });
  for (const name of view.scenarios) {
    items.push(action(`run ${name}`, `run ${name}`, query('/', 'scenario', name)));
  }
  items.push(action('pause', 'pause', query('/', 'focus', 'pause')));
  // Step needs the simulated clock; on the wall clock the control is absent, not disabled.
  if (view.config.simulated) items.push(action('step', 'step', query('/', 'focus', 'step')));
  items.push(action('reset', 'reset', query('/', 'focus', 'reset')));

  return items;
}
