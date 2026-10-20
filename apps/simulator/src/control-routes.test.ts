import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { systemClock } from './clock.ts';
import {
  buildStateView,
  createRoutes,
  type RouteResponse,
  type RoutesContext,
  type StateView,
} from './control-routes.ts';
import { type ObservationDraft, ObservationStore } from './observation-store.ts';
import { DEVICES, setupEngine } from './test-support.ts';

const SCENARIOS = {
  overheat: ['dc-env-01:temperature_c:29.2:20:60'],
  both: ['dc-env-01:temperature_c:29:20:60', 'lib-air-01:co2_ppm:1450:10:30'],
  broken: ['dc-env-01:temperature_c:29:20:60', 'ghost-01:temperature_c:1:0:5'],
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
};

/** The routes over an engine on a manual clock, started, with the engine's pieces to look at. */
async function setup(options: { started?: boolean; wallClock?: boolean } = {}) {
  const { started = true, wallClock = false } = options;
  const { engine, publisher } = setupEngine(wallClock ? { clock: systemClock } : {});
  if (started && !wallClock) await engine.start();
  const store = new ObservationStore();
  const recorded: ObservationDraft[] = [];
  const context: RoutesContext = {
    engine,
    devices: DEVICES,
    scenarios: SCENARIOS,
    store,
    ingest: INGEST,
    config: { ingestUrl: 'http://localhost:3100', consoleUrl: null },
    record: (draft) => recorded.push(draft),
  };
  const handle = createRoutes(context);
  const call = (method: string, path: string, body?: unknown): Promise<RouteResponse> => {
    const url = new URL(path, 'http://localhost');
    return handle({ method, path: url.pathname, query: url.searchParams, body });
  };
  return { engine, publisher, store, recorded, context, call };
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
    assert.deepEqual(state.scenarios, ['overheat', 'both', 'broken']);
    assert.equal(state.ingest.status, 'ready');
    assert.deepEqual(state.config, {
      ingestUrl: 'http://localhost:3100',
      consoleUrl: null,
      intervalMs: 2000,
      simulated: true,
    });
    assert.equal(state.observationCursor, 0);
  });

  it('is what buildStateView builds, which the stream sends as its first message', async () => {
    const { call, context } = await setup();
    assert.deepEqual((await call('GET', '/api/state')).body, buildStateView(context));
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

describe('scenario commands', () => {
  it('lists the presets with their anomalies', async () => {
    const { call } = await setup();
    const { scenarios } = (await call('GET', '/api/scenarios')).body as {
      scenarios: { name: string; anomalies: { deviceId: string; startAt: number }[] }[];
    };
    assert.deepEqual(
      scenarios.map((s) => s.name),
      ['overheat', 'both', 'broken'],
    );
    assert.equal(scenarios[0]?.anomalies[0]?.deviceId, 'dc-env-01');
    assert.equal(scenarios[0]?.anomalies[0]?.startAt, 20);
  });

  it('runs a preset starting from now: its "20 s in" is 20 s from the click', async () => {
    const { call, engine, recorded } = await setup();
    for (let i = 0; i < 5; i++) await engine.step(); // 10 s in

    const response = await call('POST', '/api/scenarios/both/run');

    assert.equal(response.status, 200);
    assert.deepEqual((response.body as { anomalyIds: string[] }).anomalyIds, ['a1', 'a2']);
    assert.deepEqual(
      engine.snapshot().anomalies.map((a) => [a.id, a.anomaly.startAt, a.anomaly.duration]),
      [
        ['a1', 30, 60],
        ['a2', 20, 30],
      ],
    );
    assert.deepEqual(recorded, [
      { kind: 'scenario-run', data: { name: 'both', anomalyIds: ['a1', 'a2'], offsetS: 10 } },
    ]);
  });

  it('adds nothing when one anomaly of the preset cannot be added', async () => {
    const { call, engine, recorded } = await setup();
    const response = await call('POST', '/api/scenarios/broken/run');

    assertEnvelope(response, 400, /ghost-01/);
    assert.deepEqual(engine.snapshot().anomalies, []);
    assert.deepEqual(recorded, []);
  });

  it('answers 404 for a preset it does not have, including names that exist on every object', async () => {
    const { call } = await setup();
    assertEnvelope(await call('POST', '/api/scenarios/nope/run'), 404, /Unknown scenario "nope"/);
    assertEnvelope(await call('POST', '/api/scenarios/constructor/run'), 404);
    assertEnvelope(await call('POST', '/api/scenarios/__proto__/run'), 404);
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
