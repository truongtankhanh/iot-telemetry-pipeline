import { describe, expect, it, vi } from 'vitest';
import alertsPageFixture from './fixtures/alerts-page.json';
import expectationsFixture from './fixtures/expectations.json';
import observationsFixture from './fixtures/observations.json';
import scenariosFixture from './fixtures/scenarios.json';
import { stateViewFixture as fixture } from './fixtures/stateView';
import {
  addAnomaly,
  ApiError,
  clearFault,
  clearFaults,
  conflictsOf,
  deleteScenario,
  getAlerts,
  getExpected,
  getObservations,
  getScenarios,
  getState,
  holdValue,
  importScenario,
  pauseDevice,
  releaseValue,
  removeAnomaly,
  republishMessage,
  resetEngine,
  resetFaultEffect,
  runScenario,
  saveScenario,
  sendBurst,
  setDeviceInterval,
  setFault,
  setFaultScope,
  startDevice,
  stepEngine,
  stopDevice,
  stopScenario,
} from './client';
import {
  type ExpectationPreview,
  type FaultScope,
  OBSERVATION_KINDS,
  type ScenarioLibraryView,
  type ScenarioRunView,
} from './types';

// A real `GET /api/state` body (see types.ts for how both sides are kept in step).
const view = fixture;
const keys = (value: object) => Object.keys(value).sort();

const reply = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init));

describe('the state fixture', () => {
  it('has the shape Studio reads', () => {
    expect(view.engine.devices.length).toBe(view.devices.length);
    expect(view.devices[0]?.zoneCode).toBe('BLD-DC');
    expect(view.broker).toEqual({ url: 'mqtt://localhost:1883', port: 1883, connected: true });
    expect(view.ingest.status).toBe('ready');
    expect(view.alerts.alerts[0]?.observed.delivered.opened).not.toBeNull();
    expect(view.config.simulated).toBe(true);
    expect(view.scenarios).toEqual(['server-room-overheat', 'crowded-lecture']);
  });

  it('carries the four rules of ingest and a profile for every metric of every device', () => {
    expect(view.rules.available).toBe(true);
    expect(view.rules.reason).toBeNull();
    expect(view.rules.items.map((rule) => rule.id)).toEqual([
      'server-room-hot',
      'server-room-humid',
      'indoor-co2',
      'power-over-contract',
    ]);
    for (const device of view.devices) {
      expect(keys(view.profiles[device.id]!)).toEqual([...device.metrics].sort());
    }
  });
});

describe('the types and the fixture', () => {
  it('declare the same keys, section by section', () => {
    expect(keys(view)).toEqual([
      'alerts',
      'benchmark',
      'broker',
      'config',
      'devices',
      'engine',
      'faultEffect',
      'ingest',
      'metrics',
      'observationCursor',
      'profiles',
      'rules',
      'runs',
      'scenarios',
    ]);
    expect(keys(view.engine)).toEqual([
      'anomalies',
      'devices',
      'elapsedS',
      'faults',
      'intervalMs',
      'nowMs',
      'published',
      'running',
      'simulated',
    ]);
    expect(keys(view.engine.faults)).toEqual(
      [
        'activeCount',
        'bursting',
        'delay',
        'deviceCount',
        'drop',
        'dropped',
        'duplicate',
        'held',
        'linkLoss',
        'malformed',
        'reorder',
        'scope',
      ].sort(),
    );
    expect(keys(view.engine.devices[0]!)).toEqual(['holds', 'id', 'intervalMs', 'seq', 'state']);
    expect(keys(view.devices[0]!)).toEqual(['id', 'kind', 'metrics', 'name', 'zoneCode']);
    expect(keys(view.config)).toEqual(['consoleUrl', 'ingestUrl', 'intervalMs', 'simulated']);
    expect(keys(view.broker)).toEqual(['connected', 'port', 'url']);
    expect(keys(view.ingest)).toEqual([
      'alertSink',
      'broker',
      'database',
      'detail',
      'lastCheckedAt',
      'since',
      'status',
    ]);
    expect(keys(view.alerts)).toEqual(['alerts', 'lastOkAt', 'stale']);
    expect(keys(view.alerts.alerts[0]!)).toEqual(
      [
        'clearedAt',
        'clearedValue',
        'deliveryAttempts',
        'deliveryError',
        'deliveryStatus',
        'deviceId',
        'externalRef',
        'id',
        'metric',
        'observed',
        'openedAt',
        'openedValue',
        'preexisting',
        'ruleId',
        'severity',
        'status',
        'title',
      ].sort(),
    );
    expect(keys(view.alerts.alerts[0]!.observed)).toEqual([
      'clearedAt',
      'delivered',
      'incident',
      'openedAt',
    ]);
    expect(keys(view.metrics)).toEqual(['lastOkAt', 'samples', 'stale']);
    expect(keys(view.metrics.samples[0]!)).toEqual(['labels', 'name', 'value']);
    expect(keys(view.rules)).toEqual(['available', 'items', 'reason']);
    expect(keys(view.rules.items[0]!)).toEqual([
      'clear',
      'direction',
      'for',
      'id',
      'kind',
      'metric',
      'raise',
      'severity',
      'title',
    ]);
    expect(keys(view.profiles)).toEqual(
      keys(Object.fromEntries(view.devices.map((d) => [d.id, 0]))),
    );
    expect(keys(view.profiles['dc-env-01']!.temperature_c!)).toEqual([
      'baseline',
      'dailySwing',
      'noise',
    ]);
  });

  it('declare the keys of a run, which the simulator pins from its side in scenario-runs.test.ts', () => {
    const run: ScenarioRunView = {
      id: 'r1',
      scenario: 'server-room-overheat',
      startedAt: '2026-10-21T08:00:00.000Z',
      offsetS: 10,
      endsAtS: 90,
      anomalyIds: ['a1'],
      startedDevices: [],
    };
    expect(view.runs).toEqual([]);
    expect(keys(run)).toEqual([
      'anomalyIds',
      'endsAtS',
      'id',
      'offsetS',
      'scenario',
      'startedAt',
      'startedDevices',
    ]);
  });
});

describe('getState', () => {
  it('reads the state from /api/state', async () => {
    const fetchFn = reply(view);
    const state = await getState({ fetch: fetchFn as unknown as typeof fetch });
    expect(state).toEqual(view);
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/state',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('turns the error envelope into an ApiError with its message and status', async () => {
    const fetchFn = reply(
      { statusCode: 403, error: 'Forbidden', message: 'The Host header must name this machine' },
      { status: 403 },
    );
    const failure = await getState({ fetch: fetchFn as unknown as typeof fetch }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).message).toBe('The Host header must name this machine');
  });

  it('says HTTP <status> when a refusal has no message', async () => {
    const failure = await getState({
      fetch: reply({}, { status: 500 }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect((failure as ApiError).message).toBe('HTTP 500');
  });

  it('reports a body that is not JSON', async () => {
    const failure = await getState({
      fetch: reply('<html>', { status: 200 }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toMatch(/not JSON/);
  });

  it('reports a JSON body that is not a state', async () => {
    const failure = await getState({
      fetch: reply({ hello: 'world' }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect((failure as ApiError).message).toMatch(/does not understand/);
  });

  it('reports a simulator that does not answer, with status 0', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await getState({ fetch: fetchFn as unknown as typeof fetch }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
    expect((failure as ApiError).message).toBe('Cannot reach the simulator');
  });

  it('lets an abort through as an abort, not as an outage', async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(getState({ fetch: fetchFn as unknown as typeof fetch })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('device commands', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  /** The method, URL, headers and body a command sent. */
  const sent = (fn: ReturnType<typeof reply>) => {
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, headers: init.headers, body: init.body };
  };

  it.each([
    ['start', startDevice],
    ['pause', pauseDevice],
    ['stop', stopDevice],
  ] as const)(
    '%s is a POST with no body, as JSON, and answers the new state',
    async (action, run) => {
      const fetchFn = reply(view);
      const state = await run('dc-env-01', { fetch: asFetch(fetchFn) });
      expect(state).toEqual(view);
      expect(sent(fetchFn)).toEqual({
        url: `/api/devices/dc-env-01/${action}`,
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: undefined,
      });
    },
  );

  it('puts the interval, or null for the engine default', async () => {
    const fetchFn = reply(view);
    await setDeviceInterval('dc-env-01', 500, { fetch: asFetch(fetchFn) });
    expect(sent(fetchFn)).toMatchObject({
      url: '/api/devices/dc-env-01/interval',
      method: 'PUT',
      body: '{"intervalMs":500}',
    });
    const other = reply(view);
    await setDeviceInterval('dc-env-01', null, { fetch: asFetch(other) });
    expect(sent(other).body).toBe('{"intervalMs":null}');
  });

  it('refuses an interval that is not a positive number before sending anything', async () => {
    const fetchFn = reply(view);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        setDeviceInterval('dc-env-01', bad, { fetch: asFetch(fetchFn) }),
      ).rejects.toBeInstanceOf(ApiError);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('holds a value on a metric, and releases it', async () => {
    const hold = reply(view);
    await holdValue('dc-env-01', 'temperature_c', 31.5, { fetch: asFetch(hold) });
    expect(sent(hold)).toMatchObject({
      url: '/api/devices/dc-env-01/holds/temperature_c',
      method: 'PUT',
      body: '{"value":31.5}',
    });
    const release = reply(view);
    await releaseValue('dc-env-01', 'temperature_c', { fetch: asFetch(release) });
    expect(sent(release)).toMatchObject({
      url: '/api/devices/dc-env-01/holds/temperature_c',
      method: 'DELETE',
      body: undefined,
    });
  });

  it('holds 0 (a legitimate value), and refuses a value that is not a finite number before sending', async () => {
    const fetchFn = reply(view);
    await holdValue('hub-power-01', 'power_kw', 0, { fetch: asFetch(fetchFn) });
    expect(sent(fetchFn).body).toBe('{"value":0}');
    const never = reply(view);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        holdValue('dc-env-01', 'temperature_c', bad, { fetch: asFetch(never) }),
      ).rejects.toBeInstanceOf(ApiError);
    }
    expect(never).not.toHaveBeenCalled();
  });

  it('percent-encodes the device id and the metric in the path', async () => {
    const fetchFn = reply(view);
    await holdValue('a b/c', 'x?y', 1, { fetch: asFetch(fetchFn) });
    expect(sent(fetchFn).url).toBe('/api/devices/a%20b%2Fc/holds/x%3Fy');
  });

  it('turns a refusal of the simulator into an ApiError with its message', async () => {
    const fetchFn = reply(
      { statusCode: 404, error: 'Not Found', message: 'Unknown device "ghost"' },
      { status: 404 },
    );
    const failure = await pauseDevice('ghost', { fetch: asFetch(fetchFn) }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).message).toBe('Unknown device "ghost"');
  });

  it('reports a simulator that does not answer, with status 0', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await stopDevice('dc-env-01', { fetch: asFetch(fetchFn) }).catch(
      (e: unknown) => e,
    );
    expect((failure as ApiError).status).toBe(0);
  });

  it('passes an abort signal to the request', async () => {
    const fetchFn = reply(view);
    const controller = new AbortController();
    await startDevice('dc-env-01', { fetch: asFetch(fetchFn), signal: controller.signal });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('getAlerts', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const page = alertsPageFixture;
  const replyPage = (body: unknown, init: ResponseInit = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), init));
  const urlOf = (fn: ReturnType<typeof replyPage>) => (fn.mock.calls[0] as unknown as [string])[0];

  it('asks for the page the request describes, with the cursor encoded and unread', async () => {
    const fetchFn = replyPage(page);
    await getAlerts({ status: 'open', limit: 5, before: 'ab+/=' }, { fetch: asFetch(fetchFn) });
    expect(urlOf(fetchFn)).toBe('/api/alerts?status=open&limit=5&before=ab%2B%2F%3D');

    const plain = replyPage(page);
    await getAlerts({}, { fetch: asFetch(plain) });
    expect(urlOf(plain)).toBe('/api/alerts');
  });

  it('returns the alerts and the cursor exactly as the simulator sent it', async () => {
    const fetchFn = replyPage(page, { headers: { 'X-Next-Cursor': 'eyJ0IjoiMjAyNiJ9' } });
    const result = await getAlerts({ limit: 2 }, { fetch: asFetch(fetchFn) });
    expect(result.alerts.map((alert) => alert.id)).toEqual(['7', '6']);
    expect(result.next).toBe('eyJ0IjoiMjAyNiJ9');
  });

  it('has no next cursor on the last page', async () => {
    const result = await getAlerts({}, { fetch: asFetch(replyPage(page)) });
    expect(result.next).toBeNull();
  });

  it('turns a refusal of the simulator into an ApiError with its message', async () => {
    const refused = replyPage(
      { statusCode: 502, error: 'Bad Gateway', message: 'ECONNREFUSED' },
      { status: 502 },
    );
    const failure = await getAlerts({}, { fetch: asFetch(refused) }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(502);
    expect((failure as ApiError).message).toBe('ECONNREFUSED');
  });

  it('fails loudly on a body that is not the documented array', async () => {
    for (const body of [{ alerts: [] }, [{ id: 7 }], [null], 'nope']) {
      const failure = await getAlerts({}, { fetch: asFetch(replyPage(body)) }).catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).message).toMatch(/does not understand/);
    }
  });

  it('reports a simulator that does not answer with status 0, and passes an abort on', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await getAlerts({}, { fetch: asFetch(down) }).catch((e: unknown) => e);
    expect((failure as ApiError).status).toBe(0);

    const controller = new AbortController();
    const fetchFn = replyPage(page);
    await getAlerts({}, { fetch: asFetch(fetchFn), signal: controller.signal });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('declares the keys of the fixture, which the simulator’s own test also compares', () => {
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(page[0]!)).toEqual(
      [
        'cause',
        'clearedAt',
        'clearedValue',
        'deliveryAttempts',
        'deliveryError',
        'deliveryStatus',
        'deviceId',
        'externalRef',
        'id',
        'metric',
        'observed',
        'openedAt',
        'openedValue',
        'preexisting',
        'ruleId',
        'severity',
        'status',
        'title',
      ].sort(),
    );
    expect(keys(page[0]!.observed)).toEqual(['clearedAt', 'delivered', 'incident', 'openedAt']);
    expect(keys(page[0]!.cause!)).toEqual(['scenario', 'startedAt']);
    expect(page[1]!.cause).toBeNull();
  });
});

describe('the scenario fixture', () => {
  const library = scenariosFixture as unknown as ScenarioLibraryView;

  it('declares the same keys as the types, section by section (the simulator compares the same file)', () => {
    expect(keys(library)).toEqual(['intervalMs', 'rejected', 'scenarios']);
    expect(keys(library.rejected[0]!)).toEqual(['file', 'reason']);
    const [overheat, , afternoon] = library.scenarios;
    expect(keys(overheat!)).toEqual([
      'anomalies',
      'description',
      'expected',
      'imported',
      'lastRunAt',
      'lengthS',
      'name',
      'needsStart',
      'running',
      'source',
    ]);
    expect(keys(overheat!.anomalies[0]!)).toEqual([
      'deviceId',
      'duration',
      'metric',
      'startAt',
      'value',
    ]);
    const expected = overheat!.expected;
    if (!expected.available) throw new Error('the fixture has rules');
    expect(keys(expected)).toEqual([
      'alerts',
      'available',
      'horizonS',
      'intervalS',
      'quiet',
      'series',
    ]);
    expect(keys(expected.alerts[0]!)).toEqual([
      'clearsAtS',
      'clearsUncertain',
      'deviceId',
      'metric',
      'opensAtS',
      'opensMargin',
      'ruleId',
      'severity',
      'title',
    ]);
    expect(keys(expected.series[0]!)).toEqual(['deviceId', 'metric', 'points', 'stepS']);
    const other = afternoon!.expected;
    if (!other.available) throw new Error('the fixture has rules');
    expect(keys(other.quiet[0]!)).toEqual(['deviceId', 'metric', 'why']);
    expect(keys(afternoon!.needsStart[0]!)).toEqual(['deviceId', 'state']);
  });

  it('has a series of the length its horizon and step give, and the flags the frame shows', () => {
    const [overheat] = library.scenarios;
    const expected = overheat!.expected;
    if (!expected.available) throw new Error('the fixture has rules');
    const lane = expected.series[0]!;
    expect(lane.points.length).toBe(Math.floor(expected.horizonS / lane.stepS) + 1);
    expect([expected.alerts[0]!.opensAtS, expected.alerts[0]!.clearsAtS]).toEqual([24, 80]);
  });
});

describe('scenarios', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const sent = (fn: ReturnType<typeof reply>) => {
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, headers: init.headers, body: init.body };
  };
  const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const refusal = (status: number, message: string, extra: object = {}) =>
    reply({ statusCode: status, error: 'Refused', message, ...extra }, { status });
  const item = (scenariosFixture as unknown as ScenarioLibraryView).scenarios[0]!;

  describe('getScenarios', () => {
    it('reads the library from /api/scenarios', async () => {
      const fetchFn = reply(scenariosFixture);
      const library = await getScenarios({ fetch: asFetch(fetchFn) });
      expect(library).toEqual(scenariosFixture);
      expect(fetchFn).toHaveBeenCalledWith(
        '/api/scenarios',
        expect.objectContaining({ headers: { Accept: 'application/json' } }),
      );
    });

    it('fails loudly on a body that is not the documented list', async () => {
      for (const body of [{ scenarios: 'none' }, { scenarios: [{ name: 1 }], rejected: [] }, []]) {
        const failure = await getScenarios({ fetch: asFetch(reply(body)) }).catch(
          (e: unknown) => e,
        );
        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).message).toMatch(/does not understand/);
      }
    });

    it('turns a refusal into an ApiError and a silent simulator into status 0', async () => {
      const refused = await getScenarios({
        fetch: asFetch(refusal(403, 'The Host header must name this machine')),
      }).catch((e: unknown) => e);
      expect((refused as ApiError).status).toBe(403);
      expect((refused as ApiError).message).toBe('The Host header must name this machine');

      const silent = await getScenarios({
        fetch: asFetch(
          vi.fn(async () => {
            throw new TypeError('Failed to fetch');
          }),
        ),
      }).catch((e: unknown) => e);
      expect((silent as ApiError).status).toBe(0);
    });
  });

  describe('runScenario', () => {
    const answer = {
      ...view,
      runId: 'r1',
      anomalyIds: ['a1'],
      startedDevices: ['hub-power-01'],
      replaced: [],
    };

    it('is a POST with no body, as JSON, and answers the state and what the run did', async () => {
      const fetchFn = reply(answer);
      const result = await runScenario('server-room-overheat', {}, { fetch: asFetch(fetchFn) });
      expect(result.runId).toBe('r1');
      expect(result.startedDevices).toEqual(['hub-power-01']);
      expect(result.engine).toEqual(view.engine);
      expect(sent(fetchFn)).toEqual({
        url: '/api/scenarios/server-room-overheat/run',
        method: 'POST',
        headers: JSON_HEADERS,
        body: undefined,
      });
    });

    it('asks to replace only when told to, and encodes the name', async () => {
      const fetchFn = reply(answer);
      await runScenario('a b', { replace: true }, { fetch: asFetch(fetchFn) });
      expect(sent(fetchFn)).toMatchObject({
        url: '/api/scenarios/a%20b/run',
        body: '{"replace":true}',
      });
      const plain = reply(answer);
      await runScenario('x', { replace: false }, { fetch: asFetch(plain) });
      expect(sent(plain).body).toBeUndefined();
    });

    it('keeps the conflicts of a 409 on the error, and conflictsOf reads them', async () => {
      const conflicts = [
        { deviceId: 'dc-env-01', anomalyId: 'a1', runId: 'r1', scenario: 'server-room-overheat' },
        { deviceId: 'dc-env-02', anomalyId: 'a2', runId: null, scenario: null },
      ];
      const failure = await runScenario(
        'x',
        {},
        { fetch: asFetch(refusal(409, 'in the way', { conflicts })) },
      ).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(409);
      expect((failure as ApiError).message).toBe('in the way');
      expect(conflictsOf(failure)).toEqual(conflicts);
    });

    it('has no conflicts for another 409, another status, a malformed list or another error', async () => {
      const other = await stopScenario('x', {
        fetch: asFetch(refusal(409, '"x" is not running')),
      }).catch((e: unknown) => e);
      expect(conflictsOf(other)).toBeNull();
      const bad = await runScenario(
        'x',
        {},
        { fetch: asFetch(refusal(409, 'm', { conflicts: [{ deviceId: 1 }] })) },
      ).catch((e: unknown) => e);
      expect(conflictsOf(bad)).toBeNull();
      const notConflict = await runScenario(
        'x',
        {},
        { fetch: asFetch(refusal(400, 'm', { conflicts: [] })) },
      ).catch((e: unknown) => e);
      expect(conflictsOf(notConflict)).toBeNull();
      expect(conflictsOf(new Error('x'))).toBeNull();
      expect(conflictsOf(undefined)).toBeNull();
    });

    it('fails loudly on an answer without what a run reports', async () => {
      const failure = await runScenario('x', {}, { fetch: asFetch(reply(view)) }).catch(
        (e: unknown) => e,
      );
      expect((failure as ApiError).message).toMatch(/does not understand/);
    });
  });

  describe('stopScenario', () => {
    it('is a POST with no body, as JSON, and answers the new state', async () => {
      const fetchFn = reply(view);
      expect(await stopScenario('server-room-overheat', { fetch: asFetch(fetchFn) })).toEqual(view);
      expect(sent(fetchFn)).toEqual({
        url: '/api/scenarios/server-room-overheat/stop',
        method: 'POST',
        headers: JSON_HEADERS,
        body: undefined,
      });
    });

    it('says what the simulator said when the scenario is not running', async () => {
      const failure = await stopScenario('x', {
        fetch: asFetch(refusal(409, '"x" is not running')),
      }).catch((e: unknown) => e);
      expect((failure as ApiError).message).toBe('"x" is not running');
    });
  });

  describe('importScenario', () => {
    const document = { name: 'extra', anomalies: [] };

    it('posts the document as it is and answers the state and the scenario', async () => {
      const fetchFn = reply({ ...view, scenario: item }, { status: 201 });
      const result = await importScenario(document, { fetch: asFetch(fetchFn) });
      expect(result.scenario.name).toBe('server-room-overheat');
      expect(sent(fetchFn)).toEqual({
        url: '/api/scenarios/import',
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(document),
      });
    });

    it('carries the reason of a refusal as the error message', async () => {
      const reason = 'anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)';
      const failure = await importScenario(document, {
        fetch: asFetch(refusal(400, reason)),
      }).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(400);
      expect((failure as ApiError).message).toBe(reason);
    });

    it('fails loudly on an answer without the scenario', async () => {
      const failure = await importScenario(document, { fetch: asFetch(reply(view)) }).catch(
        (e: unknown) => e,
      );
      expect((failure as ApiError).message).toMatch(/does not understand/);
    });
  });

  describe('saveScenario', () => {
    const document = {
      name: 'bad-afternoon',
      description: '',
      anomalies: [
        { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 45, duration: 60 },
      ],
    };

    it('puts the document as it is on the path of its own name and answers the state and the card', async () => {
      const fetchFn = reply({ ...view, scenario: item }, { status: 201 });
      const result = await saveScenario(document, { fetch: asFetch(fetchFn) });
      expect(result.scenario.name).toBe('server-room-overheat');
      expect(sent(fetchFn)).toEqual({
        url: '/api/scenarios/bad-afternoon',
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(document),
      });
    });

    it('encodes a name in the path', async () => {
      const fetchFn = reply({ ...view, scenario: item });
      await saveScenario({ ...document, name: 'a/b' }, { fetch: asFetch(fetchFn) });
      expect(sent(fetchFn).url).toBe('/api/scenarios/a%2Fb');
    });

    it('carries the status and the reason of each refusal', async () => {
      for (const [status, reason] of [
        [400, 'anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)'],
        [409, '"bad-afternoon" is running; stop it first'],
        [409, '"overheat" is a built-in scenario and is read-only; save a copy under another name'],
        [500, 'cannot write bad-afternoon.json in the scenarios folder (EROFS)'],
      ] as const) {
        const failure = await saveScenario(document, {
          fetch: asFetch(refusal(status, reason)),
        }).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).status).toBe(status);
        expect((failure as ApiError).message).toBe(reason);
      }
    });

    it('fails loudly on an answer without the scenario', async () => {
      const failure = await saveScenario(document, { fetch: asFetch(reply(view)) }).catch(
        (e: unknown) => e,
      );
      expect((failure as ApiError).message).toMatch(/does not understand/);
    });
  });

  describe('deleteScenario', () => {
    it('is a DELETE with no body, as JSON, and answers the new state', async () => {
      const fetchFn = reply(view);
      expect(await deleteScenario('bad-afternoon', { fetch: asFetch(fetchFn) })).toEqual(view);
      expect(sent(fetchFn)).toEqual({
        url: '/api/scenarios/bad-afternoon',
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: undefined,
      });
    });

    it('says what the simulator said when the scenario cannot be removed', async () => {
      for (const [status, reason] of [
        [404, 'Unknown scenario "x"'],
        [409, '"x" is running; stop it first'],
      ] as const) {
        const failure = await deleteScenario('x', {
          fetch: asFetch(refusal(status, reason)),
        }).catch((e: unknown) => e);
        expect((failure as ApiError).status).toBe(status);
        expect((failure as ApiError).message).toBe(reason);
      }
    });
  });

  it('keeps the body of any refusal on the error, for the callers that need more than the message', async () => {
    const failure = await getState({
      fetch: asFetch(refusal(409, 'm', { extra: 1 })),
    }).catch((e: unknown) => e);
    expect((failure as ApiError).body).toEqual({
      statusCode: 409,
      error: 'Refused',
      message: 'm',
      extra: 1,
    });
  });
});

describe('the observation fixture', () => {
  const events = observationsFixture;

  it('has the keys of an event, newest first, and one event of every kind', () => {
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['at', 'data', 'id', 'kind']);
    }
    const ids = events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(events.map((event) => event.kind).sort()).toEqual([...OBSERVATION_KINDS].sort());
  });
});

describe('getObservations', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const replyEvents = (body: unknown, init: ResponseInit = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), init));
  const urlOf = (fn: ReturnType<typeof replyEvents>) =>
    (fn.mock.calls[0] as unknown as [string])[0];

  it('asks for the page the request describes', async () => {
    const fetchFn = replyEvents(observationsFixture);
    await getObservations({ before: 40, limit: 500 }, { fetch: asFetch(fetchFn) });
    expect(urlOf(fetchFn)).toBe('/api/observations?before=40&limit=500');

    const plain = replyEvents(observationsFixture);
    await getObservations({}, { fetch: asFetch(plain) });
    expect(urlOf(plain)).toBe('/api/observations');
  });

  it('returns the events and the cursor as the simulator sent them', async () => {
    const fetchFn = replyEvents(observationsFixture, { headers: { 'X-Next-Cursor': '1' } });
    const result = await getObservations({ limit: 10 }, { fetch: asFetch(fetchFn) });
    expect(result.events.map((event) => event.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(result.next).toBe(1);
  });

  it('has no next cursor on the last page', async () => {
    const result = await getObservations({}, { fetch: asFetch(replyEvents(observationsFixture)) });
    expect(result.next).toBeNull();
  });

  it('keeps an event of a kind it does not know', async () => {
    const future = { id: 10, at: '2026-10-20T08:02:00.000Z', kind: 'something-new', data: {} };
    const result = await getObservations({}, { fetch: asFetch(replyEvents([future])) });
    expect(result.events).toEqual([future]);
  });

  it('turns a refusal of the simulator into an ApiError with its message', async () => {
    const refused = replyEvents(
      { statusCode: 400, error: 'Bad Request', message: '"limit" must be a whole number' },
      { status: 400 },
    );
    const failure = await getObservations({}, { fetch: asFetch(refused) }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(400);
    expect((failure as ApiError).message).toBe('"limit" must be a whole number');
  });

  it('fails loudly on a body that is not the documented array, or a cursor that is not a number', async () => {
    for (const body of [
      { events: [] },
      [{ id: 1 }],
      [null],
      [{ id: 1.5, at: 'x', kind: 'k', data: {} }],
    ]) {
      const failure = await getObservations({}, { fetch: asFetch(replyEvents(body)) }).catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).message).toMatch(/does not understand/);
    }
    const badCursor = replyEvents(observationsFixture, { headers: { 'X-Next-Cursor': 'abc' } });
    const failure = await getObservations({}, { fetch: asFetch(badCursor) }).catch(
      (e: unknown) => e,
    );
    expect((failure as ApiError).message).toMatch(/cursor/);
  });

  it('reports a simulator that does not answer with status 0, and passes an abort on', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await getObservations({}, { fetch: asFetch(down) }).catch((e: unknown) => e);
    expect((failure as ApiError).status).toBe(0);

    const controller = new AbortController();
    const fetchFn = replyEvents(observationsFixture);
    await getObservations({}, { fetch: asFetch(fetchFn), signal: controller.signal });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('stepEngine and resetEngine', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;

  it('post to the clock commands as JSON and answer the new state', async () => {
    for (const [send, path] of [
      [stepEngine, '/api/step'],
      [resetEngine, '/api/reset'],
    ] as const) {
      const fetchFn = reply(view);
      const state = await send({ fetch: asFetch(fetchFn) });
      expect(state.engine.devices.length).toBe(view.engine.devices.length);
      const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(path);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    }
  });

  it('carries the reason of a refusal: step on the wall clock is a 409', async () => {
    const refused = reply(
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'step needs the simulated clock; this engine runs on the wall clock',
      },
      { status: 409 },
    );
    const failure = await stepEngine({ fetch: asFetch(refused) }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as ApiError).message).toMatch(/simulated clock/);
  });
});

describe('the expectation fixture', () => {
  const preview = expectationsFixture as unknown as ExpectationPreview;

  it('declares the same keys as the types, section by section (the simulator compares the same file)', () => {
    expect(keys(preview)).toEqual(['expected', 'intervalMs', 'needsStart']);
    expect(keys(preview.needsStart[0]!)).toEqual(['deviceId', 'state']);
    const expected = preview.expected;
    if (!expected.available) throw new Error('the fixture has rules');
    expect(keys(expected)).toEqual([
      'alerts',
      'available',
      'horizonS',
      'intervalS',
      'quiet',
      'series',
    ]);
    expect(keys(expected.alerts[0]!)).toEqual([
      'clearsAtS',
      'clearsUncertain',
      'deviceId',
      'metric',
      'opensAtS',
      'opensMargin',
      'ruleId',
      'severity',
      'title',
    ]);
    expect(keys(expected.series[0]!)).toEqual(['deviceId', 'metric', 'points', 'stepS']);
  });
});

describe('addAnomaly and removeAnomaly', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const sent = (fn: ReturnType<typeof reply>) => {
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  };
  const request = {
    deviceId: 'dc-env-01',
    metric: 'temperature_c' as const,
    value: 29.2,
    startAt: 120.5,
    duration: 60,
    shape: 'step' as const,
  };

  it('posts the anomaly as JSON and answers the new state and the id', async () => {
    const fetchFn = reply({ ...view, id: 'a7' }, { status: 201 });
    const answer = await addAnomaly(request, { fetch: asFetch(fetchFn) });

    expect(answer.id).toBe('a7');
    expect(answer.engine.devices.length).toBe(view.engine.devices.length);
    const { url, init, headers } = sent(fetchFn);
    expect(url).toBe('/api/anomalies');
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('fails loudly on an answer without the id', async () => {
    const fetchFn = reply(view, { status: 201 });
    await expect(addAnomaly(request, { fetch: asFetch(fetchFn) })).rejects.toThrow(
      /state Studio does not understand/,
    );
  });

  it('carries the reason of a refusal, and reports a simulator that does not answer', async () => {
    const refused = reply(
      { statusCode: 400, error: 'Bad Request', message: 'Device "ghost" has no metric "x"' },
      { status: 400 },
    );
    const failure = await addAnomaly(request, { fetch: asFetch(refused) }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(400);
    expect((failure as ApiError).message).toMatch(/has no metric/);

    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const outage = await addAnomaly(request, { fetch: asFetch(down) }).catch((e: unknown) => e);
    expect((outage as ApiError).status).toBe(0);
  });

  it('deletes an anomaly by its percent-encoded id and answers the new state', async () => {
    const fetchFn = reply(view);
    const state = await removeAnomaly('a 7/1', { fetch: asFetch(fetchFn) });

    expect(state.devices.length).toBe(view.devices.length);
    const { url, init } = sent(fetchFn);
    expect(url).toBe('/api/anomalies/a%207%2F1');
    expect(init.method).toBe('DELETE');
  });

  it('says 404 for an anomaly that is gone', async () => {
    const gone = reply(
      { statusCode: 404, error: 'Not Found', message: 'Unknown anomaly "a7"' },
      { status: 404 },
    );
    const failure = await removeAnomaly('a7', { fetch: asFetch(gone) }).catch((e: unknown) => e);
    expect((failure as ApiError).status).toBe(404);
  });
});

describe('getExpected', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const anomalies = [
    {
      deviceId: 'dc-env-01',
      metric: 'temperature_c' as const,
      value: 29.2,
      startAt: 20,
      duration: 60,
    },
  ];

  it('posts the anomalies as a list and returns the answer as the simulator sent it', async () => {
    const fetchFn = reply(expectationsFixture);
    const answer = await getExpected(anomalies, { fetch: asFetch(fetchFn) });

    expect(answer).toEqual(expectationsFixture);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/expectations');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ anomalies });
  });

  it('keeps an answer that says the rules cannot be used', async () => {
    const body = {
      expected: { available: false, reason: 'cannot read rules.json (ENOENT)' },
      needsStart: [],
      intervalMs: 2000,
    };
    const answer = await getExpected(anomalies, { fetch: asFetch(reply(body)) });
    expect(answer.expected).toEqual(body.expected);
  });

  it('carries the reason of a refusal', async () => {
    const refused = reply(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: 'anomalies[1] overlaps anomalies[0] on dc-env-01 temperature_c',
      },
      { status: 400 },
    );
    const failure = await getExpected(anomalies, { fetch: asFetch(refused) }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toMatch(/overlaps/);
  });

  it('fails loudly on a body that is not the documented answer', async () => {
    for (const body of [{}, { expected: {}, needsStart: [], intervalMs: 2000 }, []]) {
      await expect(getExpected(anomalies, { fetch: asFetch(reply(body)) })).rejects.toThrow(
        /expectation Studio does not understand/,
      );
    }
  });

  it('reports a simulator that does not answer with status 0, and passes an abort on', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const outage = await getExpected(anomalies, { fetch: asFetch(down) }).catch((e: unknown) => e);
    expect((outage as ApiError).status).toBe(0);

    const aborted = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(getExpected(anomalies, { fetch: asFetch(aborted) })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('the fault commands', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const sent = (fn: ReturnType<typeof reply>) => {
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, headers: init.headers, body: init.body };
  };
  const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const refusal = (status: number, message: string) =>
    reply({ statusCode: status, error: 'Refused', message }, { status });

  describe('setFault', () => {
    it('puts the settings on the path of the kind, as JSON, and answers the state', async () => {
      const cases = [
        ['drop', { percent: 5 }],
        ['duplicate', { percent: 2 }],
        ['delay', { delayMs: 500, jitterMs: 100 }],
        ['reorder', { window: 4 }],
        ['malformed', { percent: 3, kinds: ['range', 'json'] }],
        ['link-loss', { forS: 30 }],
      ] as const;
      for (const [kind, body] of cases) {
        const fetchFn = reply(view);
        const state = await setFault(kind, body as never, { fetch: asFetch(fetchFn) });
        expect(state.engine.devices.length).toBe(view.engine.devices.length);
        expect(sent(fetchFn)).toEqual({
          url: `/api/faults/${kind}`,
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
      }
    });

    it('sends link loss without a body field when it has no automatic restore', async () => {
      const fetchFn = reply(view);
      await setFault('link-loss', {}, { fetch: asFetch(fetchFn) });
      expect(sent(fetchFn).body).toBe('{}');
    });

    it('carries the status and the sentence of each refusal', async () => {
      for (const [status, reason] of [
        [400, '"percent" must be a number above 0 and at most 100'],
        [409, 'The link is already down; restore it first'],
        [409, 'This simulator has no broker link it can cut'],
        [500, 'The link could not be cut: end failed'],
      ] as const) {
        const failure = await setFault(
          'link-loss',
          {},
          { fetch: asFetch(refusal(status, reason)) },
        ).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).status).toBe(status);
        expect((failure as ApiError).message).toBe(reason);
      }
    });

    it('reports a simulator that does not answer with status 0, and passes an abort on', async () => {
      const down = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      const failure = await setFault('drop', { percent: 5 }, { fetch: asFetch(down) }).catch(
        (e: unknown) => e,
      );
      expect((failure as ApiError).status).toBe(0);

      const aborted = vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      });
      await expect(
        setFault('drop', { percent: 5 }, { fetch: asFetch(aborted) }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('fails loudly on an answer that is not a state', async () => {
      const failure = await setFault(
        'drop',
        { percent: 5 },
        { fetch: asFetch(reply({ ok: true })) },
      ).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).message).toMatch(/does not understand/);
    });
  });

  describe('clearFault', () => {
    it('deletes the fault of that kind, with no body', async () => {
      const fetchFn = reply(view);
      await clearFault('malformed', { fetch: asFetch(fetchFn) });
      expect(sent(fetchFn)).toEqual({
        url: '/api/faults/malformed',
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: undefined,
      });
    });

    it('carries the reason of a link that cannot be restored', async () => {
      const failure = await clearFault('link-loss', {
        fetch: asFetch(refusal(500, 'The link could not be restored: no answer from the broker')),
      }).catch((e: unknown) => e);
      expect((failure as ApiError).status).toBe(500);
      expect((failure as ApiError).message).toMatch(/no answer from the broker/);
    });
  });

  describe('setFaultScope', () => {
    it('puts all running devices, or a selection', async () => {
      const running = reply(view);
      await setFaultScope({ mode: 'running' }, { fetch: asFetch(running) });
      expect(sent(running)).toMatchObject({
        url: '/api/faults/scope',
        method: 'PUT',
        body: JSON.stringify({ mode: 'running' }),
      });

      const selected = reply(view);
      const scope: FaultScope = { mode: 'selected', deviceIds: ['dc-env-01', 'lib-air-01'] };
      await setFaultScope(scope, { fetch: asFetch(selected) });
      expect(sent(selected).body).toBe(JSON.stringify(scope));
    });

    it('does not send an empty selection', async () => {
      const fetchFn = reply(view);
      const failure = await setFaultScope(
        { mode: 'selected', deviceIds: [] },
        { fetch: asFetch(fetchFn) },
      ).catch((e: unknown) => e);
      expect((failure as ApiError).status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('carries the 404 of a device the registry does not have', async () => {
      const failure = await setFaultScope(
        { mode: 'selected', deviceIds: ['ghost'] },
        { fetch: asFetch(refusal(404, 'Unknown device "ghost"')) },
      ).catch((e: unknown) => e);
      expect((failure as ApiError).status).toBe(404);
      expect((failure as ApiError).message).toBe('Unknown device "ghost"');
    });
  });

  describe('sendBurst', () => {
    it('posts the count and answers the state with how many went', async () => {
      const fetchFn = reply({ ...view, sent: 1000, failed: 0 });
      const answer = await sendBurst(1000, { fetch: asFetch(fetchFn) });
      expect(answer.sent).toBe(1000);
      expect(answer.failed).toBe(0);
      expect(answer.engine.devices.length).toBe(view.engine.devices.length);
      expect(sent(fetchFn)).toEqual({
        url: '/api/faults/burst',
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ count: 1000 }),
      });
    });

    it('does not send a count that is not a whole number of messages', async () => {
      for (const count of [0, -1, 1.5, Number.NaN]) {
        const fetchFn = reply({ ...view, sent: 0, failed: 0 });
        const failure = await sendBurst(count, { fetch: asFetch(fetchFn) }).catch(
          (e: unknown) => e,
        );
        expect((failure as ApiError).status).toBe(400);
        expect(fetchFn).not.toHaveBeenCalled();
      }
    });

    it('fails loudly on an answer without how many went', async () => {
      const failure = await sendBurst(10, { fetch: asFetch(reply(view)) }).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ApiError);
    });

    it('carries the 400 of a count the devices cannot space, and the 409s', async () => {
      for (const [status, reason] of [
        [400, '2000 messages over 1 device(s) is 2000 for one, more than the 1999 ms interval'],
        [409, 'A burst is already being sent'],
        [409, 'The link to the broker is down; restore it first'],
      ] as const) {
        const failure = await sendBurst(2000, { fetch: asFetch(refusal(status, reason)) }).catch(
          (e: unknown) => e,
        );
        expect((failure as ApiError).status).toBe(status);
        expect((failure as ApiError).message).toBe(reason);
      }
    });
  });

  describe('republishMessage', () => {
    const again = {
      id: 9,
      at: '2026-10-23T08:00:00.000Z',
      ackMs: 3.1,
      deviceId: 'dc-env-01',
      topic: 'campus/BLD-DC/dc-env-01/telemetry',
      payload: '{"seq":1}',
      seq: 1,
      ts: '2026-10-23T07:59:58.000Z',
      fault: 'republish',
    };

    it('posts to the path of the message and answers the state with the message that went out', async () => {
      const fetchFn = reply({ ...view, message: again });
      const answer = await republishMessage(4, { fetch: asFetch(fetchFn) });
      expect(answer.message).toEqual(again);
      expect(answer.engine.devices.length).toBe(view.engine.devices.length);
      expect(sent(fetchFn)).toEqual({
        url: '/api/messages/4/republish',
        method: 'POST',
        headers: JSON_HEADERS,
        body: undefined,
      });
    });

    it('does not send an id that is not a whole number of 1 or more', async () => {
      for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
        const fetchFn = reply({ ...view, message: again });
        const failure = await republishMessage(id, { fetch: asFetch(fetchFn) }).catch(
          (e: unknown) => e,
        );
        expect((failure as ApiError).status, String(id)).toBe(400);
        expect(fetchFn).not.toHaveBeenCalled();
      }
    });

    it('fails loudly on an answer without the message, or with one that is not a message', async () => {
      for (const body of [view, { ...view, message: 'sent' }, { ...view, message: { id: 'x' } }]) {
        const failure = await republishMessage(1, { fetch: asFetch(reply(body)) }).catch(
          (e: unknown) => e,
        );
        expect(failure).toBeInstanceOf(ApiError);
      }
    });

    it('carries the simulator’s reason for 404, 409 and 502', async () => {
      for (const [status, reason] of [
        [404, 'Message 4 is not in the publish log; only the last 200 are kept'],
        [409, 'The link to the broker is down; restore it first'],
        [502, 'The broker did not accept the message: not authorised'],
      ] as const) {
        const failure = await republishMessage(4, {
          fetch: asFetch(refusal(status, reason)),
        }).catch((e: unknown) => e);
        expect((failure as ApiError).status).toBe(status);
        expect((failure as ApiError).message).toBe(reason);
      }
    });
  });

  describe('clearFaults and resetFaultEffect', () => {
    it('delete all faults, and begin the effect session again', async () => {
      const clear = reply(view);
      await clearFaults({ fetch: asFetch(clear) });
      expect(sent(clear)).toMatchObject({ url: '/api/faults', method: 'DELETE' });

      const reset = reply(view);
      await resetFaultEffect({ fetch: asFetch(reset) });
      expect(sent(reset)).toMatchObject({ url: '/api/faults/effect/reset', method: 'POST' });
    });

    it('carry the reason of a refusal', async () => {
      const failure = await clearFaults({
        fetch: asFetch(refusal(500, 'The link could not be restored')),
      }).catch((e: unknown) => e);
      expect((failure as ApiError).status).toBe(500);
    });
  });
});
