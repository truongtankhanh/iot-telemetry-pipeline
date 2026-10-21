import { describe, expect, it, vi } from 'vitest';
import alertsPageFixture from './fixtures/alerts-page.json';
import observationsFixture from './fixtures/observations.json';
import scenariosFixture from './fixtures/scenarios.json';
import { stateViewFixture as fixture } from './fixtures/stateView';
import {
  ApiError,
  conflictsOf,
  getAlerts,
  getObservations,
  getScenarios,
  getState,
  holdValue,
  importScenario,
  pauseDevice,
  releaseValue,
  resetEngine,
  runScenario,
  setDeviceInterval,
  startDevice,
  stepEngine,
  stopDevice,
  stopScenario,
} from './client';
import { OBSERVATION_KINDS, type ScenarioLibraryView, type ScenarioRunView } from './types';

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
      'broker',
      'config',
      'devices',
      'engine',
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
      'intervalMs',
      'nowMs',
      'published',
      'running',
      'simulated',
    ]);
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
    const result = await getObservations({ limit: 9 }, { fetch: asFetch(fetchFn) });
    expect(result.events.map((event) => event.id)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
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
