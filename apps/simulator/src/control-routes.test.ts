import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AlertObserver, type IngestAlert } from './alert-observer.ts';
import { BrokerLink } from './broker-link.ts';
import { systemClock } from './clock.ts';
import {
  buildStateView,
  createRoutes,
  type ExpectationPreview,
  type PagedAlert,
  PREVIEW_MAX_ANOMALIES,
  type RouteResponse,
  type RoutesContext,
  type StateView,
} from './control-routes.ts';
import { FaultEffect } from './fault-effect.ts';
import type { LinkControl } from './faults.ts';
import {
  type AlertsPage,
  type AlertsPageQuery,
  IngestReadError,
  type MetricsFeed,
} from './ingest-poller.ts';
import {
  type ObservationDraft,
  type ObservationKind,
  ObservationStore,
} from './observation-store.ts';
import { type RulesView, rulesUnavailable } from './rules-source.ts';
import type { ScenarioDocument } from './scenario-document.ts';
import { loadScenarioFolder, ScenarioLibrary } from './scenario-library.ts';
import { ScenarioRuns } from './scenario-runs.ts';
import { FolderScenarioStore, type ScenarioStore, serializeScenario } from './scenario-store.ts';
import type { DeviceSpec } from './signals.ts';
import { DEVICES, setupEngine, T0 } from './test-support.ts';

const OVERHEAT: ScenarioDocument = {
  name: 'overheat',
  description: 'Row A runs hot.',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
  ],
};
const BOTH: ScenarioDocument = {
  name: 'both',
  description: 'Two things go wrong.',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29, startAt: 20, duration: 60 },
    { deviceId: 'lib-air-01', metric: 'co2_ppm', value: 1450, startAt: 10, duration: 30 },
  ],
};
/** Valid for the registry the library is given, but its second device is not in the engine. */
const BROKEN: ScenarioDocument = {
  name: 'broken',
  description: 'Names a device the engine lacks.',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29, startAt: 20, duration: 60 },
    { deviceId: 'ghost-01', metric: 'temperature_c', value: 1, startAt: 0, duration: 5 },
  ],
};
const GHOST: DeviceSpec = {
  id: 'ghost-01',
  kind: 'server_room',
  zoneCode: 'BLD-DC',
  metrics: ['temperature_c'],
};

const RULES: RulesView = {
  available: true,
  reason: null,
  items: [
    {
      id: 'server-room-hot',
      kind: 'server_room',
      metric: 'temperature_c',
      direction: 'above',
      raise: 27,
      clear: 25.5,
      for: 3,
      severity: 'high',
      title: 'Server room temperature high',
    },
  ],
};

const INGEST = {
  state: () => ({
    status: 'ready' as const,
    database: 'up',
    broker: 'up',
    alertSink: 'none',
    detail: null,
    since: '2026-10-01T05:00:00.000Z',
    lastCheckedAt: '2026-10-01T05:00:01.000Z',
  }),
  alerts: () => ({ alerts: [], lastOkAt: '2026-10-01T05:00:01.000Z', stale: false }),
  metrics: () => ({ samples: [], lastOkAt: '2026-10-01T05:00:01.000Z', stale: false }),
  alertsPage: (): Promise<AlertsPage> => Promise.resolve({ alerts: [], next: null }),
  observedAlert: () => undefined,
};

/** The routes over an engine on a manual clock, started, with the engine's pieces to look at. */
async function setup(
  options: {
    started?: boolean;
    wallClock?: boolean;
    rules?: RulesView;
    broken?: boolean;
    /** Where the library saves scenarios; without it the library cannot save. */
    scenarioStore?: ScenarioStore;
    /** The simulator's connection to the broker, for the link-loss fault; without it that fault is refused. */
    link?: LinkControl;
  } = {},
) {
  const {
    started = true,
    wallClock = false,
    rules = RULES,
    broken = false,
    scenarioStore,
    link,
  } = options;
  const { engine, publisher } = setupEngine({
    ...(wallClock ? { clock: systemClock } : {}),
    ...(link ? { link } : {}),
  });
  if (started && !wallClock) await engine.start();
  const store = new ObservationStore();
  const broker = new BrokerLink('mqtt://u:p@localhost:1883', true);
  const recorded: ObservationDraft[] = [];
  const library = new ScenarioLibrary({
    builtIn: broken ? [OVERHEAT, BOTH, BROKEN] : [OVERHEAT, BOTH],
    devices: broken ? [...DEVICES, GHOST] : DEVICES,
    ...(scenarioStore ? { store: scenarioStore } : {}),
  });
  const runs = new ScenarioRuns({
    engine,
    record: (draft) => recorded.push(draft),
    now: () => T0 + 123,
  });
  // What the fake ingest says about its counters now; a test changes it between two commands.
  const feed: { current: MetricsFeed } = { current: INGEST.metrics() };
  const effect = new FaultEffect({ now: () => T0 + 5000 });
  const context: RoutesContext = {
    engine,
    devices: DEVICES,
    library,
    runs,
    store,
    ingest: { ...INGEST, metrics: () => feed.current },
    config: { ingestUrl: 'http://localhost:3100', consoleUrl: null },
    broker,
    rules,
    effect,
  };
  const handle = createRoutes(context);
  const call = (method: string, path: string, body?: unknown): Promise<RouteResponse> => {
    const url = new URL(path, 'http://localhost');
    return handle({ method, path: url.pathname, query: url.searchParams, body });
  };
  return { engine, publisher, store, broker, recorded, context, call, feed, effect };
}

const view = (response: RouteResponse) => response.body as StateView;
const device = (response: RouteResponse, id: string) =>
  view(response).engine.devices.find((d) => d.id === id);

function assertEnvelope(response: RouteResponse, status: number, message?: RegExp) {
  assert.equal(response.status, status);
  const body = response.body as { statusCode: number; error: string; message: string };
  assert.equal(body.statusCode, status);
  assert.equal(typeof body.error, 'string');
  if (message) assert.match(body.message, message);
}

describe('GET /api/state', () => {
  it('carries the engine, the registry fields, the scenarios, ingest and the config', async () => {
    const { call } = await setup();
    const response = await call('GET', '/api/state');

    assert.equal(response.status, 200);
    const state = view(response);
    assert.equal(state.engine.running, true);
    assert.equal(state.engine.simulated, true);
    assert.deepEqual(
      state.devices.map((d) => [d.id, d.kind, d.zoneCode]),
      [
        ['dc-env-01', 'server_room', 'BLD-DC'],
        ['dc-env-02', 'server_room', 'BLD-DC'],
        ['lib-air-01', 'indoor_air', 'BLD-LIB'],
      ],
    );
    assert.deepEqual(state.devices[2]?.metrics, ['co2_ppm', 'temperature_c', 'humidity_pct']);
    assert.deepEqual(state.scenarios, ['overheat', 'both']);
    assert.deepEqual(state.runs, []);
    assert.equal(state.ingest.status, 'ready');
    assert.deepEqual(state.config, {
      ingestUrl: 'http://localhost:3100',
      consoleUrl: null,
      intervalMs: 2000,
      simulated: true,
    });
    assert.equal(state.observationCursor, 0);
  });

  it("reports the simulator's own broker connection, without credentials, and follows it", async () => {
    const { call, broker } = await setup();
    const connected = view(await call('GET', '/api/state')).broker;
    assert.deepEqual(connected, { url: 'mqtt://localhost:1883', port: 1883, connected: true });

    broker.setConnected(false);
    assert.equal(view(await call('GET', '/api/state')).broker.connected, false);
    assert.ok(!JSON.stringify(view(await call('GET', '/api/state'))).includes('u:p'));
  });

  it('is what buildStateView builds, which the stream sends as its first message', async () => {
    const { call, context } = await setup();
    assert.deepEqual((await call('GET', '/api/state')).body, buildStateView(context));
  });
});

describe('GET /api/state: rules and profiles', () => {
  it('carries the rules that were read, as they are', async () => {
    const { call } = await setup();
    assert.deepEqual(view(await call('GET', '/api/state')).rules, RULES);
  });

  it('says why when there are no rules, and lists none', async () => {
    const { call } = await setup({ rules: rulesUnavailable('cannot read /x/rules.json (ENOENT)') });
    assert.deepEqual(view(await call('GET', '/api/state')).rules, {
      available: false,
      reason: 'cannot read /x/rules.json (ENOENT)',
      items: [],
    });
  });

  it('carries the profile of every metric of every device, read-only', async () => {
    const { call } = await setup();
    const { profiles } = view(await call('GET', '/api/state'));
    assert.deepEqual(Object.keys(profiles), ['dc-env-01', 'dc-env-02', 'lib-air-01']);
    assert.deepEqual(profiles['dc-env-01']?.temperature_c, {
      baseline: 22.5,
      noise: 0.3,
      dailySwing: 0,
    });
    assert.deepEqual(Object.keys(profiles['lib-air-01'] ?? {}), [
      'co2_ppm',
      'temperature_c',
      'humidity_pct',
    ]);
    assert.equal(profiles['lib-air-01']?.co2_ppm?.dailySwing, 350);
  });

  it('keeps the same profiles when the engine state changes', async () => {
    const { call } = await setup();
    const before = view(await call('GET', '/api/state')).profiles;
    const after = view(await call('POST', '/api/devices/dc-env-01/pause')).profiles;
    assert.deepEqual(after, before);
  });
});

describe('device commands', () => {
  it('starts, pauses and stops a device and answers the new state', async () => {
    const { call } = await setup();
    assert.equal(
      device(await call('POST', '/api/devices/dc-env-01/pause'), 'dc-env-01')?.state,
      'paused',
    );
    assert.equal(
      device(await call('POST', '/api/devices/dc-env-01/stop'), 'dc-env-01')?.state,
      'stopped',
    );
    assert.equal(
      device(await call('POST', '/api/devices/dc-env-01/start'), 'dc-env-01')?.state,
      'running',
    );
  });

  it('stops publishing a stopped device and publishes a started one again after an interval', async () => {
    const { call, engine, publisher } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop');
    const before = publisher.sent.length;
    await engine.step();
    assert.equal(publisher.sent.length - before, 2); // the other two devices

    await call('POST', '/api/devices/dc-env-01/start');
    await engine.step();
    assert.equal(publisher.sent.length - before, 5); // all three after the restart
  });

  it('sets a device interval and takes it back with null', async () => {
    const { call } = await setup();
    assert.equal(
      device(await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: 500 }), 'dc-env-01')
        ?.intervalMs,
      500,
    );
    assert.equal(
      device(
        await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: null }),
        'dc-env-01',
      )?.intervalMs,
      2000,
    );
  });

  it('refuses an interval that is missing or cannot be used', async () => {
    const { call } = await setup();
    assertEnvelope(await call('PUT', '/api/devices/dc-env-01/interval', {}), 400, /intervalMs/);
    assertEnvelope(await call('PUT', '/api/devices/dc-env-01/interval'), 400, /intervalMs/);
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: 0 }),
      400,
      /interval/i,
    );
    assertEnvelope(await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: -5 }), 400);
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: '500' }),
      400,
      /intervalMs/,
    );
  });

  it('holds a value exactly, over the signal, until it is released', async () => {
    const { call, engine, publisher } = await setup();
    const held = await call('PUT', '/api/devices/dc-env-01/holds/temperature_c', { value: 31.5 });
    assert.deepEqual(device(held, 'dc-env-01')?.holds, { temperature_c: 31.5 });

    await engine.step();
    const reading = publisher.sent
      .map((m) => ({
        topic: m.topic,
        ...(JSON.parse(m.payload) as { metrics: Record<string, number> }),
      }))
      .findLast((m) => m.topic.includes('dc-env-01'));
    assert.equal(reading?.metrics.temperature_c, 31.5);

    const released = await call('DELETE', '/api/devices/dc-env-01/holds/temperature_c');
    assert.deepEqual(device(released, 'dc-env-01')?.holds, {});
  });

  it('answers 404 for a device it does not have, on every device route', async () => {
    const { call } = await setup();
    for (const [method, path, body] of [
      ['POST', '/api/devices/ghost/start', undefined],
      ['POST', '/api/devices/ghost/pause', undefined],
      ['POST', '/api/devices/ghost/stop', undefined],
      ['PUT', '/api/devices/ghost/interval', { intervalMs: 1000 }],
      ['PUT', '/api/devices/ghost/holds/temperature_c', { value: 1 }],
      ['DELETE', '/api/devices/ghost/holds/temperature_c', undefined],
    ] as const) {
      assertEnvelope(await call(method, path, body), 404, /Unknown device "ghost"/);
    }
  });

  it('refuses a metric that is unknown or that the device does not report', async () => {
    const { call } = await setup();
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/pressure', { value: 1 }),
      400,
      /Unknown metric/,
    );
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/co2_ppm', { value: 1 }),
      400,
      /has no metric/,
    );
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/__proto__', { value: 1 }),
      400,
      /Unknown metric/,
    );
  });

  it('refuses a held value that is not a finite number, and a body that is not an object', async () => {
    const { call } = await setup();
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/temperature_c', { value: '30' }),
      400,
      /"value"/,
    );
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/temperature_c', {}),
      400,
      /"value"/,
    );
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/temperature_c', [1]),
      400,
      /JSON object/,
    );
    assertEnvelope(
      await call('PUT', '/api/devices/dc-env-01/holds/temperature_c', 5),
      400,
      /JSON object/,
    );
  });
});

describe('anomaly commands', () => {
  const overheat = { deviceId: 'dc-env-01', metric: 'temperature_c', value: 30, duration: 10 };

  it('adds an anomaly at an absolute time on the anomaly clock, and answers 201 with its id', async () => {
    const { call, engine } = await setup();
    const response = await call('POST', '/api/anomalies', {
      ...overheat,
      startAt: 4,
      shape: 'ramp',
    });

    assert.equal(response.status, 201);
    const body = response.body as { id: string } & StateView;
    assert.equal(body.id, 'a1');
    assert.deepEqual(engine.snapshot().anomalies, [
      { id: 'a1', anomaly: { ...overheat, startAt: 4, shape: 'ramp' } },
    ]);
    assert.equal(body.engine.anomalies.length, 1);
  });

  it('starts "in N seconds" from where the anomaly clock is now, and now by default', async () => {
    const { call, engine } = await setup();
    await engine.step();
    await engine.step();
    await engine.step(); // 6 s on the anomaly clock

    await call('POST', '/api/anomalies', { ...overheat, startIn: 4 });
    await call('POST', '/api/anomalies', overheat);

    assert.deepEqual(
      engine.snapshot().anomalies.map((a) => a.anomaly.startAt),
      [10, 6],
    );
  });

  it('refuses startAt and startIn together', async () => {
    const { call, engine } = await setup();
    assertEnvelope(
      await call('POST', '/api/anomalies', { ...overheat, startAt: 1, startIn: 1 }),
      400,
      /not both/,
    );
    assert.equal(engine.snapshot().anomalies.length, 0);
  });

  it('answers 404 for an unknown device and 400 for an unknown metric', async () => {
    const { call } = await setup();
    assertEnvelope(await call('POST', '/api/anomalies', { ...overheat, deviceId: 'ghost' }), 404);
    assertEnvelope(
      await call('POST', '/api/anomalies', { ...overheat, metric: 'pressure' }),
      400,
      /Unknown metric/,
    );
    assertEnvelope(
      await call('POST', '/api/anomalies', { ...overheat, metric: 'co2_ppm' }),
      400,
      /has no metric/,
    );
  });

  it('refuses numbers and shapes the engine cannot play, and stores nothing', async () => {
    const { call, engine, store } = await setup();
    assertEnvelope(
      await call('POST', '/api/anomalies', { ...overheat, duration: 0 }),
      400,
      /duration/i,
    );
    assertEnvelope(await call('POST', '/api/anomalies', { ...overheat, duration: -3 }), 400);
    assertEnvelope(
      await call('POST', '/api/anomalies', { ...overheat, value: 'hot' }),
      400,
      /"value"/,
    );
    assertEnvelope(
      await call('POST', '/api/anomalies', { ...overheat, shape: 'wave' }),
      400,
      /shape/i,
    );
    assertEnvelope(await call('POST', '/api/anomalies', { deviceId: 'dc-env-01' }), 400, /metric/);
    assert.equal(engine.snapshot().anomalies.length, 0);
    assert.equal(store.latestId(), 0);
  });

  it('lists the anomalies and removes one, and answers 404 for one it does not have', async () => {
    const { call } = await setup();
    await call('POST', '/api/anomalies', overheat);
    const listed = await call('GET', '/api/anomalies');
    assert.deepEqual(
      (listed.body as { anomalies: { id: string }[] }).anomalies.map((a) => a.id),
      ['a1'],
    );

    const removed = await call('DELETE', '/api/anomalies/a1');
    assert.equal(removed.status, 200);
    assert.equal(view(removed).engine.anomalies.length, 0);
    assertEnvelope(await call('DELETE', '/api/anomalies/a1'), 404, /Unknown anomaly/);
  });
});

const post = (call: Awaited<ReturnType<typeof setup>>['call'], path: string, body?: unknown) =>
  call('POST', path, body);

interface Item {
  name: string;
  description: string;
  source: string;
  imported: boolean;
  anomalies: { deviceId: string; startAt: number }[];
  lengthS: number;
  needsStart: { deviceId: string; state: string }[];
  lastRunAt: string | null;
  running: boolean;
  expected: {
    available: boolean;
    reason?: string;
    alerts?: { ruleId: string; deviceId: string; opensAtS: number; clearsAtS: number | null }[];
    quiet?: { deviceId: string; why: string }[];
  };
}
const library = (response: RouteResponse) =>
  response.body as { scenarios: Item[]; rejected: unknown[]; intervalMs: number };
const item = (response: RouteResponse, name: string) =>
  library(response).scenarios.find((s) => s.name === name);

describe('GET /api/scenarios', () => {
  it('lists the library with what Studio draws a card from', async () => {
    const { call } = await setup();
    const response = await call('GET', '/api/scenarios');

    assert.equal(response.status, 200);
    assert.deepEqual(
      library(response).scenarios.map((s) => s.name),
      ['overheat', 'both'],
    );
    assert.equal(library(response).intervalMs, 2000);
    assert.deepEqual(library(response).rejected, []);
    const overheat = item(response, 'overheat');
    assert.equal(overheat?.description, 'Row A runs hot.');
    assert.equal(overheat?.source, 'built-in');
    assert.equal(overheat?.imported, false);
    assert.equal(overheat?.lengthS, 80);
    assert.deepEqual(overheat?.needsStart, []);
    assert.equal(overheat?.running, false);
    assert.equal(overheat?.lastRunAt, null);
    assert.equal(overheat?.anomalies[0]?.deviceId, 'dc-env-01');
    assert.equal(overheat?.anomalies[0]?.startAt, 20);
  });

  it('says which alerts a scenario should raise, and when', async () => {
    const { call } = await setup();
    const response = await call('GET', '/api/scenarios');

    const overheat = item(response, 'overheat')?.expected;
    assert.equal(overheat?.available, true);
    assert.deepEqual(
      overheat?.alerts?.map((a) => [a.ruleId, a.deviceId, a.opensAtS, a.clearsAtS]),
      [['server-room-hot', 'dc-env-01', 24, 80]],
    );
    // No rule watches CO₂ in this test's rules: the anomaly is said to raise nothing, not left out.
    const both = item(response, 'both')?.expected;
    assert.deepEqual(both?.quiet, [{ deviceId: 'lib-air-01', metric: 'co2_ppm', why: 'no-rule' }]);
  });

  it('gives no guess when the rules could not be read, and says why', async () => {
    const { call } = await setup({ rules: rulesUnavailable('cannot read rules.json (ENOENT)') });
    for (const s of library(await call('GET', '/api/scenarios')).scenarios) {
      assert.deepEqual(s.expected, { available: false, reason: 'cannot read rules.json (ENOENT)' });
    }
  });

  it('lists the devices a run would start, with the state they are in', async () => {
    const { call } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop');
    await call('POST', '/api/devices/lib-air-01/pause');

    const response = await call('GET', '/api/scenarios');

    assert.deepEqual(item(response, 'overheat')?.needsStart, [
      { deviceId: 'dc-env-01', state: 'stopped' },
    ]);
    assert.deepEqual(item(response, 'both')?.needsStart, [
      { deviceId: 'dc-env-01', state: 'stopped' },
      { deviceId: 'lib-air-01', state: 'paused' },
    ]);
  });

  it("works the expected times out with a device's own interval", async () => {
    const { call } = await setup();
    await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: 1000 });
    const overheat = item(await call('GET', '/api/scenarios'), 'overheat')?.expected;
    assert.equal(overheat?.alerts?.[0]?.opensAtS, 22); // 20, 21, 22 s
  });
});

describe('POST /api/expectations', () => {
  const preview = (response: RouteResponse) => response.body as ExpectationPreview;
  const anomalyBody = (change: Record<string, unknown> = {}) => ({
    deviceId: 'dc-env-01',
    metric: 'temperature_c',
    value: 29.2,
    startAt: 20,
    duration: 60,
    ...change,
  });
  /** `count` anomalies on one device and metric that follow each other without overlapping. */
  const sequence = (count: number) =>
    Array.from({ length: count }, (_, i) => anomalyBody({ startAt: i * 10, duration: 10 }));

  it('says what the library says for the anomalies of a scenario, device states included', async () => {
    const { call } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop');
    await call('POST', '/api/devices/lib-air-01/pause');

    const read = await call('GET', '/api/scenarios');
    for (const scenario of [OVERHEAT, BOTH]) {
      const response = await call('POST', '/api/expectations', { anomalies: scenario.anomalies });
      assert.equal(response.status, 200);
      const listed = item(read, scenario.name);
      assert.deepEqual(preview(response).expected, listed?.expected, scenario.name);
      assert.deepEqual(preview(response).needsStart, listed?.needsStart, scenario.name);
      assert.equal(preview(response).intervalMs, 2000);
    }
  });

  it('works out a fault on several devices started a few seconds apart', async () => {
    const { call } = await setup();
    const response = await call('POST', '/api/expectations', {
      anomalies: [anomalyBody(), anomalyBody({ deviceId: 'dc-env-02', startAt: 22 })],
    });

    const { expected } = preview(response);
    assert.ok(expected.available);
    assert.deepEqual(
      expected.alerts.map((a) => [a.deviceId, a.opensAtS, a.clearsAtS]),
      [
        ['dc-env-01', 24, 80],
        ['dc-env-02', 26, 82],
      ],
    );
    assert.equal(expected.horizonS, 82);
  });

  it('changes nothing: no anomaly, no library entry, no observation, no state', async () => {
    const { call, store } = await setup();
    const before = (await call('GET', '/api/state')).body;
    const cursor = store.latestId();

    await call('POST', '/api/expectations', { anomalies: [anomalyBody()] });
    await call('POST', '/api/expectations', { anomalies: [anomalyBody({ deviceId: 'ghost' })] });

    assert.deepEqual((await call('GET', '/api/state')).body, before);
    assert.deepEqual((await call('GET', '/api/anomalies')).body, { anomalies: [] });
    assert.deepEqual(
      library(await call('GET', '/api/scenarios')).scenarios.map((s) => s.name),
      ['overheat', 'both'],
    );
    assert.equal(store.latestId(), cursor);
  });

  it('lists the devices that are not running, in the order the anomalies use them, and starts their ticks at 1', async () => {
    const { call } = await setup();
    const fast = [anomalyBody({ startAt: 0, duration: 30 })];
    const running = await call('POST', '/api/expectations', { anomalies: fast });
    assert.deepEqual(preview(running).needsStart, []);
    const runningExpected = preview(running).expected;
    assert.ok(runningExpected.available);
    assert.equal(runningExpected.alerts[0]?.opensAtS, 4);

    await call('POST', '/api/devices/dc-env-01/stop');
    await call('POST', '/api/devices/dc-env-02/pause');
    const stopped = await call('POST', '/api/expectations', {
      anomalies: [anomalyBody({ deviceId: 'dc-env-02' }), ...fast, anomalyBody({ startAt: 200 })],
    });
    assert.deepEqual(preview(stopped).needsStart, [
      { deviceId: 'dc-env-02', state: 'paused' },
      { deviceId: 'dc-env-01', state: 'stopped' },
    ]);
    const first = await call('POST', '/api/expectations', { anomalies: fast });
    const firstExpected = preview(first).expected;
    assert.ok(firstExpected.available);
    assert.equal(firstExpected.alerts[0]?.opensAtS, 6);
  });

  it("works the times out with a device's own interval", async () => {
    const { call } = await setup();
    await call('PUT', '/api/devices/dc-env-01/interval', { intervalMs: 1000 });
    const { expected } = preview(
      await call('POST', '/api/expectations', { anomalies: [anomalyBody()] }),
    );
    assert.ok(expected.available);
    assert.equal(expected.alerts[0]?.opensAtS, 22); // 20, 21, 22 s
  });

  it('accepts as many anomalies as the cap, and says what raises nothing', async () => {
    const { call } = await setup();
    const response = await call('POST', '/api/expectations', {
      anomalies: [
        ...sequence(PREVIEW_MAX_ANOMALIES - 1),
        anomalyBody({ metric: 'humidity_pct', value: 70 }),
      ],
    });
    assert.equal(response.status, 200);
    const { expected } = preview(response);
    assert.ok(expected.available);
    assert.deepEqual(expected.quiet, [
      { deviceId: 'dc-env-01', metric: 'humidity_pct', why: 'no-rule' },
    ]);
  });

  it('gives no guess when the rules could not be read, and says why', async () => {
    const { call } = await setup({ rules: rulesUnavailable('cannot read rules.json (ENOENT)') });
    const response = await call('POST', '/api/expectations', { anomalies: [anomalyBody()] });
    assert.equal(response.status, 200);
    assert.deepEqual(preview(response).expected, {
      available: false,
      reason: 'cannot read rules.json (ENOENT)',
    });
  });

  it('gives no guess, with the sum and the limit, when the walk would be too long', async () => {
    const { call } = await setup();
    for (const id of ['dc-env-01', 'dc-env-02', 'lib-air-01']) {
      await call('PUT', `/api/devices/${id}/interval`, { intervalMs: 1000 });
    }
    // Seven signals over 3,600 s at 1 s: 3,610 ticks each, 25,270 in all, against 20,000.
    const long = { startAt: 0, duration: 3600 };
    const response = await call('POST', '/api/expectations', {
      anomalies: [
        anomalyBody(long),
        anomalyBody({ ...long, metric: 'humidity_pct', value: 70 }),
        anomalyBody({ ...long, deviceId: 'dc-env-02' }),
        anomalyBody({ ...long, deviceId: 'dc-env-02', metric: 'humidity_pct', value: 70 }),
        anomalyBody({ ...long, deviceId: 'lib-air-01', metric: 'co2_ppm', value: 1450 }),
        anomalyBody({ ...long, deviceId: 'lib-air-01' }),
        anomalyBody({ ...long, deviceId: 'lib-air-01', metric: 'humidity_pct', value: 70 }),
      ],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(preview(response).expected, {
      available: false,
      reason:
        'Too many readings to work out the alerts of 7 anomalies on 7 signals over 3600 s: 25270 against a limit of 20000',
    });
  });

  it('refuses what a scenario file would refuse, and what is not a request, with the reason', async () => {
    const { call } = await setup();
    const refused = async (body: unknown, message: RegExp) =>
      assertEnvelope(await call('POST', '/api/expectations', body), 400, message);
    const list = /^anomalies must be a list of 1 to 100 anomalies$/;

    await refused(
      { anomalies: [anomalyBody({ deviceId: 'ghost' })] },
      /anomalies\[0\]: unknown device "ghost"/,
    );
    await refused({ anomalies: [anomalyBody({ metric: 'power_kw' })] }, /does not report power_kw/);
    await refused(
      { anomalies: [anomalyBody({ value: 90 })] },
      /outside the range of temperature_c/,
    );
    await refused(
      { anomalies: [anomalyBody({ startAt: -1 })] },
      /startAt must be a number of seconds/,
    );
    await refused(
      { anomalies: [anomalyBody({ duration: 3601 })] },
      /duration must be .* at most 3600/,
    );
    await refused(
      { anomalies: [anomalyBody({ shape: 'wave' })] },
      /shape must be one of step, ramp, spike/,
    );
    await refused(
      { anomalies: [anomalyBody({ shap: 'ramp' })] },
      /anomalies\[0\]\.shap is not a known field/,
    );
    await refused(
      { anomalies: [anomalyBody(), anomalyBody({ startAt: 50, duration: 10 })] },
      /anomalies\[1\] overlaps anomalies\[0\] on dc-env-01 temperature_c/,
    );
    await refused({ anomalies: [] }, list);
    await refused({}, list);
    await refused({ anomalies: sequence(PREVIEW_MAX_ANOMALIES + 1) }, list);
    await refused(
      { anomalies: [anomalyBody()], name: 'x' },
      /"name" is not a known field of the request/,
    );
    await refused([], /must be a JSON object/);
  });

  it('answers 405 with Allow: POST to a GET', async () => {
    const { call } = await setup();
    const response = await call('GET', '/api/expectations');
    assertEnvelope(response, 405);
    assert.equal(response.headers?.Allow, 'POST');
  });
});

describe('POST /api/expectations and the fixture of the UI', () => {
  // apps/simulator-ui types the preview it reads against this file (a real POST /api/expectations body); if the
  // route changes the keys of its answer, this fails until the file and the UI's types follow.
  interface Answer {
    expected: { alerts: unknown[]; series: unknown[] };
    needsStart: unknown[];
  }
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../simulator-ui/src/api/fixtures/expectations.json', import.meta.url),
      'utf8',
    ),
  ) as Answer;
  const keys = (value: unknown) => Object.keys(value as object).sort();

  it('has the same keys as the fixture, section by section', async () => {
    const { call } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop'); // so that there is a device to start
    const actual = (await call('POST', '/api/expectations', { anomalies: OVERHEAT.anomalies }))
      .body as Answer;

    assert.deepEqual(keys(actual), keys(fixture), 'the answer');
    assert.deepEqual(keys(actual.expected), keys(fixture.expected), 'expected');
    assert.deepEqual(keys(actual.expected.alerts[0]), keys(fixture.expected.alerts[0]), 'an alert');
    assert.deepEqual(keys(actual.expected.series[0]), keys(fixture.expected.series[0]), 'a series');
    assert.deepEqual(keys(actual.needsStart[0]), keys(fixture.needsStart[0]), 'a device to start');
  });

  it('answers the fixture back, value for value, for the scenario it was made from', async () => {
    const { call } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop');
    const response = await call('POST', '/api/expectations', { anomalies: OVERHEAT.anomalies });
    assert.deepEqual(response.body, fixture);
  });
});

describe('POST /api/scenarios/:name/run', () => {
  it('runs a preset starting from now: its "20 s in" is 20 s from the click', async () => {
    const { call, engine, recorded } = await setup();
    for (let i = 0; i < 5; i++) await engine.step(); // 10 s in

    const response = await post(call, '/api/scenarios/both/run');

    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.runId, 'r1');
    assert.deepEqual(body.anomalyIds, ['a1', 'a2']);
    assert.deepEqual(body.startedDevices, []);
    assert.deepEqual(body.replaced, []);
    assert.deepEqual(
      engine.snapshot().anomalies.map((a) => [a.id, a.anomaly.startAt, a.anomaly.duration]),
      [
        ['a1', 30, 60],
        ['a2', 20, 30],
      ],
    );
    assert.deepEqual(view(response).runs, [
      {
        id: 'r1',
        scenario: 'both',
        startedAt: '2026-10-01T05:00:00.123Z',
        offsetS: 10,
        endsAtS: 90,
        anomalyIds: ['a1', 'a2'],
        startedDevices: [],
      },
    ]);
    assert.deepEqual(recorded, [
      {
        kind: 'scenario-run',
        data: {
          name: 'both',
          anomalyIds: ['a1', 'a2'],
          offsetS: 10,
          // What the engine holds after the run, kept because a reset empties the engine.
          anomalies: [
            { id: 'a1', deviceId: 'dc-env-01', metric: 'temperature_c', startAt: 30, duration: 60 },
            { id: 'a2', deviceId: 'lib-air-01', metric: 'co2_ppm', startAt: 20, duration: 30 },
          ],
          runId: 'r1',
          startedDevices: [],
          replaced: [],
        },
      },
    ]);
  });

  it('marks the scenario as running, with the time it was run, in the library read', async () => {
    const { call } = await setup();
    await post(call, '/api/scenarios/overheat/run');
    const overheat = item(await call('GET', '/api/scenarios'), 'overheat');
    assert.equal(overheat?.running, true);
    assert.equal(overheat?.lastRunAt, '2026-10-01T05:00:00.123Z');
    assert.equal(item(await call('GET', '/api/scenarios'), 'both')?.running, false);
  });

  it('starts the stopped and paused devices it needs and says which', async () => {
    const { call } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop');
    await call('POST', '/api/devices/lib-air-01/pause');

    const response = await post(call, '/api/scenarios/both/run');

    assert.deepEqual((response.body as { startedDevices: string[] }).startedDevices, [
      'dc-env-01',
      'lib-air-01',
    ]);
    assert.equal(device(response, 'dc-env-01')?.state, 'running');
    assert.equal(device(response, 'lib-air-01')?.state, 'running');
  });

  it('adds nothing when one anomaly of the scenario cannot be added', async () => {
    const { call, engine, recorded } = await setup({ broken: true });
    const response = await post(call, '/api/scenarios/broken/run');

    assertEnvelope(response, 400, /ghost-01/);
    assert.deepEqual(engine.snapshot().anomalies, []);
    assert.deepEqual(recorded, []);
  });

  it('refuses to play over a run in the way, names it, and changes nothing', async () => {
    const { call, engine, recorded } = await setup();
    await post(call, '/api/scenarios/overheat/run');

    const response = await post(call, '/api/scenarios/overheat/run');

    assertEnvelope(response, 409, /replace/);
    assert.deepEqual((response.body as { conflicts: unknown }).conflicts, [
      { deviceId: 'dc-env-01', anomalyId: 'a1', runId: 'r1', scenario: 'overheat' },
    ]);
    assert.equal(engine.snapshot().anomalies.length, 1);
    assert.equal(recorded.length, 1);
  });

  it('replaces the run in the way when asked to', async () => {
    const { call, engine } = await setup();
    await post(call, '/api/scenarios/overheat/run');

    const response = await post(call, '/api/scenarios/overheat/run', { replace: true });

    assert.equal(response.status, 200);
    assert.deepEqual((response.body as { replaced: unknown }).replaced, [
      { runId: 'r1', scenario: 'overheat', anomalyIds: ['a1'] },
    ]);
    assert.deepEqual(
      engine.snapshot().anomalies.map((a) => a.id),
      ['a2'],
    );
    assert.deepEqual(
      view(response).runs.map((r) => r.id),
      ['r2'],
    );
  });

  it('refuses a replace that is not true or false', async () => {
    const { call } = await setup();
    assertEnvelope(
      await post(call, '/api/scenarios/overheat/run', { replace: 'yes' }),
      400,
      /"replace" must be true or false/,
    );
    assertEnvelope(
      await post(call, '/api/scenarios/overheat/run', [true]),
      400,
      /must be a JSON object/,
    );
  });

  it('answers 404 for a scenario it does not have, including names that exist on every object', async () => {
    const { call } = await setup();
    assertEnvelope(await post(call, '/api/scenarios/nope/run'), 404, /Unknown scenario "nope"/);
    assertEnvelope(await post(call, '/api/scenarios/constructor/run'), 404);
    assertEnvelope(await post(call, '/api/scenarios/__proto__/run'), 404);
  });
});

describe('POST /api/scenarios/:name/stop', () => {
  it('stops the run, removes its anomalies and records it', async () => {
    const { call, engine, recorded } = await setup();
    await post(call, '/api/scenarios/overheat/run');

    const response = await post(call, '/api/scenarios/overheat/stop');

    assert.equal(response.status, 200);
    assert.deepEqual(view(response).runs, []);
    assert.deepEqual(engine.snapshot().anomalies, []);
    assert.deepEqual(recorded.at(-1), {
      kind: 'scenario-stop',
      data: { name: 'overheat', runId: 'r1', anomalyIds: ['a1'], reason: 'stopped' },
    });
  });

  it('answers 409 for a scenario that is not running, 404 for one that does not exist', async () => {
    const { call } = await setup();
    assertEnvelope(
      await post(call, '/api/scenarios/overheat/stop'),
      409,
      /"overheat" is not running/,
    );
    assertEnvelope(await post(call, '/api/scenarios/nope/stop'), 404, /Unknown scenario/);
    assertEnvelope(await post(call, '/api/scenarios/constructor/stop'), 404);
  });
});

describe('POST /api/scenarios/import', () => {
  const extra = {
    name: 'extra',
    description: 'Imported.',
    anomalies: [
      { deviceId: 'dc-env-02', metric: 'temperature_c', value: 30, startAt: 5, duration: 20 },
    ],
  };

  it('keeps a valid scenario for the session and answers with its card', async () => {
    const { call } = await setup();

    const response = await post(call, '/api/scenarios/import', extra);

    assert.equal(response.status, 201);
    const created = (response.body as { scenario: Item }).scenario;
    assert.equal(created.name, 'extra');
    assert.equal(created.source, 'custom');
    assert.equal(created.imported, true);
    assert.deepEqual(
      created.expected.alerts?.map((a) => [a.deviceId, a.opensAtS, a.clearsAtS]),
      [['dc-env-02', 10, 26]],
    );
    assert.deepEqual(view(response).scenarios, ['overheat', 'both', 'extra']);
    assert.equal((await post(call, '/api/scenarios/extra/run')).status, 200);
  });

  it('refuses a value outside the range of the contract, with the reason', async () => {
    const { call } = await setup();
    const hot = { ...extra, anomalies: [{ ...extra.anomalies[0], value: 900 }] };

    const response = await post(call, '/api/scenarios/import', hot);

    assertEnvelope(
      response,
      400,
      /^anomalies\[0\]\.value 900 is outside the range of temperature_c \(-40 to 85 °C\)$/,
    );
    assert.deepEqual(view(await call('GET', '/api/state')).scenarios, ['overheat', 'both']);
  });

  it('refuses what is not a scenario, a reserved name and a name that is taken', async () => {
    const { call } = await setup();
    assertEnvelope(await post(call, '/api/scenarios/import'), 400, /must be a JSON object/);
    assertEnvelope(await post(call, '/api/scenarios/import', { ...extra, name: 'import' }), 400);
    assertEnvelope(
      await post(call, '/api/scenarios/import', { ...extra, name: 'overheat' }),
      409,
      /already exists/,
    );
  });
});

const scenarioRoot = mkdtempSync(join(tmpdir(), 'control-routes-scenarios-'));
after(() => rmSync(scenarioRoot, { recursive: true, force: true }));
let scenarioFolders = 0;
/** The path of a folder for one case; it does not exist yet. */
const newScenarioFolder = () => join(scenarioRoot, `case-${scenarioFolders++}`);

describe('PUT and DELETE /api/scenarios/:name', () => {
  const hot: ScenarioDocument = {
    name: 'hot',
    description: 'Row B runs hot too.',
    anomalies: [
      { deviceId: 'dc-env-02', metric: 'temperature_c', value: 30, startAt: 5, duration: 20 },
    ],
  };
  const put = (call: Awaited<ReturnType<typeof setup>>['call'], name: string, body?: unknown) =>
    call('PUT', `/api/scenarios/${name}`, body);
  const del = (call: Awaited<ReturnType<typeof setup>>['call'], name: string) =>
    call('DELETE', `/api/scenarios/${name}`);

  /** The routes with a library that saves into a folder of its own. */
  async function withFolder() {
    const dir = newScenarioFolder();
    const harness = await setup({ scenarioStore: new FolderScenarioStore(dir) });
    return { ...harness, dir };
  }

  it('saves a new scenario as a file, answers with its card, and what is saved runs as drawn', async () => {
    const { call, engine, recorded, dir } = await withFolder();

    const response = await put(call, 'hot', hot);

    assert.equal(response.status, 201);
    const card = (response.body as { scenario: Item }).scenario;
    assert.equal(card.name, 'hot');
    assert.equal(card.source, 'custom');
    assert.equal(card.imported, false);
    assert.deepEqual(
      card.expected.alerts?.map((a) => [a.deviceId, a.opensAtS, a.clearsAtS]),
      [['dc-env-02', 10, 26]],
    );
    assert.deepEqual(view(response).scenarios, ['overheat', 'both', 'hot']);
    assert.equal(readFileSync(join(dir, 'hot.json'), 'utf8'), serializeScenario(hot));

    assert.equal((await post(call, '/api/scenarios/hot/run')).status, 200);
    assert.deepEqual(
      engine.snapshot().anomalies.map((a) => a.anomaly),
      hot.anomalies,
    );
    // A save is not an event of the system under test (decision Q6): nothing is recorded for it.
    assert.deepEqual(
      recorded.map((r) => r.kind),
      ['scenario-run'],
    );
  });

  it('is read back by a simulator that starts later: saved, reloaded, the same document', async () => {
    const { call, dir } = await withFolder();
    assert.equal((await put(call, 'hot', hot)).status, 201);

    const reloaded = new ScenarioLibrary({
      builtIn: [],
      folder: loadScenarioFolder(dir, { devices: DEVICES }),
      devices: DEVICES,
    });
    assert.deepEqual(reloaded.rejected, []);
    assert.deepEqual(reloaded.get('hot')?.scenario, hot);
    assert.equal(reloaded.get('hot')?.imported, false);
  });

  it('replaces a scenario with 200 and the new document, in the file it was in', async () => {
    const { call, dir } = await withFolder();
    assert.equal((await put(call, 'hot', hot)).status, 201);

    const response = await put(call, 'hot', { ...hot, description: 'Changed.' });

    assert.equal(response.status, 200);
    assert.equal((response.body as { scenario: Item }).scenario.description, 'Changed.');
    assert.deepEqual(view(response).scenarios, ['overheat', 'both', 'hot']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'hot.json'), 'utf8')).description, 'Changed.');
    assert.deepEqual(readdirSync(dir), ['hot.json']);
  });

  it('turns an imported scenario into a file when it is saved', async () => {
    const { call, dir } = await withFolder();
    assert.equal((await post(call, '/api/scenarios/import', hot)).status, 201);
    assert.equal(existsSync(dir), false);

    const response = await put(call, 'hot', hot);

    assert.equal(response.status, 200);
    assert.equal((response.body as { scenario: Item }).scenario.imported, false);
    assert.equal(existsSync(join(dir, 'hot.json')), true);
  });

  it('wants the name of the path in the body, and writes nothing otherwise', async () => {
    const { call, dir } = await withFolder();
    assertEnvelope(await put(call, 'hot', { ...hot, name: 'cold' }), 400, /must be "hot"/);
    assertEnvelope(await put(call, 'hot'), 400, /must be "hot"/);
    assertEnvelope(await put(call, 'hot', [hot]), 400, /must be a JSON object/);
    assert.equal(existsSync(dir), false);
  });

  it('refuses an invalid document with the reason, and writes nothing', async () => {
    const { call, dir } = await withFolder();
    const tooHot = { ...hot, anomalies: [{ ...hot.anomalies[0], value: 900 }] };

    assertEnvelope(
      await put(call, 'hot', tooHot),
      400,
      /^anomalies\[0\]\.value 900 is outside the range of temperature_c \(-40 to 85 °C\)$/,
    );
    assertEnvelope(await put(call, 'import', { ...hot, name: 'import' }), 400, /reserved/);
    assert.equal(existsSync(dir), false);
    assert.deepEqual(view(await call('GET', '/api/state')).scenarios, ['overheat', 'both']);
  });

  it('cannot be made to write outside the folder with a name', async () => {
    const { call, dir } = await withFolder();
    for (const name of ['..%2Fescape', '..%2F..%2Fescape', 'a%2Fb', 'Upper', 'dot.json']) {
      const decoded = decodeURIComponent(name);
      assertEnvelope(await put(call, name, { ...hot, name: decoded }), 400, undefined);
    }
    assert.equal(existsSync(dir), false);
    assert.equal(
      readdirSync(scenarioRoot).some((entry) => entry.includes('escape')),
      false,
    );
  });

  it('refuses a built-in, for a save and for a delete', async () => {
    const { call } = await withFolder();
    assertEnvelope(
      await put(call, 'overheat', OVERHEAT),
      409,
      /built-in scenario and is read-only/,
    );
    assertEnvelope(await del(call, 'overheat'), 409, /built-in scenario and is read-only/);
    assert.deepEqual(view(await call('GET', '/api/state')).scenarios, ['overheat', 'both']);
  });

  it('refuses to change or remove a scenario that is running, until it is stopped', async () => {
    const { call, dir } = await withFolder();
    assert.equal((await put(call, 'hot', hot)).status, 201);
    assert.equal((await post(call, '/api/scenarios/hot/run')).status, 200);

    assertEnvelope(
      await put(call, 'hot', { ...hot, description: 'x' }),
      409,
      /is running; stop it first/,
    );
    assertEnvelope(await del(call, 'hot'), 409, /is running; stop it first/);
    assert.equal(
      JSON.parse(readFileSync(join(dir, 'hot.json'), 'utf8')).description,
      hot.description,
    );

    assert.equal((await post(call, '/api/scenarios/hot/stop')).status, 200);
    assert.equal((await put(call, 'hot', { ...hot, description: 'x' })).status, 200);
    assert.equal((await del(call, 'hot')).status, 200);
    assert.equal(existsSync(join(dir, 'hot.json')), false);
  });

  it('refuses the 201st custom scenario and still replaces one of the 200', async () => {
    const { call } = await withFolder();
    for (let i = 0; i < 200; i++) {
      assert.equal((await put(call, `s${i}`, { ...hot, name: `s${i}` })).status, 201, `s${i}`);
    }
    assertEnvelope(
      await put(call, 'one-more', { ...hot, name: 'one-more' }),
      409,
      /already 200 custom scenarios/,
    );
    assert.equal((await put(call, 's7', { ...hot, name: 's7', description: 'again' })).status, 200);
  });

  it('does not overwrite a file in the folder that the library did not load', async () => {
    const { call, dir } = await withFolder();
    mkdirSync(dir);
    writeFileSync(join(dir, 'hot.json'), '{ not json');

    assertEnvelope(await put(call, 'hot', hot), 409, /already in the scenarios folder/);

    assert.equal(readFileSync(join(dir, 'hot.json'), 'utf8'), '{ not json');
    assert.deepEqual(view(await call('GET', '/api/state')).scenarios, ['overheat', 'both']);
  });

  it('says 500 with the reason when the folder cannot be written, and keeps the library as it was', async () => {
    const dir = newScenarioFolder();
    writeFileSync(dir, 'a file where the folder should be');
    const { call } = await setup({ scenarioStore: new FolderScenarioStore(dir) });

    assertEnvelope(
      await put(call, 'hot', hot),
      500,
      /^cannot write hot\.json in the scenarios folder \([A-Z]+\)$/,
    );

    assert.deepEqual(view(await call('GET', '/api/state')).scenarios, ['overheat', 'both']);
  });

  it('says 500 when the simulator has no folder to save to', async () => {
    const { call } = await setup();
    assertEnvelope(await put(call, 'hot', hot), 500, /^no scenarios folder is in use$/);
  });

  it('deletes the file and the scenario, and 404s the second time', async () => {
    const { call, dir } = await withFolder();
    assert.equal((await put(call, 'hot', hot)).status, 201);

    const response = await del(call, 'hot');

    assert.equal(response.status, 200);
    assert.deepEqual(view(response).scenarios, ['overheat', 'both']);
    assert.equal(existsSync(join(dir, 'hot.json')), false);
    assertEnvelope(await del(call, 'hot'), 404, /Unknown scenario "hot"/);
    assertEnvelope(await post(call, '/api/scenarios/hot/run'), 404);
  });

  it('deletes an imported scenario without touching the disk', async () => {
    const { call, dir } = await withFolder();
    assert.equal((await post(call, '/api/scenarios/import', hot)).status, 201);

    const response = await del(call, 'hot');

    assert.equal(response.status, 200);
    assert.deepEqual(view(response).scenarios, ['overheat', 'both']);
    assert.equal(existsSync(dir), false);
  });

  it('lists PUT and DELETE as the methods of a scenario’s path', async () => {
    const { call } = await setup();
    for (const method of ['GET', 'POST']) {
      const response = await call(method, '/api/scenarios/overheat');
      assertEnvelope(response, 405);
      assert.equal(response.headers?.Allow, 'PUT, DELETE', method);
    }
  });
});

describe('reset and step', () => {
  it('reset clears anomalies and held values', async () => {
    const { call } = await setup();
    await call('POST', '/api/anomalies', {
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      value: 30,
      duration: 10,
    });
    await call('PUT', '/api/devices/dc-env-01/holds/temperature_c', { value: 31 });

    const response = await call('POST', '/api/reset');

    assert.equal(response.status, 200);
    assert.deepEqual(view(response).engine.anomalies, []);
    assert.deepEqual(device(response, 'dc-env-01')?.holds, {});
  });

  it('step sends exactly one tick on the simulated clock', async () => {
    const { call, publisher } = await setup();
    const before = publisher.sent.length; // the first tick, sent by start()
    assert.equal(before, 3);

    const response = await call('POST', '/api/step');

    assert.equal(response.status, 200);
    assert.equal(publisher.sent.length, 6);
    assert.equal(device(response, 'dc-env-01')?.seq, 2);
  });

  it('step answers 409 on the wall clock and when the engine is not started', async () => {
    const wall = await setup({ wallClock: true });
    assertEnvelope(await wall.call('POST', '/api/step'), 409, /simulated clock/);

    const idle = await setup({ started: false });
    assertEnvelope(await idle.call('POST', '/api/step'), 409, /not started/);
  });
});

describe('GET /api/observations', () => {
  async function withEvents(count: number) {
    const ctx = await setup();
    for (let i = 1; i <= count; i++) {
      ctx.store.append({ kind: 'engine-state', data: { n: i } }, '2026-10-01T05:00:00.000Z');
    }
    return ctx;
  }

  it('pages the store newest first, with the next cursor in X-Next-Cursor, as ingest pages its alerts', async () => {
    const { call } = await withEvents(5);

    const first = await call('GET', '/api/observations?limit=2');
    assert.deepEqual(
      (first.body as { id: number }[]).map((e) => e.id),
      [5, 4],
    );
    assert.equal(first.headers?.['X-Next-Cursor'], '4');

    const second = await call('GET', '/api/observations?limit=2&before=4');
    assert.deepEqual(
      (second.body as { id: number }[]).map((e) => e.id),
      [3, 2],
    );
    assert.equal(second.headers?.['X-Next-Cursor'], '2');

    const last = await call('GET', '/api/observations?limit=2&before=2');
    assert.deepEqual(
      (last.body as { id: number }[]).map((e) => e.id),
      [1],
    );
    assert.equal(last.headers, undefined);
  });

  it('defaults to 100 events', async () => {
    const { call } = await withEvents(120);
    const response = await call('GET', '/api/observations');
    assert.equal((response.body as unknown[]).length, 100);
    assert.equal(response.headers?.['X-Next-Cursor'], '21');
  });

  it('refuses a limit or a cursor that is not a whole number in range', async () => {
    const { call } = await withEvents(1);
    for (const query of [
      'limit=0',
      'limit=501',
      'limit=abc',
      'limit=1.5',
      'before=0',
      'before=-1',
      'before=x',
    ]) {
      assertEnvelope(await call('GET', `/api/observations?${query}`), 400);
    }
  });
});

describe('routing and errors', () => {
  it('answers 404 in the error envelope for a path it does not have', async () => {
    const { call } = await setup();
    assertEnvelope(await call('GET', '/api/nothing'), 404, /No such route/);
    assertEnvelope(await call('GET', '/'), 404);
    assertEnvelope(await call('GET', '/api/state/'), 404);
  });

  it('answers 405 with Allow when the path exists for another method', async () => {
    const { call } = await setup();
    const response = await call('GET', '/api/reset');
    assertEnvelope(response, 405);
    assert.equal(response.headers?.Allow, 'POST');

    const holds = await call('POST', '/api/devices/dc-env-01/holds/temperature_c');
    assert.equal(holds.status, 405);
    assert.equal(holds.headers?.Allow, 'PUT, DELETE');
  });

  it('refuses a path that is not valid percent-encoding', async () => {
    const { call } = await setup();
    assertEnvelope(await call('POST', '/api/devices/%E0%A4%A/start'), 400, /percent-encoding/);
  });

  it('decodes an encoded device id', async () => {
    const { call } = await setup();
    assert.equal((await call('POST', '/api/devices/dc%2Denv-01/pause')).status, 200);
  });

  it("turns an error that is not the caller's input into a 500 without its message", async () => {
    const { context } = await setup();
    const broken = createRoutes({
      ...context,
      ingest: {
        ...INGEST,
        state: () => {
          throw new TypeError('secret detail');
        },
      },
    });
    const response = await broken({
      method: 'GET',
      path: '/api/state',
      query: new URLSearchParams(),
      body: undefined,
    });
    assertEnvelope(response, 500, /^Internal error$/);
  });
});

describe('the state view and the fixture of the UI', () => {
  // apps/simulator-ui types the state it reads against this file (a real GET /api/state body); if the
  // simulator changes the keys of the state view, this fails until the file and the UI's types follow.
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../simulator-ui/src/api/fixtures/state-view.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;
  const keys = (value: unknown) => Object.keys(value as object).sort();

  it('has the same keys, section by section', async () => {
    const { context } = await setup();
    const actual = buildStateView(context) as unknown as Record<string, unknown>;

    assert.deepEqual(keys(actual), keys(fixture), 'the state view');
    for (const section of ['engine', 'broker', 'ingest', 'alerts', 'metrics', 'rules', 'config']) {
      assert.deepEqual(keys(actual[section]), keys(fixture[section]), section);
    }
    const first = (view: Record<string, unknown>, section: string) =>
      (view[section] as { devices: unknown[] }).devices[0];
    assert.deepEqual(
      keys(first(actual, 'engine')),
      keys(first(fixture, 'engine')),
      'engine.devices[0]',
    );
    const rule = (view: Record<string, unknown>) => (view.rules as { items: unknown[] }).items[0];
    assert.deepEqual(keys(rule(actual)), keys(rule(fixture)), 'rules.items[0]');
  });

  it('has the same keys in a metric profile as the fixture, and an entry for every device of the fixture', async () => {
    const { context } = await setup();
    const actual = buildStateView(context).profiles;
    const profiles = fixture.profiles as StateView['profiles'];
    const firstProfile = (all: StateView['profiles']) => {
      const [byMetric] = Object.values(all);
      const [profile] = Object.values(byMetric ?? {});
      return profile;
    };
    assert.deepEqual(keys(firstProfile(actual)), keys(firstProfile(profiles)), 'profiles');
    const fixtureDevices = (fixture.devices as { id: string }[]).map((d) => d.id).sort();
    assert.deepEqual(Object.keys(profiles).sort(), fixtureDevices, 'profiles by device');
  });

  it('describes the devices with the fields of the registry (the name is optional here)', async () => {
    const { context } = await setup();
    const fromFixture = keys((fixture.devices as unknown[])[0]).filter((key) => key !== 'name');
    assert.deepEqual(keys(buildStateView(context).devices[0]), fromFixture);
  });
});

const RUN_AT = '2026-10-20T08:00:00.000Z';
const at = (secondsAfterRun: number) =>
  new Date(Date.parse(RUN_AT) + secondsAfterRun * 1000).toISOString();

const wireAlert = (overrides: Partial<IngestAlert> = {}): IngestAlert => ({
  id: '7',
  deviceId: 'dc-env-01',
  ruleId: 'server-room-hot',
  metric: 'temperature_c',
  severity: 'high',
  title: 'Server room temperature high',
  status: 'open',
  openedAt: at(44),
  openedValue: 29.3,
  clearedAt: null,
  clearedValue: null,
  externalRef: null,
  deliveryStatus: 'pending',
  deliveryAttempts: 0,
  deliveryError: null,
  ...overrides,
});

/** The routes with a fake ingest that serves the page it is told to, or throws the error it is told to. */
async function setupAlerts(options: { wallClock?: boolean } = {}) {
  const base = await setup({ wallClock: options.wallClock ?? false });
  const queries: AlertsPageQuery[] = [];
  const answer: { page: AlertsPage | Error } = { page: { alerts: [], next: null } };
  const observer = new AlertObserver();
  const handle = createRoutes({
    ...base.context,
    ingest: {
      ...INGEST,
      alertsPage: (query) => {
        queries.push(query);
        return answer.page instanceof Error
          ? Promise.reject(answer.page)
          : Promise.resolve(answer.page);
      },
      observedAlert: (id) => observer.get(id),
    },
  });
  const call = (method: string, path: string): Promise<RouteResponse> => {
    const url = new URL(path, 'http://localhost');
    return handle({ method, path: url.pathname, query: url.searchParams, body: undefined });
  };
  /** A scenario run as the route records it: the run endpoint's `startAt` already has the offset added. */
  const recordRun = (
    name = 'overheat',
    anomalies = [
      { id: 'a1', deviceId: 'dc-env-01', metric: 'temperature_c', startAt: 20, duration: 60 },
    ],
  ) =>
    base.store.append(
      {
        kind: 'scenario-run',
        data: { name, anomalyIds: anomalies.map((a) => a.id), offsetS: 0, anomalies },
      },
      RUN_AT,
    );
  return { ...base, call, queries, answer, observer, recordRun };
}

const paged = (response: RouteResponse) => response.body as PagedAlert[];

describe('GET /api/alerts', () => {
  it('asks ingest for what the query says and answers its page with its cursor unchanged', async () => {
    const { call, queries, answer } = await setupAlerts();
    answer.page = { alerts: [wireAlert({ id: '9' })], next: 'eyJ0IjoiMjAyNiJ9' };

    const response = await call('GET', '/api/alerts?status=open&limit=5&before=abc%2B%2Fdef');

    assert.equal(response.status, 200);
    assert.deepEqual(queries, [{ status: 'open', limit: 5, before: 'abc+/def' }]);
    assert.deepEqual(response.headers, { 'X-Next-Cursor': 'eyJ0IjoiMjAyNiJ9' });
    assert.deepEqual(
      paged(response).map((a) => a.id),
      ['9'],
    );
  });

  it('sends no query part that the caller left out, and no header on the last page', async () => {
    const { call, queries, answer } = await setupAlerts();
    answer.page = { alerts: [wireAlert()], next: null };

    const response = await call('GET', '/api/alerts');

    assert.deepEqual(queries, [{}]);
    assert.equal(response.headers, undefined);
  });

  it('refuses a query ingest would refuse, before asking ingest', async () => {
    const { call, queries } = await setupAlerts();
    assertEnvelope(await call('GET', '/api/alerts?status=closed'), 400, /"status"/);
    assertEnvelope(await call('GET', '/api/alerts?limit=0'), 400, /"limit"/);
    assertEnvelope(await call('GET', '/api/alerts?limit=201'), 400, /"limit"/);
    assertEnvelope(await call('GET', '/api/alerts?limit=ten'), 400, /"limit"/);
    assertEnvelope(await call('GET', '/api/alerts?before='), 400, /"before"/);
    assertEnvelope(await call('GET', `/api/alerts?before=${'x'.repeat(201)}`), 400, /"before"/);
    assert.deepEqual(queries, []);
  });

  it('accepts the edges: limit 1 and 200, a cursor of 200 characters; and ignores unknown parameters', async () => {
    const { call, queries } = await setupAlerts();
    assert.equal((await call('GET', '/api/alerts?limit=1')).status, 200);
    assert.equal((await call('GET', '/api/alerts?limit=200')).status, 200);
    assert.equal((await call('GET', `/api/alerts?before=${'x'.repeat(200)}`)).status, 200);
    assert.equal((await call('GET', '/api/alerts?severity=high&page=2')).status, 200);
    assert.deepEqual(queries.at(-1), {});
  });

  it('answers 400 with ingest’s message when ingest refuses, and 502 when it gives no page', async () => {
    const { call, answer } = await setupAlerts();
    answer.page = new IngestReadError('refused', 'bad cursor');
    assertEnvelope(await call('GET', '/api/alerts?before=zzz'), 400, /^bad cursor$/);

    answer.page = new IngestReadError('unreachable', 'ECONNREFUSED');
    const response = await call('GET', '/api/alerts');
    assertEnvelope(response, 502, /^ECONNREFUSED$/);
    assert.equal((response.body as { error: string }).error, 'Bad Gateway');
  });

  it('turns an error that is not ingest’s into a 500 without its message', async () => {
    const { call, answer } = await setupAlerts();
    answer.page = new TypeError('secret detail');
    assertEnvelope(await call('GET', '/api/alerts'), 500, /^Internal error$/);
  });

  it('adds what Studio saw to an alert it tracked, and nothing invented to one it did not', async () => {
    const { call, answer, observer } = await setupAlerts();
    observer.observe([], at(10));
    observer.observe([wireAlert({ id: '7' })], at(46));
    answer.page = { alerts: [wireAlert({ id: '7' }), wireAlert({ id: '3' })], next: null };

    const [tracked, untracked] = paged(await call('GET', '/api/alerts'));

    assert.equal(tracked?.preexisting, false);
    assert.equal(tracked?.observed.openedAt, at(46));
    assert.equal(untracked?.preexisting, true);
    assert.deepEqual(untracked?.observed, {
      openedAt: null,
      clearedAt: null,
      delivered: { opened: null, cleared: null },
      incident: null,
    });
  });

  it('takes the alert’s own fields from the page, which is fresher than what Studio kept', async () => {
    const { call, answer, observer } = await setupAlerts();
    observer.observe([], at(10));
    observer.observe([wireAlert({ status: 'open' })], at(46));
    answer.page = {
      alerts: [wireAlert({ status: 'cleared', clearedAt: at(90), clearedValue: 25.1 })],
      next: null,
    };

    const [alert] = paged(await call('GET', '/api/alerts'));

    assert.equal(alert?.status, 'cleared');
    assert.equal(alert?.clearedValue, 25.1);
  });

  it('does not hand out the observer’s own objects', async () => {
    const { call, answer, observer } = await setupAlerts();
    observer.observe([], at(10));
    observer.observe([wireAlert()], at(46));
    answer.page = { alerts: [wireAlert()], next: null };

    const [first] = paged(await call('GET', '/api/alerts'));
    assert.ok(first);
    first.observed.delivered.opened = 'tampered';

    assert.equal(observer.get('7')?.observed.delivered.opened, null);
  });
});

describe('GET /api/alerts: the cause', () => {
  it('names the scenario Studio started when its anomaly played on the alert’s device and metric', async () => {
    const { call, answer, recordRun } = await setupAlerts({ wallClock: true });
    recordRun();
    answer.page = { alerts: [wireAlert({ openedAt: at(44) })], next: null };

    const [alert] = paged(await call('GET', '/api/alerts'));

    assert.deepEqual(alert?.cause, { scenario: 'overheat', startedAt: RUN_AT });
  });

  it('claims no cause for an alert raised by anything else', async () => {
    const { call, answer, recordRun } = await setupAlerts({ wallClock: true });
    // No run at all: the CLI’s --scenario and a hand-added anomaly leave none.
    answer.page = { alerts: [wireAlert()], next: null };
    assert.equal(paged(await call('GET', '/api/alerts'))[0]?.cause, null);

    // A run, but on another device, on another metric, or long before the alert.
    recordRun();
    answer.page = {
      alerts: [
        wireAlert({ id: '1', deviceId: 'dc-env-02' }),
        wireAlert({ id: '2', metric: 'humidity_pct' }),
        wireAlert({ id: '3', openedAt: at(600) }),
      ],
      next: null,
    };
    assert.deepEqual(
      paged(await call('GET', '/api/alerts')).map((a) => a.cause),
      [null, null, null],
    );
  });

  it('still names the scenario after a reset: the run holds its anomalies, not the engine', async () => {
    const { call, answer, recordRun } = await setupAlerts({ wallClock: true });
    recordRun();
    await call('POST', '/api/reset');
    answer.page = { alerts: [wireAlert()], next: null };

    assert.equal(paged(await call('GET', '/api/alerts'))[0]?.cause?.scenario, 'overheat');
  });

  it('never names one on a simulated engine, whose clock is not wall time', async () => {
    const { call, answer, recordRun } = await setupAlerts();
    recordRun();
    answer.page = { alerts: [wireAlert()], next: null };

    assert.equal(paged(await call('GET', '/api/alerts'))[0]?.cause, null);
  });

  it('ignores a run recorded before runs carried their anomalies', async () => {
    const { call, answer, store } = await setupAlerts({ wallClock: true });
    store.append(
      { kind: 'scenario-run', data: { name: 'old', anomalyIds: ['a1'], offsetS: 0 } },
      RUN_AT,
    );
    answer.page = { alerts: [wireAlert()], next: null };

    assert.equal(paged(await call('GET', '/api/alerts'))[0]?.cause, null);
  });
});

describe('GET /api/alerts and the fixture of the UI', () => {
  // apps/simulator-ui types the alerts it reads against this file (a real body of this route); if the route
  // changes the keys of an alert, this fails until the file and the UI's types follow.
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../simulator-ui/src/api/fixtures/alerts-page.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>[];
  const keys = (value: unknown) => Object.keys(value as object).sort();

  it('has the same keys as the fixture, whether the alert was tracked or not', async () => {
    const { call, answer, observer, recordRun } = await setupAlerts({ wallClock: true });
    recordRun();
    observer.observe([], at(10));
    observer.observe([wireAlert({ id: '7' })], at(46));
    answer.page = { alerts: [wireAlert({ id: '7' }), wireAlert({ id: '6' })], next: null };

    const actual = paged(await call('GET', '/api/alerts')) as unknown as Record<string, unknown>[];

    assert.equal(actual.length, fixture.length);
    for (const [i, alert] of actual.entries()) {
      assert.deepEqual(keys(alert), keys(fixture[i]), `alert ${i}`);
      assert.deepEqual(keys(alert.observed), keys(fixture[i]?.observed), `alert ${i}: observed`);
      assert.deepEqual(
        keys((alert.observed as { delivered: unknown }).delivered),
        keys((fixture[i]?.observed as { delivered: unknown }).delivered),
        `alert ${i}: observed.delivered`,
      );
    }
    // The fixture shows a cause in one alert and none in the other; the keys of a cause are the route's.
    assert.deepEqual(keys(actual[0]?.cause), keys(fixture[0]?.cause));
    assert.equal(fixture[1]?.cause, null);
  });
});

describe('GET /api/scenarios and the fixture of the UI', () => {
  // apps/simulator-ui types the library it reads against this file (a real GET /api/scenarios body); if the
  // simulator changes the keys of the library read, this fails until the file and the UI's types follow.
  interface Library {
    scenarios: {
      anomalies: unknown[];
      needsStart: unknown[];
      expected: {
        alerts: unknown[];
        quiet: unknown[];
        series: unknown[];
      };
    }[];
    rejected: unknown[];
  }
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../simulator-ui/src/api/fixtures/scenarios.json', import.meta.url),
      'utf8',
    ),
  ) as Library;
  const keys = (value: unknown) => Object.keys(value as object).sort();

  it('has the same keys as the fixture, section by section', async () => {
    const { call } = await setup();
    await call('POST', '/api/devices/dc-env-01/stop'); // so that a scenario has a device to start
    const actual = (await call('GET', '/api/scenarios')).body as Library;
    const [overheat, both] = actual.scenarios;
    const [fixtureOverheat, , fixtureAfternoon] = fixture.scenarios;

    assert.deepEqual(keys(actual), keys(fixture), 'the library read');
    assert.deepEqual(keys(overheat), keys(fixtureOverheat), 'an item');
    assert.deepEqual(keys(overheat?.anomalies[0]), keys(fixtureOverheat?.anomalies[0]), 'anomaly');
    assert.deepEqual(keys(overheat?.expected), keys(fixtureOverheat?.expected), 'expected');
    assert.deepEqual(
      keys(overheat?.expected.alerts[0]),
      keys(fixtureOverheat?.expected.alerts[0]),
      'an expected alert',
    );
    assert.deepEqual(
      keys(overheat?.expected.series[0]),
      keys(fixtureOverheat?.expected.series[0]),
      'a series',
    );
    assert.deepEqual(
      keys(both?.expected.quiet[0]),
      keys(fixtureAfternoon?.expected.quiet[0]),
      'a quiet anomaly',
    );
    assert.deepEqual(
      keys(overheat?.needsStart[0]),
      keys(fixtureAfternoon?.needsStart[0]),
      'a device to start',
    );
    // No file is rejected in this setup, so the entry is checked against what the library defines.
    assert.deepEqual(keys(fixture.rejected[0]), ['file', 'reason']);
  });

  it('has the keys the UI expects when the rules are not available', async () => {
    const { call } = await setup({ rules: rulesUnavailable('cannot read rules.json (ENOENT)') });
    const actual = (await call('GET', '/api/scenarios')).body as Library;
    assert.deepEqual(keys(actual.scenarios[0]?.expected), ['available', 'reason']);
  });
});

describe('GET /api/observations and the fixture of the UI', () => {
  // apps/simulator-ui types the observation log it reads against this file (a real GET /api/observations body, one event
  // of every kind); if the store changes the keys of an event or gains a kind, this fails until the file and the UI follow.
  interface Event {
    id: number;
    at: string;
    kind: string;
    data: Record<string, unknown>;
  }
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../simulator-ui/src/api/fixtures/observations.json', import.meta.url),
      'utf8',
    ),
  ) as Event[];
  // Exhaustive by type: a new `ObservationKind` is a compile error here until it has a fixture event.
  const KINDS = {
    'engine-state': true,
    'tick-error': true,
    'scenario-run': true,
    'scenario-stop': true,
    'alert-opened': true,
    'alert-cleared': true,
    delivery: true,
    incident: true,
    dependency: true,
  } satisfies Record<ObservationKind, true>;

  it('has one event of every kind, oldest id last', () => {
    assert.deepEqual(fixture.map((event) => event.kind).sort(), Object.keys(KINDS).sort());
    assert.deepEqual(
      fixture.map((event) => event.id),
      [...fixture.map((event) => event.id)].sort((a, b) => b - a),
    );
  });

  it('answers the fixture back, key for key, for the events it holds', async () => {
    const { call, store } = await setup();
    for (const event of [...fixture].reverse()) {
      store.append({ kind: event.kind as ObservationKind, data: event.data }, event.at);
    }
    const response = await call('GET', '/api/observations');
    assert.deepEqual(response.body, fixture);
    assert.equal(response.headers, undefined);
  });
});

/** Records what it is asked to do; either direction can be made to fail. */
class FakeLink implements LinkControl {
  readonly calls: string[] = [];
  failCut = false;
  failRestore = false;

  async cut(): Promise<void> {
    if (this.failCut) throw new Error('end failed');
    this.calls.push('cut');
  }

  async restore(): Promise<void> {
    if (this.failRestore) throw new Error('no answer from the broker');
    this.calls.push('restore');
  }
}

const faults = (response: RouteResponse) => view(response).engine.faults;
const counter = (name: string, value: number, labels: Record<string, string> = {}) => ({
  name,
  labels,
  value,
});

describe('PUT and DELETE /api/faults/:kind', () => {
  it('switches a fault on with its settings and answers the state view', async () => {
    const { call, engine } = await setup();
    const response = await call('PUT', '/api/faults/drop', { percent: 5 });

    assert.equal(response.status, 200);
    assert.deepEqual(faults(response).drop, { percent: 5 });
    assert.equal(faults(response).activeCount, 1);
    assert.deepEqual(engine.snapshot().faults.drop, { percent: 5 });
  });

  it('takes the settings of each kind, and a second PUT changes them', async () => {
    const { call } = await setup();
    assert.deepEqual(faults(await call('PUT', '/api/faults/duplicate', { percent: 2 })).duplicate, {
      percent: 2,
    });
    assert.deepEqual(
      faults(await call('PUT', '/api/faults/delay', { delayMs: 800, jitterMs: 200 })).delay,
      { delayMs: 800, jitterMs: 200 },
    );
    assert.deepEqual(faults(await call('PUT', '/api/faults/delay', { delayMs: 100 })).delay, {
      delayMs: 100,
      jitterMs: 0,
    });
    assert.deepEqual(faults(await call('PUT', '/api/faults/reorder', { window: 4 })).reorder, {
      window: 4,
    });
    assert.deepEqual(
      faults(await call('PUT', '/api/faults/malformed', { percent: 3, kinds: ['range', 'json'] }))
        .malformed,
      { percent: 3, kinds: ['range', 'json'] },
    );
    assert.deepEqual(faults(await call('PUT', '/api/faults/malformed', { percent: 3 })).malformed, {
      percent: 3,
      kinds: ['range'],
    });
  });

  it('names the field it refuses, and changes nothing', async () => {
    const { call, engine } = await setup();
    assertEnvelope(await call('PUT', '/api/faults/drop', { percent: 0 }), 400, /"percent"/);
    assertEnvelope(await call('PUT', '/api/faults/drop', {}), 400, /"percent"/);
    assertEnvelope(await call('PUT', '/api/faults/drop'), 400, /"percent"/);
    assertEnvelope(await call('PUT', '/api/faults/drop', { percent: 5, x: 1 }), 400, /"x"/);
    assertEnvelope(await call('PUT', '/api/faults/drop', [5]), 400, /JSON object/);
    assertEnvelope(
      await call('PUT', '/api/faults/delay', { delayMs: 10, jitterMs: 50 }),
      400,
      /"jitterMs"/,
    );
    assertEnvelope(await call('PUT', '/api/faults/reorder', { window: 1 }), 400, /"window"/);
    assertEnvelope(
      await call('PUT', '/api/faults/malformed', { percent: 3, kinds: ['future'] }),
      400,
      /"kinds"/,
    );
    assert.equal(engine.snapshot().faults.activeCount, 0);
  });

  it('answers 404 for a fault that does not exist', async () => {
    const { call } = await setup();
    assertEnvelope(
      await call('PUT', '/api/faults/telepathy', { percent: 5 }),
      404,
      /No such route/,
    );
    assertEnvelope(await call('DELETE', '/api/faults/telepathy'), 404, /No such route/);
  });

  it('switches a fault off, and it is harmless to do so twice', async () => {
    const { call } = await setup();
    await call('PUT', '/api/faults/drop', { percent: 5 });
    const off = await call('DELETE', '/api/faults/drop');
    assert.equal(off.status, 200);
    assert.equal(faults(off).drop, null);
    assert.equal(faults(off).activeCount, 0);
    assert.equal((await call('DELETE', '/api/faults/drop')).status, 200);
  });

  it('refuses the wrong method with the methods that fit', async () => {
    const { call } = await setup();
    for (const [method, path, allow] of [
      ['GET', '/api/faults/drop', 'PUT, DELETE'],
      ['POST', '/api/faults/link-loss', 'PUT, DELETE'],
      ['GET', '/api/faults', 'DELETE'],
      ['PUT', '/api/faults', 'DELETE'],
      ['GET', '/api/faults/scope', 'PUT'],
      ['DELETE', '/api/faults/scope', 'PUT'],
      ['PUT', '/api/faults/burst', 'POST'],
      ['GET', '/api/faults/effect/reset', 'POST'],
    ] as const) {
      const response = await call(method, path);
      assertEnvelope(response, 405);
      assert.equal(response.headers?.Allow, allow, `${method} ${path}`);
    }
  });

  it('leaves the faults on when the anomalies and held values are reset', async () => {
    const { call } = await setup();
    await call('PUT', '/api/faults/drop', { percent: 5 });
    const response = await call('POST', '/api/reset');
    assert.deepEqual(faults(response).drop, { percent: 5 });
  });
});

describe('PUT /api/faults/scope', () => {
  it('selects devices, and goes back to all running', async () => {
    const { call } = await setup();
    const selected = await call('PUT', '/api/faults/scope', {
      mode: 'selected',
      deviceIds: ['dc-env-01', 'lib-air-01'],
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(faults(selected).scope, {
      mode: 'selected',
      deviceIds: ['dc-env-01', 'lib-air-01'],
    });
    assert.equal(faults(selected).deviceCount, 2);

    const running = await call('PUT', '/api/faults/scope', { mode: 'running' });
    assert.deepEqual(faults(running).scope, { mode: 'running' });
  });

  it('answers 404 for a device the registry does not have, and 400 for a body that is no scope', async () => {
    const { call, engine } = await setup();
    assertEnvelope(
      await call('PUT', '/api/faults/scope', { mode: 'selected', deviceIds: ['ghost'] }),
      404,
      /Unknown device "ghost"/,
    );
    assertEnvelope(
      await call('PUT', '/api/faults/scope', { mode: 'selected' }),
      400,
      /"deviceIds"/,
    );
    assertEnvelope(await call('PUT', '/api/faults/scope', { mode: 'some' }), 400, /"mode"/);
    assertEnvelope(await call('PUT', '/api/faults/scope'), 400, /"mode"/);
    assert.deepEqual(engine.snapshot().faults.scope, { mode: 'running' });
  });

  it('is what the switches act on', async () => {
    const { call, publisher } = await setup();
    await call('PUT', '/api/faults/scope', { mode: 'selected', deviceIds: ['dc-env-01'] });
    await call('PUT', '/api/faults/drop', { percent: 100 });
    await call('POST', '/api/step');
    const sentBy = (id: string) => publisher.sent.filter((m) => m.topic.includes(id)).length;
    assert.equal(sentBy('dc-env-01'), 1);
    assert.equal(sentBy('dc-env-02'), 2);
  });
});

describe('DELETE /api/faults', () => {
  it('clears every fault, keeps the scope, and answers the state view', async () => {
    const { call } = await setup();
    await call('PUT', '/api/faults/scope', { mode: 'selected', deviceIds: ['dc-env-01'] });
    await call('PUT', '/api/faults/drop', { percent: 5 });
    await call('PUT', '/api/faults/delay', { delayMs: 500 });
    await call('PUT', '/api/faults/reorder', { window: 3 });

    const response = await call('DELETE', '/api/faults');

    assert.equal(response.status, 200);
    const cleared = faults(response);
    assert.equal(cleared.activeCount, 0);
    assert.equal(cleared.held, 0);
    assert.deepEqual([cleared.drop, cleared.delay, cleared.reorder], [null, null, null]);
    assert.deepEqual(cleared.scope, { mode: 'selected', deviceIds: ['dc-env-01'] });
  });

  it('sends what delay was holding, once', async () => {
    const { call, publisher } = await setup();
    await call('PUT', '/api/faults/delay', { delayMs: 5000 });
    await call('POST', '/api/step');
    const before = publisher.sent.length; // the first tick; the second is held
    assert.equal(faults(await call('GET', '/api/state')).held, 3);

    const response = await call('DELETE', '/api/faults');

    assert.equal(publisher.sent.length, before + 3);
    assert.equal(faults(response).held, 0);
  });

  it('answers 500 with the reason when the link cannot be restored, after clearing the rest', async () => {
    const link = new FakeLink();
    const { call, engine } = await setup({ link });
    await call('PUT', '/api/faults/drop', { percent: 5 });
    await call('PUT', '/api/faults/link-loss');
    link.failRestore = true;

    const response = await call('DELETE', '/api/faults');

    assertEnvelope(response, 500, /link could not be restored: no answer from the broker/);
    assert.equal(engine.snapshot().faults.drop, null);
  });
});

describe('POST /api/faults/burst', () => {
  it('sends the messages and answers how many went, with the state view', async () => {
    const { call, publisher } = await setup();
    const before = publisher.sent.length;
    const response = await call('POST', '/api/faults/burst', { count: 12 });

    assert.equal(response.status, 200);
    const body = response.body as { sent: number; failed: number } & StateView;
    assert.equal(body.sent, 12);
    assert.equal(body.failed, 0);
    assert.equal(publisher.sent.length - before, 12);
    assert.ok(body.engine.devices.every((d) => d.seq > 1));
  });

  it('names the field it refuses', async () => {
    const { call } = await setup();
    for (const body of [{}, { count: 0 }, { count: 5001 }, { count: 1.5 }, { count: '5' }]) {
      assertEnvelope(await call('POST', '/api/faults/burst', body), 400, /"count"/);
    }
    assertEnvelope(await call('POST', '/api/faults/burst', { count: 5, x: 1 }), 400, /"x"/);
    assertEnvelope(await call('POST', '/api/faults/burst'), 400, /"count"/);
  });

  it('answers 400 when the devices in scope cannot space that many, and 409 when it cannot be sent now', async () => {
    const { call } = await setup();
    await call('PUT', '/api/faults/scope', { mode: 'selected', deviceIds: ['dc-env-01'] });
    assertEnvelope(await call('POST', '/api/faults/burst', { count: 2000 }), 400, /smaller count/);

    const idle = await setup({ started: false });
    assertEnvelope(await idle.call('POST', '/api/faults/burst', { count: 5 }), 409, /not started/);

    const down = await setup({ link: new FakeLink() });
    await down.call('PUT', '/api/faults/link-loss');
    assertEnvelope(await down.call('POST', '/api/faults/burst', { count: 5 }), 409, /link/);
  });

  it('ignores the switches that are on', async () => {
    const { call, publisher } = await setup();
    await call('PUT', '/api/faults/drop', { percent: 100 });
    const before = publisher.sent.length;
    await call('POST', '/api/faults/burst', { count: 6 });
    assert.equal(publisher.sent.length - before, 6);
  });
});

describe('link loss over the API', () => {
  it('cuts the link, says so in the state, and restores it', async () => {
    const link = new FakeLink();
    const { call } = await setup({ link });

    const cut = await call('PUT', '/api/faults/link-loss', { forS: 30 });
    assert.equal(cut.status, 200);
    assert.deepEqual(faults(cut).linkLoss, { since: new Date(T0).toISOString(), forS: 30 });
    assert.equal(faults(cut).activeCount, 1);

    const restored = await call('DELETE', '/api/faults/link-loss');
    assert.equal(restored.status, 200);
    assert.equal(faults(restored).linkLoss, null);
    assert.deepEqual(link.calls, ['cut', 'restore']);
  });

  it('takes no body, and refuses a bad forS', async () => {
    const { call } = await setup({ link: new FakeLink() });
    assertEnvelope(await call('PUT', '/api/faults/link-loss', { forS: 0 }), 400, /"forS"/);
    assertEnvelope(await call('PUT', '/api/faults/link-loss', { x: 1 }), 400, /"x"/);
    assert.equal((await call('PUT', '/api/faults/link-loss')).status, 200);
  });

  it('answers 409 when there is no link to cut, and when it is already down', async () => {
    const bare = await setup();
    assertEnvelope(await bare.call('PUT', '/api/faults/link-loss'), 409, /no broker link/);

    const { call } = await setup({ link: new FakeLink() });
    await call('PUT', '/api/faults/link-loss');
    assertEnvelope(await call('PUT', '/api/faults/link-loss'), 409, /already down/);
  });

  it('answers 500 with the reason when the link cannot be cut or restored, and leaves the state true', async () => {
    const link = new FakeLink();
    const { call, engine } = await setup({ link });
    link.failCut = true;
    assertEnvelope(
      await call('PUT', '/api/faults/link-loss'),
      500,
      /link could not be cut: end failed/,
    );
    assert.equal(engine.snapshot().faults.linkLoss, null);

    link.failCut = false;
    await call('PUT', '/api/faults/link-loss');
    link.failRestore = true;
    assertEnvelope(
      await call('DELETE', '/api/faults/link-loss'),
      500,
      /link could not be restored/,
    );
    assert.notEqual(engine.snapshot().faults.linkLoss, null);
  });

  it('drops the messages built while it is down', async () => {
    const { call, publisher } = await setup({ link: new FakeLink() });
    await call('PUT', '/api/faults/link-loss');
    const before = publisher.sent.length;
    await call('POST', '/api/step');
    assert.equal(publisher.sent.length, before);
  });
});

describe('the effect session over the API', () => {
  const baseline = [
    counter('telemetry_sequence_gaps_total', 4),
    counter('telemetry_rejections_total', 2, { reason: 'range' }),
    counter('telemetry_ingest_lag_seconds_sum', 9),
  ];

  it('is null until a fault is switched on, and the state says so', async () => {
    const { call } = await setup();
    const state = await call('GET', '/api/state');
    assert.equal(view(state).faultEffect, null);
  });

  it('starts with the first fault, from the counters read before it, and keeps them for the second', async () => {
    const { call, feed } = await setup();
    feed.current = { samples: baseline, lastOkAt: '2026-10-01T05:00:01.000Z', stale: false };
    const first = await call('PUT', '/api/faults/drop', { percent: 5 });
    assert.deepEqual(view(first).faultEffect, {
      since: new Date(T0 + 5000).toISOString(),
      baseline: [baseline[0], baseline[1]],
    });

    feed.current = {
      samples: [counter('telemetry_sequence_gaps_total', 99)],
      lastOkAt: 'x',
      stale: false,
    };
    const second = await call('PUT', '/api/faults/duplicate', { percent: 2 });
    assert.deepEqual(view(second).faultEffect?.baseline, [baseline[0], baseline[1]]);
  });

  it('starts with a burst as well, and with link loss', async () => {
    const burst = await setup();
    await burst.call('POST', '/api/faults/burst', { count: 4 });
    assert.notEqual(burst.effect.view(), null);

    const link = await setup({ link: new FakeLink() });
    await link.call('PUT', '/api/faults/link-loss');
    assert.notEqual(link.effect.view(), null);
  });

  it('is not started by a command that was refused', async () => {
    const { call, effect } = await setup();
    await call('PUT', '/api/faults/drop', { percent: 0 });
    await call('PUT', '/api/faults/telepathy', { percent: 5 });
    await call('POST', '/api/faults/burst', { count: 0 });
    await call('PUT', '/api/faults/link-loss');
    assert.equal(effect.view(), null);

    await call('PUT', '/api/faults/scope', { mode: 'selected', deviceIds: ['dc-env-01'] });
    assert.equal(effect.view(), null);
  });

  it('has no baseline when ingest has not been read, but still knows when it began', async () => {
    const { call, feed } = await setup();
    feed.current = { samples: baseline, lastOkAt: null, stale: true };
    const response = await call('PUT', '/api/faults/drop', { percent: 5 });
    assert.deepEqual(view(response).faultEffect, {
      since: new Date(T0 + 5000).toISOString(),
      baseline: null,
    });
  });

  it('goes on after Clear all faults, and starts again with the reset', async () => {
    const { call, feed } = await setup();
    feed.current = { samples: baseline, lastOkAt: 'x', stale: false };
    await call('PUT', '/api/faults/drop', { percent: 5 });
    const cleared = await call('DELETE', '/api/faults');
    assert.deepEqual(view(cleared).faultEffect?.baseline, [baseline[0], baseline[1]]);

    feed.current = {
      samples: [counter('telemetry_sequence_gaps_total', 30)],
      lastOkAt: 'x',
      stale: false,
    };
    const reset = await call('POST', '/api/faults/effect/reset');
    assert.equal(reset.status, 200);
    assert.deepEqual(view(reset).faultEffect?.baseline, [
      counter('telemetry_sequence_gaps_total', 30),
    ]);
  });
});
